import { z } from 'zod';
import { BadRequestException, ConflictException, Controller, Delete, Get, Inject, Injectable, NotFoundException, Param, Patch, Post, Query, Req, Res, Body, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from "../../../packages/database/src/sqlite";
import { CareerStore, CareerConflict, CareerNotFound, type TaskRow } from '../../../packages/career/src/store';
import { ResumeFileStore, careerDataDir } from '../../../packages/career/src/storage';
import { digest, normalizeSourceText, deliveryAuthorized } from '../../../packages/career/src/domain';
import { evaluatePosting, orderShortlist } from '../../../packages/career/src/filters';
import { validateEditedQuestionSources } from '../../../packages/career/src/provenance';
import {
  careerContactRetrySchema, careerContactApprovalSchema, careerContactApprovalViewSchema, careerContactViewSchema, careerPostingReinspectSchema, bossSiteResumeInspectSchema, careerBindResumeSchema, bossSessionClearSchema, bossSessionViewSchema, careerApprovalSchema, careerBatchViewSchema, careerCancelSchema, careerDeleteTaskSchema,
  careerItemReconcileSchema, careerItemResumeAttachmentSchema, careerItemRetrySchema, careerPolicySchema,
  careerPostingPatchSchema, careerResumeCommandSchema, careerRetryGenerationSchema, careerTaskCreateSchema,
  careerTaskPostingViewSchema, careerTaskViewSchema, type CareerBatchView, type CareerTaskState, type CareerTaskView,
} from '../../../packages/contracts/src/career';
import {
  careerPreparationViewSchema, careerSaveToBankSchema, personalizedPreparationPatchSchema, preparedBankDraftSchema, savePreparationSchema,
  type PersonalizedPreparation, type PersonalizedQuestion,
} from '../../../packages/contracts/src/preparation';
import { roleFamilySchema } from '../../../packages/contracts/src/bank';
import { openDatabase } from '../../../packages/database/src/client';
import { createCareerQueue } from '../../../packages/jobs/src/queue';
import type { ApiConfig } from '../../../packages/config/src/index';
import { QuestionBank } from './bank';
import { ModelGateway } from './models';
import { CareerErrorFilter } from './errors';
import { deleteCareerDerivedPersonalData } from './career-deletion';

export const CAREER = 'CAREER';

/** Store conflict codes of an explicit item retry, mapped onto the owner-visible Chinese reasons. */
const RETRY_CONFLICT_MESSAGES: Record<string, string> = {
  ITEM_CHANGED: '岗位状态已更新，请重新读取。',
  ITEM_NOT_FAILED: '只有已证明未发生的失败可以显式重试；未知结果必须先核对。',
  CONVERSATION_NOT_CONFIRMED: '附件重试需要已确认的沟通记录。',
  RESERVATION_REPLACED: '该岗位已被新的批次重新占用，本批次不能再发起外发；请重新读取后再操作。',
};

type RoleFamily = z.infer<typeof roleFamilySchema>;

/** Agent-development career targets map onto the existing general role family; no enum widening. */
function roleFamilyForTask(task: TaskRow): RoleFamily {
  return task.policy.roleTargets.includes('fullstack') ? 'fullstack' : 'general';
}

function ownerOf(req: Request) {
  return z.uuid().parse(req.headers['x-owner-id']);
}
function uuidParam(value: string, label = '资源') {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException(`无效的${label}编号。`);
  return parsed.data;
}

/** Persisted task state is already schema-typed; the view never invents a pause reason or error. */
function taskState(task: TaskRow): CareerTaskState {
  if (task.status === 'paused') {
    if (!task.pause_reason) throw new Error('PAUSE_REASON_MISSING');
    return { status: 'paused', phase: task.phase, reason: task.pause_reason, detail: (task.pause_detail ?? '').slice(0, 400) };
  }
  if (task.status === 'failed') return { status: 'failed', phase: task.phase, error: (task.error ?? '任务失败').slice(0, 400) };
  if (task.status === 'cancelled') return { status: 'cancelled', phase: task.phase };
  return { status: 'active', phase: task.phase };
}

@Injectable()
export class CareerService {
  readonly store: CareerStore;
  readonly files: ResumeFileStore;
  readonly models: ModelGateway;
  readonly bank: QuestionBank;
  private readonly pool: Pool;
  private readonly queue;
  constructor(readonly config: ApiConfig) {
    this.pool = openDatabase(config.DATABASE_URL).pool;
    this.store = new CareerStore(this.pool);
    this.files = new ResumeFileStore(careerDataDir(config));
    this.models = new ModelGateway(config);
    this.bank = new QuestionBank(this.pool);
    this.queue = createCareerQueue(config.REDIS_URL);
    this.queue.on('error', () => {});
  }

  async close() {
    await Promise.all([this.pool.end(), this.queue.close()]);
  }

  private async wakeBestEffort(workId: string) {
    try {
      await this.queue.add('wake', { workId }, { jobId: workId });
    } catch {
      /* SQLite reconciliation picks the work up on the next worker tick. */
    }
  }

  private async enqueue(input: { owner: string; kind: 'scan' | 'delivery' | 'preparation' | 'purge' | 'session'; taskId?: string | null; batchId?: string | null; batchItemId?: string | null; preparationId?: string | null; requestHash: string; payload?: Record<string, unknown> }) {
    const id = crypto.randomUUID();
    await this.store.enqueueWork({ id, ...input });
    await this.wakeBestEffort(id);
    return id;
  }

  private async taskRow(owner: string, id: string) {
    const task = await this.store.getTask(owner, id);
    if (!task) throw new NotFoundException('求职任务不存在。');
    return task;
  }

  private async taskView(owner: string, task: Awaited<ReturnType<CareerStore['getTask']>> extends infer T ? NonNullable<T> : never): Promise<CareerTaskView> {
    const counts = await this.store.dispositionCounts(task.id);
    const batches = await this.store.batchesForTask(task.id);
    const duplicates = await this.pool.query("SELECT count(*) AS total FROM app_career_task_postings WHERE task_id=$1 AND EXISTS (SELECT 1 FROM json_each(decision,'$.reasons') r WHERE r.value->>'code'='already_contacted')", [task.id]);
    return careerTaskViewSchema.parse({
      id: task.id, revision: task.revision, state: taskState(task), policy: task.policy,
      resumeVersionId: task.resume_version_id, resumeTextSha256: task.resume_text_sha256, attachmentSha256: task.attachment_sha256,
      mode: !task.model_source ? 'preview' : task.model_source.connectionId ? 'personalized' : 'manual',
      model: task.model_source,
      readCount: task.read_count, createdAt: task.created_at.toISOString(), updatedAt: task.updated_at.toISOString(),
      shortlistCount: counts.eligible, excludedCount: counts.excluded, reviewCount: counts.needs_review,
      duplicateCount: z.object({ total: z.number() }).parse(duplicates.rows[0]).total,
      batches: batches.map(batch => ({ id: batch.id, state: batch.state, approvedAt: batch.approved_at.toISOString() })),
    });
  }

  async createTask(owner: string, raw: unknown) {
    if(!['enabled','contact','search'].includes(this.config.BOSS_AUTOMATION))throw new ConflictException('当前仅允许手动登录与检查，自动搜索和投递未启用。');
    const input = careerTaskCreateSchema.parse(raw);
    const requestHash = digest({ kind: 'create-career-task', input });
    const command = await this.store.findCommand(owner, input.requestId);
    if (command) {
      if (command.kind !== 'create-career-task' || command.request_hash !== requestHash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      if (!command.result_id) throw new ConflictException('IDEMPOTENCY_CONFLICT');
      return this.taskView(owner, await this.taskRow(owner, command.result_id));
    }
    const preview = 'mode' in input && input.mode === 'preview';
    const resume = 'resumeVersionId' in input ? await this.store.getResumeVersion(owner, input.resumeVersionId) : null;
    if (!preview && !resume) throw new NotFoundException('所选简历版本不存在。');
    const model = 'modelConnectionId' in input ? await this.models.describe(owner, input.modelConnectionId) : null;
    const policy = careerPolicySchema.parse({
      ...input.policy,
      companyBlacklistKeywords: [...new Set(input.policy.companyBlacklistKeywords.map(keyword => keyword.trim()).filter(Boolean))],
    });
    const task = await this.store.createTask(owner, { id: crypto.randomUUID(), resume, policy, model: model ? { connectionId: model.id, label: model.model } : null, requestId: input.requestId, requestHash });
    const scan = await this.pool.query("SELECT id FROM app_career_work WHERE task_id=$1 AND kind='scan' ORDER BY created_at DESC LIMIT 1", [task.id]);
    const scanId = scan.rows[0] ? z.object({ id: z.uuid() }).parse(scan.rows[0]).id : null;
    if (scanId) await this.wakeBestEffort(scanId);
    return this.taskView(owner, task);
  }

  private contactView(row:Awaited<ReturnType<CareerStore['contacts']>>[number]){
    return careerContactViewSchema.parse({id:row.id,approvalId:row.approval_id,taskId:row.task_id,taskPostingId:row.task_posting_id,snapshotHash:row.snapshot_hash,company:row.posting_snapshot.company,title:row.posting_snapshot.title,url:row.posting_snapshot.url,mode:'site_preset',state:row.state,reason:row.reason,evidence:row.evidence,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()});
  }
  async listContacts(owner:string,taskId:string){await this.taskRow(owner,taskId);return(await this.store.contacts(owner,taskId)).map(row=>this.contactView(row));}
  async retryContact(owner:string,taskId:string,contactId:string,raw:unknown){
    if(!['enabled','contact'].includes(this.config.BOSS_AUTOMATION))throw new ConflictException('仅沟通模式尚未启用。');
    await this.store.retryContact(owner,taskId,contactId,careerContactRetrySchema.parse(raw));
    return this.listContacts(owner,taskId);
  }
  async approveContacts(owner:string,taskId:string,raw:unknown){
    if(!['enabled','contact'].includes(this.config.BOSS_AUTOMATION))throw new ConflictException('仅沟通模式尚未启用，当前不会点击立即沟通。');
    const input=careerContactApprovalSchema.parse(raw);
    const approvalId=await this.store.approveContacts(owner,taskId,input);
    const contacts=(await this.store.contacts(owner,taskId)).filter(row=>row.approval_id===approvalId).map(row=>this.contactView(row));
    return careerContactApprovalViewSchema.parse({approvalId,contacts});
  }

  async bindResume(owner: string, taskId: string, raw: unknown) {
    const input = careerBindResumeSchema.parse(raw);
    const task = await this.store.bindPreviewResume(owner,{taskId,...input,requestHash:digest({kind:'bind-preview-resume',taskId,input})});
    return this.taskView(owner,task);
  }

  async listTasks(owner: string) {
    const tasks = await this.store.listTasks(owner);
    return Promise.all(tasks.map(task => this.taskView(owner, task)));
  }

  async getTask(owner: string, id: string) {
    return this.taskView(owner, await this.taskRow(owner, id));
  }

  async listPostings(owner: string, taskId: string) {
    const task = await this.taskRow(owner, taskId);
    const rows = await this.store.listTaskPostings(owner, taskId);
    const parsed = rows.map(row => careerTaskPostingViewSchema.parse({
      id: row.id, postingId: row.posting_id, revision: row.revision, snapshotHash: row.snapshot_hash, observed: row.observed,
      decision: row.decision, match: row.match, greeting: row.greeting, greetingRevision: row.greeting_revision,
      ownerReview: row.owner_review, preparation: row.preparation,
    }));
    // The API returns the authoritative grounded shortlist order (not creation order); non-eligible
    // rows stay in creation order and remain visible in their own disposition tabs.
    const eligible = orderShortlist(parsed.filter(row => row.decision.disposition === 'eligible').map(row => ({ ...row, sitePostingId: row.observed.sitePostingId })), task.policy.preferAiApplication)
      .map(({ sitePostingId: _sitePostingId, ...row }) => row);
    return [...eligible, ...parsed.filter(row => row.decision.disposition !== 'eligible')];
  }

  async patchPosting(owner: string, taskId: string, postingId: string, raw: unknown) {
    const input = careerPostingPatchSchema.parse(raw);
    const task = await this.taskRow(owner, taskId);
    if (task.status === 'cancelled') throw new ConflictException('任务已取消。');
    const posting = await this.store.getTaskPosting(owner, postingId);
    if (!posting || posting.task_id !== task.id) throw new NotFoundException('岗位记录不存在。');
    const approved = await this.pool.query("SELECT 1 FROM app_career_batch_items WHERE task_posting_id=$1 UNION ALL SELECT 1 FROM app_career_contacts WHERE task_posting_id=$1 LIMIT 1", [posting.id]);
    if (approved.rows.length) throw new ConflictException('该岗位已进入已批准的批次，不能修改。');
    if (posting.revision !== input.expectedRevision) throw new ConflictException('岗位记录已更新，请重新读取。');
    if (input.greetingText !== undefined && !task.model_source) throw new ConflictException('纯规则预览不生成招呼语，请先创建个性化任务。');
    const greeting = input.greetingText !== undefined && task.model_source
      ? { text: input.greetingText, factualClaims: posting.greeting?.factualClaims ?? [], uncertainties: posting.greeting?.uncertainties ?? [], modelAttribution: posting.greeting?.modelAttribution ?? (task.model_source.connectionId ? { kind: 'connection' as const, connectionId: task.model_source.connectionId, model: task.model_source.label } : { kind: 'manual' as const, connectionId: null, model: '手动确认' as const }) }
      : undefined;
    let ownerReview = posting.owner_review;
    if (input.ownerReview) {
      if (input.ownerReview.decision === 'confirmed_direct' && !input.ownerReview.source.trim()) throw new BadRequestException('确认直接雇佣需要填写看到的依据来源。');
      ownerReview = input.ownerReview;
    }
    const revision = await this.store.updateTaskPosting(owner, posting.id, input.expectedRevision, { greeting, ownerReview: input.ownerReview });
    if (input.ownerReview) {
      const decision = evaluatePosting({ policy: task.policy, posting: posting.observed, ownerReview });
      await this.pool.query("UPDATE app_career_task_postings SET disposition=$3, decision=$4, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2", [posting.id, owner, decision.disposition, JSON.stringify(decision)]);
    }
    const refreshed = await this.store.getTaskPosting(owner, posting.id);
    if (!refreshed) throw new NotFoundException('岗位记录不存在。');
    return careerTaskPostingViewSchema.parse({
      id: refreshed.id, postingId: refreshed.posting_id, revision, snapshotHash: refreshed.snapshot_hash, observed: refreshed.observed,
      decision: refreshed.decision, match: refreshed.match, greeting: refreshed.greeting, greetingRevision: refreshed.greeting_revision,
      ownerReview: refreshed.owner_review, preparation: refreshed.preparation,
    });
  }

  async approve(owner: string, taskId: string, raw: unknown) {
    if(this.config.BOSS_AUTOMATION!=='enabled')throw new ConflictException('自动投递未启用，当前不会发起沟通或发送简历。');
    const input = careerApprovalSchema.parse(raw);
    const task = await this.taskRow(owner, taskId);
    // These early checks are only fast, clear messages; replay, digest, item state and reservations
    // are all re-checked against locked rows inside the authoritative store transaction.
    if (task.status !== 'active' || task.phase !== 'review') throw new ConflictException('任务尚未进入可审批的复核阶段。');
    if (input.resumeVersionId !== task.resume_version_id) throw new ConflictException('简历版本与任务不一致，请重新选择。');
    const items = input.items.map((item, position) => ({ id: crypto.randomUUID(), position, ...item }));
    let batchId: string;
    try {
      const result = await this.store.approve(owner, {
        id: crypto.randomUUID(), requestId: input.requestId, taskId: task.id,
        expectedTaskRevision: input.expectedTaskRevision, resumeVersionId: input.resumeVersionId, items,
      });
      batchId = result.batch.id;
    } catch (error) {
      if (error instanceof CareerConflict) throw new ConflictException(error.code);
      throw error;
    }
    const work = await this.store.queuedDeliveryWork(batchId);
    for (const item of work) await this.wakeBestEffort(item.id);
    return this.batchView(owner, batchId);
  }

  async batchView(owner: string, batchId: string): Promise<CareerBatchView> {
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    const items = await this.store.batchItems(owner, batchId);
    const detailed = [];
    for (const item of items) {
      const effects = await this.store.effects(item.id);
      const evidence = (phase: 'conversation' | 'attachment') => effects
        .filter(effect => effect.phase === phase && effect.outcome !== 'dispatching')
        .slice(-2)
        .flatMap(effect => z.array(z.object({ observedAt: z.string(), url: z.string(), summary: z.string() })).safeParse(effect.evidence).success
          ? z.array(z.object({ observedAt: z.string(), url: z.string(), summary: z.string() })).parse(effect.evidence)
          : []);
      detailed.push({
        id: item.id, taskPostingId: item.task_posting_id, revision: item.revision,
        company: item.company ?? '', title: item.title ?? '', location: item.location ?? '', salaryRaw: item.salary_raw ?? '',
        snapshotHash: item.snapshot_hash, greeting: item.greeting, greetingSha256: item.greeting_sha256,
        conversation: { state: item.conversation_state, evidence: evidence('conversation'), reason: item.conversation_reason },
        attachment: { state: item.attachment_state, evidence: evidence('attachment'), reason: item.attachment_reason, originalName: batch.original_name ?? '', attachmentSha256: batch.attachment_sha256 },
        preparation: item.preparation,
      });
    }
    return careerBatchViewSchema.parse({
      id: batch.id, taskId: batch.task_id, digest: batch.digest, taskRevision: batch.task_revision, state: batch.state,
      approvedAt: batch.approved_at.toISOString(), resumeVersionId: batch.resume_version_id, resumeLabel: batch.resume_label ?? '',
      attachmentSha256: batch.attachment_sha256, resumeTextSha256: batch.resume_text_sha256, originalName: batch.original_name ?? '',
      model: batch.model, sessionGeneration: batch.session_generation, accountMarker: batch.account_marker,
      pauseReason: batch.pause_reason, items: detailed,
    });
  }

  async resumeTask(owner: string, taskId: string, raw: unknown) {
    const input = careerResumeCommandSchema.parse(raw);
    const task = await this.taskRow(owner, taskId);
    if (task.status !== 'paused') throw new ConflictException('只有已暂停的任务可以恢复。');
    if (task.revision !== input.expectedRevision) throw new ConflictException('任务已更新，请重新读取。');
    const session = await this.store.session(owner);
    if (session && session.state === 'clearing') throw new ConflictException('BOSS 会话正在清除。');
    if (task.phase === 'review') {
      const updated = await this.store.setTaskState(task.id, { status: 'active', pauseReason: null, pauseDetail: null, incrementRevision: true });
      return updated ? this.taskView(owner, updated) : this.getTask(owner, taskId);
    }
    const updated = await this.store.setTaskState(task.id, { status: 'active', pauseReason: null, pauseDetail: null, incrementRevision: true });
    if (!updated) throw new NotFoundException('求职任务不存在。');
    await this.enqueue({ owner, kind: 'scan', taskId: updated.id, requestHash: `scan:${updated.id}:${updated.revision}` });
    return this.taskView(owner, updated);
  }

  async resumeBatch(owner: string, batchId: string, raw: unknown) {
    const input = careerResumeCommandSchema.parse(raw);
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    if (batch.state !== 'paused') throw new ConflictException('只有已暂停的批次可以恢复。');
    if (input.expectedRevision !== batch.task_revision) throw new ConflictException('批次审批内容已变化，请重新读取后再恢复。');
    const session = await this.store.session(owner);
    if (!session || session.state !== 'ready') throw new ConflictException('会话尚未确认就绪，请先完成登录并检查会话。');
    // A reset or another account revokes the frozen approval: resuming would execute it under a
    // session it was never approved for, so the user must review and approve again.
    if (!deliveryAuthorized({ sessionGeneration: batch.session_generation, accountMarker: batch.account_marker }, { profileGeneration: session.profile_generation, accountMarker: session.account_marker })) {
      throw new ConflictException('会话已重置或账号已变化，这批审批不再执行；请重新复核并批准。');
    }
    await this.store.setBatchState(batchId, 'delivering');
    const items = await this.store.batchItems(owner, batchId);
    for (const item of items) {
      if (!this.itemNeedsDelivery(item)) continue;
      await this.enqueue({ owner, kind: 'delivery', taskId: batch.task_id, batchId, batchItemId: item.id, requestHash: `delivery:${item.id}:${item.revision}` });
    }
    return this.batchView(owner, batchId);
  }

  private itemNeedsDelivery(item: { conversation_state: string; attachment_state: string }) {
    if (item.conversation_state === 'not_started' || item.conversation_state === 'dispatching') return true;
    return item.conversation_state === 'confirmed' && (item.attachment_state === 'not_started' || item.attachment_state === 'dispatching');
  }

  async retryItem(owner: string, batchId: string, itemId: string, raw: unknown) {
    const input = careerItemRetrySchema.parse(raw);
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    if (batch.state === 'cancelled') throw new ConflictException('批次已取消。');
    // The retry transaction itself proves this batch still owns the posting reservation.
    try {
      const { workId } = await this.store.retryDeliveryItem({ owner, batchId, taskId: batch.task_id, itemId, phase: input.phase, expectedRevision: input.expectedRevision });
      await this.wakeBestEffort(workId);
      return { workId };
    } catch (error) {
      if (error instanceof CareerNotFound) throw new NotFoundException('批次岗位不存在。');
      if (error instanceof CareerConflict) throw new ConflictException(RETRY_CONFLICT_MESSAGES[error.code] ?? error.code);
      throw error;
    }
  }

  async reconcileItem(owner: string, batchId: string, itemId: string) {
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    const item = await this.store.batchItem(owner, batchId, itemId);
    if (!item) throw new NotFoundException('批次岗位不存在。');
    if (!['unknown', 'awaiting_consent'].includes(item.conversation_state) && !['unknown', 'awaiting_consent'].includes(item.attachment_state)) {
      throw new ConflictException('只有未知或等待同意的状态需要核对。');
    }
    const workId = await this.enqueue({ owner, kind: 'delivery', taskId: batch.task_id, batchId, batchItemId: itemId, requestHash: `delivery:${itemId}:${item.revision}:reconcile`, payload: { action: 'reconcile' } });
    return { workId };
  }

  async resumeAttachment(owner: string, batchId: string, itemId: string, raw: unknown) {
    const input = careerItemResumeAttachmentSchema.parse(raw);
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    if (batch.state === 'cancelled') throw new ConflictException('批次已取消。');
    const item = await this.store.batchItem(owner, batchId, itemId);
    if (!item) throw new NotFoundException('批次岗位不存在。');
    if (item.revision !== input.expectedRevision) throw new ConflictException('岗位状态已更新，请重新读取。');
    if (item.conversation_state !== 'confirmed') throw new ConflictException('沟通尚未确认，不能继续发送附件。');
    if (!['awaiting_consent', 'not_started'].includes(item.attachment_state)) throw new ConflictException('当前附件状态不能继续。');
    if (item.attachment_state === 'awaiting_consent') await this.store.setItemStates(owner, item.id, { attachment: 'not_started' });
    const refreshed = await this.store.batchItem(owner, batchId, itemId);
    const workId = await this.enqueue({ owner, kind: 'delivery', taskId: batch.task_id, batchId, batchItemId: itemId, requestHash: `delivery:${itemId}:${refreshed?.revision ?? item.revision + 1}:attachment`, payload: { action: 'attachment' } });
    return { workId };
  }

  async cancelTask(owner: string, taskId: string) {
    const task = await this.store.cancelTask(owner, taskId);
    return this.taskView(owner, task);
  }

  async cancelBatch(owner: string, batchId: string) {
    const batch = await this.store.batch(owner, batchId);
    if (!batch) throw new NotFoundException('批次不存在。');
    await this.store.cancelBatch(owner, batchId);
    return this.batchView(owner, batchId);
  }

  async deleteTask(owner: string, taskId: string) {
    const task = await this.taskRow(owner, taskId);
    await this.store.cancelTask(owner, task.id);
    await deleteCareerDerivedPersonalData(this.store, this.bank, owner, {
      preparationIds: await this.store.preparationIdsForTask(owner, task.id),
    });
    await this.store.deleteTask(owner, task.id);
    return { deleted: true, pendingCleanup: true };
  }

  async retryGeneration(owner: string, taskId: string, raw: unknown) {
    const input = careerRetryGenerationSchema.parse(raw);
    const task = await this.taskRow(owner, taskId);
    if (!task.model_source?.connectionId) throw new ConflictException('此任务未绑定 AI 模型，不能重试生成。');
    if (task.revision !== input.expectedRevision) throw new ConflictException('任务已更新，请重新读取。');
    const batches = await this.store.batchesForTask(task.id);
    if (batches.length) throw new ConflictException('任务已有已批准的批次，不能用新的模型配置重跑生成。');
    const model = await this.models.describe(owner, input.modelConnectionId);
    await this.pool.query("UPDATE app_career_tasks SET model_source=$3, status='active', phase=COALESCE(phase,'searching'), pause_reason=NULL, pause_detail=NULL, error=NULL, revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2",
      [task.id, owner, JSON.stringify({ connectionId: model.id, label: model.model })]);
    const refreshed = await this.taskRow(owner, task.id);
    await this.enqueue({ owner, kind: 'scan', taskId: refreshed.id, requestHash: `scan:${refreshed.id}:${refreshed.revision}` });
    return this.taskView(owner, refreshed);
  }

  // ---------- session ----------
  private async sessionView(owner: string) {
    const session = await this.store.session(owner);
    const tasks = await this.pool.query("SELECT id FROM app_career_tasks WHERE owner=$1 AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 20", [owner]);
    return bossSessionViewSchema.parse({
      automationMode:this.config.BOSS_AUTOMATION,
      site: 'boss', engine: session?.engine ?? (this.config.BOSS_BROWSER_ENGINE ?? 'patchright'), state: session?.state ?? 'absent',
      reason: session?.reason ?? null, accountMarker: session?.account_marker ?? null, generation: session?.profile_generation ?? 0,
      humanWindow: session?.human_window ?? 'none', affectedTaskIds: tasks.rows.map(row => z.object({ id: z.uuid() }).parse(row).id),
      updatedAt: session?.observed_at.toISOString() ?? null, limitation: session?.limitation ?? null,
    });
  }

  async session(owner: string) {
    return this.sessionView(owner);
  }

  async openSession(owner: string) {
    if(this.config.BOSS_AUTOMATION==='paused')throw new ConflictException('BOSS 自动化已暂停；请先人工处理风控。当前不会打开浏览器或访问站点。');
    const current = await this.store.session(owner);
    if (!current || current.state === 'absent') await this.store.writeSession(owner, { state: 'starting', reason: '正在启动本机专用 BOSS 会话。' });
    const workId = await this.enqueue({ owner, kind: 'session', requestHash: `session:open:${owner}:${(current?.profile_generation ?? 0)}:${Date.now()}`, payload: { action: 'open' } });
    await this.waitForSession(owner, current?.observed_at.getTime() ?? 0);
    return { workId, session: await this.sessionView(owner) };
  }

  async checkSession(owner: string, captureControls=false) {
    if(this.config.BOSS_AUTOMATION==='paused')throw new ConflictException('BOSS 自动化已暂停；当前不会检查或刷新站点。');
    const current = await this.store.session(owner);
    const workId = await this.enqueue({ owner, kind: 'session', requestHash: `session:check:${owner}:${(current?.profile_generation ?? 0)}:${Date.now()}`, payload: { action: 'check', captureControls } });
    await this.waitForSession(owner, current?.observed_at.getTime() ?? 0);
    return { workId, session: await this.sessionView(owner) };
  }

  async reinspectPosting(owner:string,taskId:string,postingId:string,raw:unknown){
    if(!['enabled','contact','search'].includes(this.config.BOSS_AUTOMATION))throw new ConflictException('自动搜索未启用。');
    const input=careerPostingReinspectSchema.parse(raw);
    const task=await this.taskRow(owner,taskId);
    const posting=await this.store.getTaskPosting(owner,postingId);
    if(!posting||posting.task_id!==task.id)throw new NotFoundException('岗位记录不存在。');
    if(task.model_source||task.status!=='active'||task.phase!=='review')throw new ConflictException('只能核对已完成的未绑定预览。');
    const workId=await this.enqueue({owner,kind:'session',taskId,requestHash:`posting-reinspect:${taskId}:${postingId}:${input.requestId}`,payload:{action:'check',inspectCompanyPostingId:postingId}});
    return{workId};
  }

  async inspectSiteResume(owner: string, raw: unknown) {
    if(this.config.BOSS_AUTOMATION==='paused')throw new ConflictException('BOSS 自动化已暂停。');
    const input=bossSiteResumeInspectSchema.parse(raw);
    const workId=await this.enqueue({owner,kind:'session',requestHash:`session:resume:${owner}:${Date.now()}`,payload:{action:'check',inspectResumeName:input.expectedName}});
    return {workId};
  }

  private async waitForSession(owner: string, previousObservedAt: number) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const session = await this.store.session(owner);
      if (session && session.observed_at.getTime() > previousObservedAt) return;
    }
  }

  async clearSession(owner: string) {
    // Clear acceptance withdraws delivery authority in its own transaction; the queued session work
    // only destroys the local browser/profile afterwards.
    const clearing = await this.store.beginSessionClear(owner);
    // Work request hashes are globally unique per kind, so the owner is part of every session hash;
    // otherwise a second owner's clear would be silently deduplicated against the first owner's.
    const workId = await this.enqueue({ owner, kind: 'session', requestHash: `session:clear:${owner}:${clearing.profile_generation}`, payload: { action: 'clear' } });
    return { workId, session: await this.sessionView(owner) };
  }

  // ---------- preparation ----------
  private async preparationRow(owner: string, id: string) {
    const preparation = await this.store.preparation(owner, id);
    if (!preparation) throw new NotFoundException('备题记录不存在。');
    return preparation;
  }

  private async preparationView(owner: string, row: NonNullable<Awaited<ReturnType<CareerStore['preparation']>>>) {
    const [resume, posting, task] = await Promise.all([
      this.store.getResumeVersion(owner, row.resume_version_id),
      this.store.getTaskPosting(owner, row.task_posting_id),
      this.store.getTask(owner, row.task_id),
    ]);
    if (!resume || !posting || !task) throw new NotFoundException('备题来源资料已删除，请重新生成。');
    return careerPreparationViewSchema.parse({
      id: row.id, taskId: row.task_id, taskPostingId: row.task_posting_id, status: row.status, revision: row.revision,
      failure: row.failure, generation: row.generation, model: row.model,
      edited: row.edited !== null, preparation: row.edited ?? row.original,
      resumeVersionId: row.resume_version_id, resumeTextSha256: row.resume_text_sha256, jdSnapshotHash: row.jd_snapshot_hash,
      resume: { versionId: resume.id, label: resume.label, text: resume.text, textSha256: resume.text_sha256 },
      posting: {
        postingId: posting.posting_id, sitePostingId: posting.observed.sitePostingId, company: posting.observed.company,
        title: posting.observed.title, location: posting.observed.location, salaryRaw: posting.observed.salaryRaw,
        url: posting.observed.url, jdText: posting.observed.jdText,
      },
      roleFamily: roleFamilyForTask(task),
    });
  }

  async manualPreparation(owner: string, taskId: string, postingId: string) {
    const task = await this.taskRow(owner, taskId);
    if (!task.model_source?.connectionId) throw new ConflictException('此任务未绑定简历和模型，不能生成个性化备题。');
    const posting = await this.store.getTaskPosting(owner, postingId);
    if (!posting || posting.task_id !== task.id) throw new NotFoundException('岗位记录不存在。');
    const approved = await this.pool.query("SELECT 1 FROM app_career_batch_items WHERE task_posting_id=$1 UNION ALL SELECT 1 FROM app_career_contacts WHERE task_posting_id=$1 LIMIT 1", [posting.id]);
    if (approved.rows.length) throw new ConflictException('已批准岗位的备题会自动生成，无需手动触发。');
    const preparation = await this.store.ensurePreparation(owner, {
      id: crypto.randomUUID(), taskId: task.id, taskPostingId: posting.id, resumeVersionId: task.resume_version_id,
      resumeTextSha256: task.resume_text_sha256, jdSnapshotHash: posting.snapshot_hash,
      model: { connectionId: task.model_source.connectionId, label: task.model_source.label },
    });
    return this.preparationView(owner, preparation);
  }

  async getPreparation(owner: string, id: string) {
    return this.preparationView(owner, await this.preparationRow(owner, id));
  }

  async patchPreparation(owner: string, id: string, raw: unknown) {
    const input = personalizedPreparationPatchSchema.parse(raw);
    const row = await this.preparationRow(owner, id);
    if (row.status !== 'ready' || !row.edited) throw new ConflictException('备题尚未生成完成。');
    if (row.revision !== input.expectedRevision) throw new ConflictException('备题已更新，请重新读取。');
    const posting = await this.store.getTaskPosting(owner, row.task_posting_id);
    const resume = await this.store.getResumeVersion(owner, row.resume_version_id);
    if (!posting || !resume) throw new NotFoundException('备题来源资料已删除。');
    const sources = {
      postingSnapshotHash: row.jd_snapshot_hash, jdText: normalizeSourceText(posting.observed.jdText),
      resumeVersionId: resume.id, resumeTextHash: row.resume_text_sha256, resumeText: resume.text,
    };
    const byId = new Map(row.edited.questions.map(question => [question.id, question]));
    const questions: PersonalizedQuestion[] = input.questions.map(edited => {
      const original = byId.get(edited.id);
      if (!original) throw new BadRequestException('只能编辑本次备题中的题目。');
      validateEditedQuestionSources({ jdSources: edited.jdSources, basis: edited.basis }, sources);
      return { ...original, title: edited.title, text: edited.text, assessmentPoints: edited.assessmentPoints, referenceAnswerGuidance: edited.referenceAnswerGuidance, jdSources: edited.jdSources, basis: edited.basis };
    });
    if (new Set(questions.map(question => question.id)).size !== 10) throw new BadRequestException('备题必须保留十道题目。');
    const edited: PersonalizedPreparation = { ...row.edited, questions, revision: row.revision + 1 };
    const revision = await this.store.updatePreparationEdits(owner, row.id, input.expectedRevision, edited);
    return this.preparationView(owner, { ...row, edited, revision });
  }

  async retryPreparation(owner: string, id: string, raw: unknown) {
    const body = z.object({ requestId: z.uuid(), modelConnectionId: z.uuid().optional() }).parse(raw);
    const row = await this.preparationRow(owner, id);
    if (row.status !== 'failed') throw new ConflictException('只有失败的备题可以重试。');
    const model = body.modelConnectionId ? await this.models.describe(owner, body.modelConnectionId) : undefined;
    const prepared = await this.store.retryPreparation(owner, row.id, model ? { connectionId: model.id, label: model.model } : undefined);
    return this.preparationView(owner, prepared);
  }

  async exportPreparation(owner: string, id: string, format: string) {
    const row = await this.preparationRow(owner, id);
    const preparation = row.edited ?? row.original;
    if (!preparation) throw new ConflictException('备题尚未生成完成。');
    const posting = await this.store.getTaskPosting(owner, row.task_posting_id);
    if (format === 'json') {
      return { contentType: 'application/json', filename: `career-preparation-${id}.json`, body: JSON.stringify({ preparation, postingSnapshotHash: row.jd_snapshot_hash, resumeVersionId: row.resume_version_id, resumeTextSha256: row.resume_text_sha256, company: posting?.observed.company, title: posting?.observed.title }, null, 2) };
    }
    if (format !== 'markdown') throw new BadRequestException('导出格式只支持 markdown 或 json。');
    const lines = [
      `# ${posting?.observed.company ?? '岗位'} · ${posting?.observed.title ?? '备题'}`,
      '', `模型：${row.model.label} · 简历版本：${row.resume_version_id}`, `JD 摘要：${row.jd_snapshot_hash}`, `简历摘要：${row.resume_text_sha256}`, '',
    ];
    preparation.questions.forEach((question, index) => {
      lines.push(`## ${index + 1}. ${question.title}`, '', question.text, '', `- 目的：${question.purpose === 'jd_skill' ? 'JD 技能' : question.purpose === 'resume_project' ? '简历项目追问' : '缺口准备（不代表已有经历）'}`);
      lines.push('- 评估要点：', ...question.assessmentPoints.map(point => `  - ${point}`));
      lines.push('- 参考回答指导：', ...question.referenceAnswerGuidance.map(guidance => `  - ${guidance}`));
      lines.push('- JD 原文：', ...question.jdSources.map(source => `  > ${source.quote}`));
      if (question.basis.kind === 'resume_evidence') lines.push('- 简历原文：', ...question.basis.resumeSources.map(source => `  > ${source.quote}`));
      lines.push('');
    });
    if (preparation.uncertainties.length) lines.push('## 不确定性', ...preparation.uncertainties.map(item => `- ${item}`));
    return { contentType: 'text/markdown; charset=utf-8', filename: `career-preparation-${id}.md`, body: lines.join('\n') };
  }

  async savePreparationToBank(owner: string, id: string, raw: unknown) {
    const input = careerSaveToBankSchema.parse(raw);
    const row = await this.preparationRow(owner, id);
    const preparation = row.edited ?? row.original;
    if (!preparation) throw new ConflictException('备题尚未生成完成。');
    const task = await this.taskRow(owner, row.task_id);
    const roleFamily = roleFamilyForTask(task);
    const byId = new Map(preparation.questions.map(question => [question.id, question]));
    const questions: z.infer<typeof savePreparationSchema>['questions'] = input.questions.map(({ questionId, requestId }) => {
      const question = byId.get(questionId);
      if (!question) throw new BadRequestException('只能保存本次备题中的题目。');
      const requirement = preparation.requirements[question.requirementIndex] ?? preparation.requirements[0];
      if (!requirement) throw new ConflictException('备题缺少岗位要求来源。');
      const draft = preparedBankDraftSchema.parse({
        title: question.title, content: question.text, category: question.category, difficulty: question.difficulty,
        roleFamilies: [roleFamily], tags: ['BOSS备题', question.purpose],
        expectedAnswer: [...question.referenceAnswerGuidance.map(item => `- ${item}`), '', '评估要点', ...question.assessmentPoints.map(item => `- ${item}`)].join('\n'),
        jdRequirement: requirement,
        career: { kind: 'resume_jd', preparationId: row.id, postingSnapshotHash: row.jd_snapshot_hash, resumeVersionId: row.resume_version_id, resumeTextSha256: row.resume_text_sha256, jdSnapshotHash: row.jd_snapshot_hash, purpose: question.purpose },
      });
      return { requestId, draft };
    });
    return this.bank.createBatch(owner, { questions });
  }
}

@Controller('api/v1')
@UseFilters(new CareerErrorFilter())
export class CareerController {
  constructor(@Inject(CAREER) private readonly service: CareerService) {}

  @Get('career/boss/session')
  session(@Req() req: Request) {
    return this.service.session(ownerOf(req));
  }

  @Post('career/boss/session/open')
  openSession(@Req() req: Request) {
    return this.service.openSession(ownerOf(req));
  }

  @Post('career/boss/session/check')
  checkSession(@Req() req: Request) {
    return this.service.checkSession(ownerOf(req));
  }

  @Post('career/boss/session/observe-controls')
  observeControls(@Req() req:Request){return this.service.checkSession(ownerOf(req),true);}

  @Post('career/boss/session/inspect-resume')
  inspectSiteResume(@Req() req:Request,@Body() body:unknown){return this.service.inspectSiteResume(ownerOf(req),body);}

  @Delete('career/boss/session')
  clearSession(@Req() req: Request, @Body() body: unknown) {
    bossSessionClearSchema.parse(body);
    return this.service.clearSession(ownerOf(req));
  }

  @Post('career/tasks')
  createTask(@Req() req: Request, @Body() body: unknown) {
    return this.service.createTask(ownerOf(req), body);
  }

  @Get('career/tasks')
  listTasks(@Req() req: Request) {
    return this.service.listTasks(ownerOf(req));
  }

  @Get('career/tasks/:id')
  getTask(@Req() req: Request, @Param('id') id: string) {
    return this.service.getTask(ownerOf(req), uuidParam(id, '任务'));
  }

  @Get('career/tasks/:id/postings')
  listPostings(@Req() req: Request, @Param('id') id: string) {
    return this.service.listPostings(ownerOf(req), uuidParam(id, '任务'));
  }

  @Patch('career/tasks/:id/postings/:postingId')
  patchPosting(@Req() req: Request, @Param('id') id: string, @Param('postingId') postingId: string, @Body() body: unknown) {
    return this.service.patchPosting(ownerOf(req), uuidParam(id, '任务'), uuidParam(postingId, '岗位记录'), body);
  }

  @Post('career/tasks/:id/bind-resume')
  bindResume(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.bindResume(ownerOf(req), uuidParam(id, '任务'), body);
  }

  @Post('career/tasks/:id/postings/:postingId/reinspect')
  reinspectPosting(@Req() req:Request,@Param('id') id:string,@Param('postingId') postingId:string,@Body() body:unknown){return this.service.reinspectPosting(ownerOf(req),uuidParam(id,'任务'),uuidParam(postingId,'岗位'),body);}

  @Get('career/tasks/:id/contacts')
  listContacts(@Req() req:Request,@Param('id') id:string){return this.service.listContacts(ownerOf(req),uuidParam(id,'任务'));}
  @Post('career/tasks/:id/contacts/:contactId/retry')
  retryContact(@Req() req:Request,@Param('id') id:string,@Param('contactId') contactId:string,@Body() body:unknown){return this.service.retryContact(ownerOf(req),uuidParam(id,'任务'),uuidParam(contactId,'沟通记录'),body);}
  @Post('career/tasks/:id/contacts')
  approveContacts(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.service.approveContacts(ownerOf(req),uuidParam(id,'任务'),body);}

  @Post('career/tasks/:id/approve')
  approve(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.approve(ownerOf(req), uuidParam(id, '任务'), body);
  }

  @Post('career/tasks/:id/resume')
  resumeTask(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.resumeTask(ownerOf(req), uuidParam(id, '任务'), body);
  }

  @Post('career/tasks/:id/retry-generation')
  retryGeneration(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.retryGeneration(ownerOf(req), uuidParam(id, '任务'), body);
  }

  @Post('career/tasks/:id/cancel')
  cancelTask(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    careerCancelSchema.parse(body);
    return this.service.cancelTask(ownerOf(req), uuidParam(id, '任务'));
  }

  @Delete('career/tasks/:id')
  deleteTask(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    careerDeleteTaskSchema.parse(body);
    return this.service.deleteTask(ownerOf(req), uuidParam(id, '任务'));
  }

  @Post('career/tasks/:id/postings/:postingId/preparations')
  manualPreparation(@Req() req: Request, @Param('id') id: string, @Param('postingId') postingId: string) {
    return this.service.manualPreparation(ownerOf(req), uuidParam(id, '任务'), uuidParam(postingId, '岗位记录'));
  }

  @Get('career/batches/:id')
  batch(@Req() req: Request, @Param('id') id: string) {
    return this.service.batchView(ownerOf(req), uuidParam(id, '批次'));
  }

  @Post('career/batches/:id/resume')
  resumeBatch(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.resumeBatch(ownerOf(req), uuidParam(id, '批次'), body);
  }

  @Post('career/batches/:id/cancel')
  cancelBatch(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    careerCancelSchema.parse(body);
    return this.service.cancelBatch(ownerOf(req), uuidParam(id, '批次'));
  }

  @Post('career/batches/:id/items/:itemId/retry')
  retryItem(@Req() req: Request, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.service.retryItem(ownerOf(req), uuidParam(id, '批次'), uuidParam(itemId, '批次岗位'), body);
  }

  @Post('career/batches/:id/items/:itemId/reconcile')
  reconcileItem(@Req() req: Request, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    careerItemReconcileSchema.parse(body);
    return this.service.reconcileItem(ownerOf(req), uuidParam(id, '批次'), uuidParam(itemId, '批次岗位'));
  }

  @Post('career/batches/:id/items/:itemId/resume-attachment')
  resumeAttachment(@Req() req: Request, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.service.resumeAttachment(ownerOf(req), uuidParam(id, '批次'), uuidParam(itemId, '批次岗位'), body);
  }

  @Get('career/preparations/:id')
  getPreparation(@Req() req: Request, @Param('id') id: string) {
    return this.service.getPreparation(ownerOf(req), uuidParam(id, '备题'));
  }

  @Patch('career/preparations/:id')
  patchPreparation(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.patchPreparation(ownerOf(req), uuidParam(id, '备题'), body);
  }

  @Post('career/preparations/:id/retry')
  retryPreparation(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.retryPreparation(ownerOf(req), uuidParam(id, '备题'), body);
  }

  @Get('career/preparations/:id/export')
  async exportPreparation(@Req() req: Request, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const exported = await this.service.exportPreparation(ownerOf(req), uuidParam(id, '备题'), format ?? 'markdown');
    res.setHeader('content-type', exported.contentType);
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
    res.setHeader('cache-control', 'no-store');
    res.end(exported.body);
  }

  @Post('career/preparations/:id/save-to-bank')
  saveToBank(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.service.savePreparationToBank(ownerOf(req), uuidParam(id, '备题'), body);
  }
}
