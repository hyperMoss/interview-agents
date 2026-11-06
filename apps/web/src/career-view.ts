import { z } from 'zod';
import {
  CAREER_MAX_BATCH_ITEMS, careerAttachmentStateSchema, careerBatchStateSchema, careerConversationStateSchema, careerDispositionSchema,
  careerPauseReasonSchema, careerReasonCodeSchema, type BossSessionView, type CareerBatchItemView, type CareerDecision,
  type CareerEvidence, type CareerTaskPostingView, type CareerTaskState,
} from '../../../packages/contracts/src/career';
import type { PersonalizedPreparation, PersonalizedQuestion } from '../../../packages/contracts/src/preparation';

// Enum types are derived from the shared schemas; the contracts file does not re-export every alias.
export type CareerDisposition = z.infer<typeof careerDispositionSchema>;
export type CareerReasonCode = z.infer<typeof careerReasonCodeSchema>;
export type CareerPauseReason = z.infer<typeof careerPauseReasonSchema>;
export type CareerConversationState = z.infer<typeof careerConversationStateSchema>;
export type CareerAttachmentState = z.infer<typeof careerAttachmentStateSchema>;
export type CareerBatchState = z.infer<typeof careerBatchStateSchema>;

// Presentation-only helpers for the local BOSS career UI. Eligibility, salary parsing and approval
// authority stay on the server; nothing here decides whether a posting may be approved.

export const dispositionLabels: Record<CareerDisposition, string> = { eligible: '可投递', needs_review: '需复核', excluded: '已排除' };
export const reasonLabels: Record<CareerReasonCode, string> = {
  role_matched: '岗位方向匹配', role_mismatch: '岗位方向不符', role_ambiguous: '岗位方向不明确',
  city_matched: '城市匹配', city_mismatch: '城市不符', location_ambiguous: '地点需人工确认',
  salary_qualified: '月薪上限达标', salary_below_minimum: '月薪上限低于 18K', salary_needs_review: '薪资需人工核对',
  company_blacklisted: '命中公司黑名单关键词', employment_direct: '已确认公司直招', employment_outsourcing: '明确外包/派遣', employment_intermediary: '明确猎头/招聘中介（不符合直招规则）',
  employment_unknown: '雇佣关系未知', identity_missing: '缺少稳定岗位编号', identity_conflict: '岗位编号冲突',
  duplicate_posting: '重复岗位', already_contacted: '之前已联系或已确认附件', owner_review_direct: '你已复核为直招',
  owner_review_excluded: '你已复核排除',
};
export const phaseLabels: Record<CareerTaskState['phase'], string> = { queued: '排队中', searching: '读取岗位', matching: '匹配中', review: '待你复核' };
export const pauseLabels: Record<CareerPauseReason, string> = {
  login_required: '需要在本机浏览器登录', verification_required: '需要在本机完成人机验证', site_restricted: '站点限制当前操作',
  page_failures: '连续读取页面失败', browser_unavailable: '本机浏览器不可用', native_filter_unverified: '原生筛选未能确认生效',
  model_unavailable: '模型调用失败',
};
export const sessionStateLabels: Record<BossSessionView['state'], string> = {
  absent: '未打开', starting: '正在启动', login_required: '需要登录', verification_required: '需要人机验证',
  ready: '已就绪', restricted: '站点受限', unavailable: '不可用', clearing: '正在清除',
};
export const engineLabels: Record<BossSessionView['engine'], string> = {
  patchright: 'Patchright 驱动本机 Chrome（有头持久会话）',
  moli: 'Moli 1.1.19（无窗口引擎）', playwright: 'Playwright 有头浏览器（已披露回退）',
};
export const batchStateLabels: Record<CareerBatchState, string> = {
  approved: '已批准，等待投递', delivering: '正在投递', paused: '已暂停', completed: '已完成',
  completed_with_review: '完成，部分项需核对', cancelled: '已取消',
};
export const conversationStateLabels: Record<CareerConversationState, string> = {
  not_started: '未发起沟通', dispatching: '正在发起沟通', confirmed: '沟通已确认', failed: '沟通已证明未发生', unknown: '沟通结果未知',
};
export const attachmentStateLabels: Record<CareerAttachmentState, string> = {
  blocked_by_conversation: '等待沟通确认', not_started: '未发送附件', awaiting_consent: '等待对方同意接收简历',
  dispatching: '正在发送附件', confirmed: '附件已确认送达', failed: '附件发送已证明未发生', unknown: '附件结果未知',
};
export type PreparationStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'cancelled';
export const preparationStatusLabels: Record<PreparationStatus, string> = {
  queued: '备题排队中', generating: '正在生成备题', ready: '备题已生成', failed: '备题生成失败', cancelled: '备题已取消',
};
export const purposeLabels: Record<PersonalizedQuestion['purpose'], string> = {
  jd_skill: 'JD 技能', resume_project: '简历项目追问', skill_gap: '缺口准备（不代表已有经历）',
};
export const gapBasisLabel = '准备题，不代表已有经历';

export type CareerSourceField = CareerEvidence['field'];
export const fieldLabels: Record<CareerSourceField, string> = {
  title: '标题', company: '公司', location: '地点', salary: '薪资', jd: 'JD 原文', employment: '雇佣关系说明', link: '岗位链接',
};

export function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

export function formatSalary(decision: CareerDecision) {
  const salary = decision.salary;
  if (salary.status === 'negotiable') return `${salary.raw}（面议，需人工核对）`;
  if (salary.status === 'non_monthly') return `${salary.raw}（非月薪口径，需人工核对）`;
  if (salary.status === 'unknown') return `${salary.raw}（薪资口径未识别，需人工核对）`;
  const lower = salary.monthlyLowerCny;
  const upper = salary.monthlyUpperCny;
  const range = lower !== null && upper !== null && lower !== upper ? `${lower}–${upper} 元/月` : `${lower ?? upper ?? 0} 元/月`;
  return `${salary.raw}（${range}${salary.monthsPerYear ? ` · ${salary.monthsPerYear} 薪计入元数据` : ''}）`;
}

export type PostingGroupKey = 'eligible' | 'needs_review' | 'excluded' | 'contacted';

export function hasReason(posting: CareerTaskPostingView, code: CareerReasonCode) {
  return posting.decision.reasons.some(reason => reason.code === code);
}

export function postingGroup(posting: CareerTaskPostingView): PostingGroupKey {
  if (hasReason(posting, 'already_contacted')) return 'contacted';
  return posting.decision.disposition;
}

export function groupPostings(postings: CareerTaskPostingView[]): Record<PostingGroupKey, CareerTaskPostingView[]> {
  const groups: Record<PostingGroupKey, CareerTaskPostingView[]> = { eligible: [], needs_review: [], excluded: [], contacted: [] };
  for (const posting of postings) groups[postingGroup(posting)].push(posting);
  return groups;
}

/** Grounded ordering key mirrored for display only: required coverage, gaps, preferred coverage, AI, id. */
export function matchCoverage(posting: CareerTaskPostingView) {
  const match = posting.match;
  if (!match) return null;
  const required = match.assessments.filter(assessment => assessment.priority === 'required');
  const preferred = match.assessments.filter(assessment => assessment.priority === 'preferred');
  const supported = (list: typeof required) => list.filter(assessment => assessment.kind === 'supported').length;
  return {
    requiredSupport: `${supported(required)}/${required.length}`,
    requiredGaps: required.filter(assessment => assessment.kind === 'gap').length,
    preferredSupport: preferred.length ? `${supported(preferred)}/${preferred.length}` : '无加分项要求',
  };
}

export function greetingProblem(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 10) return '招呼语至少需要 10 个字符。';
  if (trimmed.length > 1200) return '招呼语不能超过 1200 个字符。';
  return null;
}

export type ApprovalComposition = {
  selected: CareerTaskPostingView[];
  greetings: Record<string, string>;
  resumeVersionId: string | null;
  session: BossSessionView | undefined;
};

/** UI affordances over server-owned dispositions. The API re-validates every item at approval. */
export function approvalBlockers({ selected, greetings, resumeVersionId, session }: ApprovalComposition): string[] {
  const blockers: string[] = [];
  if(session?.automationMode&&session.automationMode!=='enabled')blockers.push('自动投递未启用，不能批准外发。');
  if (!selected.length) blockers.push('至少选择一个可投递岗位。');
  if (selected.length > CAREER_MAX_BATCH_ITEMS) blockers.push(`一批最多 ${CAREER_MAX_BATCH_ITEMS} 个岗位，当前选了 ${selected.length} 个。`);
  if (selected.some(posting => posting.decision.disposition !== 'eligible')) blockers.push('所选岗位里包含需复核或已排除的记录，只能批准可投递岗位。');
  if (!resumeVersionId) blockers.push('先选择本任务固定的简历版本。');
  for (const posting of selected) {
    const text = greetings[posting.id] ?? posting.greeting?.text ?? '';
    const problem = greetingProblem(text);
    if (problem) blockers.push(`「${posting.observed.company} · ${posting.observed.title}」：${problem}`);
  }
  if (session?.state === 'clearing') blockers.push('BOSS 会话正在清除，不能批准新的外发。');
  return blockers;
}

export function approvalWarnings({ selected, session }: Pick<ApprovalComposition, 'selected' | 'session'>): string[] {
  const warnings: string[] = [];
  if (selected.length && session?.state !== 'ready') warnings.push('本机 BOSS 会话尚未确认就绪。批准后批次会先暂停，登录并检查会话后再手动恢复。');
  if (selected.some(posting => !posting.match)) warnings.push('部分岗位缺少模型匹配结果：硬条件仍然有效，但不会展示匹配依据。');
  return warnings;
}

export function approvalItems(selected: CareerTaskPostingView[], greetings: Record<string, string>) {
  return selected.map(posting => ({
    taskPostingId: posting.id,
    postingSnapshotHash: posting.snapshotHash,
    greetingDraftRevision: posting.greetingRevision,
    finalGreeting: (greetings[posting.id] ?? posting.greeting?.text ?? '').trim(),
  }));
}

export type BatchItemAction = 'retry_conversation' | 'retry_attachment' | 'reconcile' | 'resume_attachment';

/** Which explicit phase action the UI may offer for one frozen item. Never a global retry. */
export function batchItemActions(item: CareerBatchItemView, batchState: CareerBatchState): BatchItemAction[] {
  if (batchState === 'cancelled') return [];
  const actions: BatchItemAction[] = [];
  if (item.conversation.state === 'failed') actions.push('retry_conversation');
  if (['unknown', 'awaiting_consent'].includes(item.conversation.state) || ['unknown', 'awaiting_consent'].includes(item.attachment.state)) actions.push('reconcile');
  if (item.conversation.state === 'confirmed' && (item.attachment.state === 'awaiting_consent' || item.attachment.state === 'not_started')) actions.push('resume_attachment');
  if (item.conversation.state === 'confirmed' && item.attachment.state === 'failed') actions.push('retry_attachment');
  return actions;
}

export const actionLabels: Record<BatchItemAction, string> = {
  retry_conversation: '重试发起沟通（已证明未发生）', retry_attachment: '重试发送附件（不重复招呼语）',
  reconcile: '只读核对站点结果', resume_attachment: '继续发送已批准的原始附件',
};

/** Per-phase outcome counts. Completion never waits for preparation and never hides an unknown. */
export function batchOutcome(batch: { state: CareerBatchState; items: CareerBatchItemView[]; pauseReason: CareerPauseReason | null }) {
  const count = (states: string[], pick: (item: CareerBatchItemView) => string) => batch.items.filter(item => states.includes(pick(item))).length;
  return {
    conversations: {
      confirmed: count(['confirmed'], item => item.conversation.state),
      awaiting: count(['dispatching'], item => item.conversation.state),
      failed: count(['failed'], item => item.conversation.state),
      unknown: count(['unknown'], item => item.conversation.state),
      pending: count(['not_started'], item => item.conversation.state),
    },
    attachments: {
      confirmed: count(['confirmed'], item => item.attachment.state),
      awaiting: count(['awaiting_consent', 'dispatching'], item => item.attachment.state),
      failed: count(['failed'], item => item.attachment.state),
      unknown: count(['unknown'], item => item.attachment.state),
      pending: count(['not_started', 'blocked_by_conversation'], item => item.attachment.state),
    },
    pauseLabel: batch.pauseReason ? pauseLabels[batch.pauseReason] : null,
  };
}

export function sessionGuidance(session: BossSessionView) {
  const hostWindow = session.humanWindow === 'open';
  switch (session.state) {
    case 'absent': return { tone: 'action' as const, hostWindow, text: '尚未打开本机 BOSS 会话。点“打开 BOSS 登录/验证”，在出现的本机浏览器窗口完成登录。' };
    case 'starting': return { tone: 'action' as const, hostWindow, text: '正在启动本机专用浏览器与私有会话目录，请稍候。' };
    case 'login_required': return hostWindow
      ? { tone: 'action' as const, hostWindow, text: '请在本机弹出的浏览器窗口完成扫码或账号登录，然后点“我已完成，检查会话”。' }
      : { tone: 'blocked' as const, hostWindow, text: '当前引擎没有可操作窗口，需要人工登录。请改用已披露的有头 Playwright 回退后再打开会话。' };
    case 'verification_required': return hostWindow
      ? { tone: 'action' as const, hostWindow, text: '站点要求人机验证。请在本机浏览器窗口完成验证，然后点“我已完成，检查会话”。' }
      : { tone: 'blocked' as const, hostWindow, text: '人机验证需要在本机浏览器窗口完成，当前引擎没有窗口。' };
    case 'ready': return { tone: 'ready' as const, hostWindow, text: '会话已就绪。搜索、审批与外发仍由你手动触发。' };
    case 'restricted': return { tone: 'blocked' as const, hostWindow, text: '站点限制了当前账号或网络的操作，应用不会尝试绕过。请稍后重新检查，或清除会话重来。' };
    case 'unavailable': return { tone: 'blocked' as const, hostWindow, text: '本机浏览器不可用。请检查浏览器安装、私有目录权限与显示环境后重新打开会话。' };
    case 'clearing': return { tone: 'action' as const, hostWindow, text: '正在停止本机浏览器并清理私有会话目录，完成后需要重新登录。' };
  }
}

export function taskWarning(task: { state: CareerTaskState; readCount: number; shortlistCount: number }) {
  if (task.state.status === 'paused') return `任务已暂停：${pauseLabels[task.state.reason]}。${task.state.detail}`;
  if (task.state.status === 'failed') return `任务失败：${task.state.error}`;
  if (task.state.status === 'cancelled') return '任务已取消，不再读取岗位。';
  if (task.state.phase === 'review' && task.readCount === 0) return '本次没有读到任何岗位。这不是“没有符合条件的岗位”，而是站点或原生筛选没有返回可读结果。';
  if (task.state.phase === 'review' && task.shortlistCount === 0) return '本次读到的岗位都不满足硬条件或需要复核。所有记录仍然可见。';
  return null;
}

export function preparationSummary(preparation: PersonalizedPreparation | null) {
  if (!preparation) return null;
  return {
    requirements: preparation.requirements.length,
    questions: preparation.questions.length,
    purposes: (['jd_skill', 'resume_project', 'skill_gap'] as const).map(purpose => ({ purpose, label: purposeLabels[purpose], count: preparation.questions.filter(question => question.purpose === purpose).length })),
    uncertainties: preparation.uncertainties,
    model: preparation.model.label,
    revision: preparation.revision,
  };
}
