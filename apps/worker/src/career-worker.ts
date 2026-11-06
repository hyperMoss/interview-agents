import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { WorkerConfig } from '../../../packages/config/src/index';
import { CareerStore, CareerConflict, type BatchItemRow, type BatchRow, type EffectIntent, type ResumeRow, type SessionRow, type TaskRow, type WorkRow } from '../../../packages/career/src/store';
import { BrowserProfileStore, ResumeFileStore, careerDataDir } from '../../../packages/career/src/storage';
import { advanceTaskPhase, deliveryAuthorized, digest, matchReceiptWorkId, normalizeSourceText, sessionPauseReason, settleBatch, shouldPauseForPageFailures, uuidFromHash } from '../../../packages/career/src/domain';
import { evaluatePosting } from '../../../packages/career/src/filters';
import { validateMatchReceipt, type CareerGenerationSources } from '../../../packages/career/src/provenance';
import { CAREER_MAX_POSTINGS, careerMatchReceiptSchema, careerPolicySchema, type CareerMatchReceipt, type ObservedPosting } from '../../../packages/contracts/src/career';
import { personalizedPreparationSchema, type PersonalizedPreparationInput } from '../../../packages/contracts/src/preparation';
import { BossBrowser, BrowserUnavailable, worksBossProfile, type EffectGuard, type ObservedSession } from './boss-browser';
import { openDatabase } from '../../../packages/database/src/client';

// Career worker: reconciles durable career_work rows against the owned local browser and the Agent.
// SQLite is the truth; BullMQ only nudges. External effects are never retried blindly.

export type CareerAgentClient = {
  match(input: { ownerId: string; workId: string; generation: number; modelConnectionId: string; policy: unknown; sources: CareerGenerationSources }): Promise<unknown>;
  prepare(input: { ownerId: string; workId: string; generation: number; modelConnectionId: string; input: PersonalizedPreparationInput }): Promise<unknown>;
  purgeReceipt(workId: string): Promise<boolean>;
};

export type CareerWorkerOptions = {
  browserFor?: (owner: string) => BossBrowser;
  agent?: CareerAgentClient;
  fileStore?: ResumeFileStore;
  profiles?: BrowserProfileStore;
  /** Test injection only; production keeps the bounded 120 second work lease. */
  leaseSeconds?: number;
};

class CareerWorkRetry extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Codes that mean "the site did not prove this read": both pause the task as `native_filter_unverified`, so the
 *  task state names the missing evidence instead of reporting a retryable page failure. */
export function isProofPause(error: unknown) {
  return error instanceof BrowserUnavailable && (error.code === 'NATIVE_FILTER_UNVERIFIED' || error.code === 'SITE_PROOF_UNVERIFIED');
}

/**
 * How the scan loop must react to one detail-read failure. A site block or a missing proof stops the whole scan
 * immediately — the reserved identity keeps its slot — and only an ordinary page-read failure is counted toward
 * the page-failure streak. `stop` means no further card may be read.
 */
export async function reactToDetailFailure(input: {
  error: unknown;
  pauseSession: () => Promise<void>;
  /** Persists the explicit missing-proof pause; reservations are never refunded here. */
  pauseProof: (detail: string) => Promise<void>;
  /** Counts one broad page-read failure and reports whether the streak itself paused the task. */
  countPageFailure: () => Promise<boolean>;
}): Promise<'stop' | 'continue'> {
  if (input.error instanceof BrowserUnavailable && input.error.code === 'SESSION_PAUSED') {
    await input.pauseSession();
    return 'stop';
  }
  if (isProofPause(input.error)) {
    await input.pauseProof(input.error instanceof Error ? input.error.message : '站点未提供可确认的响应证据。');
    return 'stop';
  }
  return (await input.countPageFailure()) ? 'stop' : 'continue';
}

// The task-posting id and the Agent match receipt id share this deterministic mapping.
export { uuidFromHash };

function sessionState(observed: ObservedSession) {
  if (observed.state === 'ready') return 'ready' as const;
  if (observed.state === 'login_required') return 'login_required' as const;
  if (observed.state === 'verification_required') return 'verification_required' as const;
  if (observed.state === 'restricted') return 'restricted' as const;
  if (observed.state === 'absent') return 'absent' as const;
  return 'unavailable' as const;
}

export class CareerWorker {
  readonly database;
  readonly store: CareerStore;
  readonly fileStore: ResumeFileStore;
  readonly profiles: BrowserProfileStore;
  private readonly browsers = new Map<string, BossBrowser>();
  private busy = false;

  constructor(readonly config: WorkerConfig, readonly options: CareerWorkerOptions = {}) {
    this.database = openDatabase(config.DATABASE_URL);
    this.store = new CareerStore(this.database.pool);
    this.fileStore = options.fileStore ?? new ResumeFileStore(careerDataDir(config));
    this.profiles = options.profiles ?? new BrowserProfileStore(careerDataDir(config));
  }

  private agent(): CareerAgentClient {
    if (this.options.agent) return this.options.agent;
    const headers = { authorization: `Bearer ${this.config.INTERNAL_SERVICE_TOKEN}`, 'content-type': 'application/json' };
    return {
      match: async input => {
        const response = await fetch(`${this.config.AGENT_URL}/internal/v1/career/match`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`AGENT_MATCH_${response.status}`);
        return response.json();
      },
      prepare: async input => {
        const response = await fetch(`${this.config.AGENT_URL}/internal/v1/career/preparations/generate`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`AGENT_PREPARATION_${response.status}`);
        return response.json();
      },
      purgeReceipt: async workId => {
        const response = await fetch(`${this.config.AGENT_URL}/internal/v1/career/receipts/${workId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) });
        return response.ok;
      },
    };
  }

  private async browserFor(owner: string) {
    const existing = this.browsers.get(owner);
    if (existing) return existing;
    if (this.options.browserFor) {
      const injected = this.options.browserFor(owner);
      this.browsers.set(owner, injected);
      return injected;
    }
    const directory = await this.profiles.prepare(owner, this.config.BOSS_BROWSER_ENGINE);
    const browser = new BossBrowser({
      engine: this.config.BOSS_BROWSER_ENGINE,
      origin: this.config.BOSS_SITE_ORIGIN,
      profile: worksBossProfile(this.config.BOSS_SITE_ORIGIN),
      profileDirectory: directory,
      moliExecutable: this.config.BOSS_MOLI_EXECUTABLE,
      headedFallback: this.config.BOSS_HEADED_FALLBACK === 'on',
    });
    this.browsers.set(owner, browser);
    return browser;
  }

  private get leaseSeconds() {
    return this.options.leaseSeconds ?? 120;
  }

  /** Renews the owned lease while a long scan or browser operation runs. Losing it closes this
   *  actor's browser at once, so a stale worker cannot take the next click. */
  private async renewOwnedLease(work: WorkRow) {
    if (await this.store.renewLease(work.id, work.lease_generation, this.leaseSeconds)) return;
    await this.browsers.get(work.owner)?.closeBrowser().catch(() => {});
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const work = await this.store.claimWork(['scan', 'delivery', 'preparation', 'session', 'purge'], this.leaseSeconds, this.config.BOSS_AUTOMATION);
      if (!work) {
        // Expiry does not wait for another upload from that owner: the idle queue reconciles a
        // bounded batch of expired staging originals and their purge work every tick.
        await this.store.expireStagedUploads();
        return;
      }
      let renewing = false;
      const heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void this.renewOwnedLease(work).finally(() => { renewing = false; });
      }, Math.max(250, Math.round(this.leaseSeconds * 1000 / 3)));
      try {
        if (work.kind === 'scan') await this.runScan(work);
        else if (work.kind === 'delivery') await this.runDelivery(work);
        else if (work.kind === 'preparation') await this.runPreparation(work);
        else if (work.kind === 'session') await this.runSession(work);
        else await this.runPurge(work);
        await this.store.finishWork(work.id, work.lease_generation, 'completed');
      } catch (error) {
        if (error instanceof CareerWorkRetry) {
          // Cleanup retries back off so one unreachable receipt cannot starve the queue.
          const retryDelaySeconds = work.kind === 'purge' ? Math.min(300, 10 * work.attempts) : 0;
          await this.store.holdWork(work.id, work.lease_generation, error.message, retryDelaySeconds);
          return;
        }
        if (error instanceof BrowserUnavailable) {
          const paused = await this.pauseForBrowser(work, error);
          if (paused && work.kind === 'session' && (work.payload.inspectResumeName || work.payload.captureControls || work.payload.inspectCompanyPostingId)) {
            await this.store.finishWork(work.id,work.lease_generation,'failed',error.message.slice(0,300));
          } else if (paused) await this.store.finishWork(work.id, work.lease_generation, 'completed');
          else await this.store.holdWork(work.id, work.lease_generation, error.code);
          return;
        }
        const message = error instanceof Error ? error.message.slice(0, 300) : 'UNKNOWN';
        // A failed work row must leave its task in an honest, recoverable state instead of a silent active phase.
        if (work.task_id && work.kind !== 'purge' && work.kind !== 'session') {
          await this.store.setTaskState(work.task_id, { status: 'failed', error: `本步执行失败：${message}。已保留输入，可重试生成；不会外发任何内容。`, incrementRevision: true });
        }
        await this.store.finishWork(work.id, work.lease_generation, 'failed', message);
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.busy = false;
    }
  }

  private async pauseForBrowser(work: WorkRow, error: BrowserUnavailable) {
    if(error.detail.companyControls){const directory=join(careerDataDir(this.config),'observations',digest(work.owner).slice(0,32));await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'company-controls.json'),JSON.stringify(error.detail.companyControls),{mode:0o600});}

    const reason = isProofPause(error)
      ? 'native_filter_unverified' as const
      : error.detail.pauseReason ?? 'browser_unavailable' as const;
    // A page-level block is the observed session state, so the session row says the same thing the task does.
    if (error.code === 'SESSION_PAUSED') {
      const state = error.detail.pauseReason === 'login_required' ? 'login_required' as const
        : error.detail.pauseReason === 'verification_required' ? 'verification_required' as const : 'restricted' as const;
      await this.store.writeSession(work.owner, { state, reason: error.message.slice(0, 300) });
    }
    if (work.task_id) await this.store.setTaskState(work.task_id, { status: 'paused', pauseReason: reason, pauseDetail: error.message.slice(0, 300) });
    if (work.batch_id) await this.store.setBatchState(work.batch_id, 'paused', reason);
    return true;
  }

  private async persistSession(owner: string, taskId: string | null, observed: ObservedSession) {
    // A different driver starts a new session generation: an approval frozen under the old engine can
    // never act through the new one, so it is revoked instead of quietly continuing.
    const current = await this.store.session(owner);
    if (current && current.engine !== observed.engine) await this.store.switchSessionEngine(owner, observed.engine);
    return this.store.writeSession(owner, {
      state: sessionState(observed), engine: observed.engine, reason: observed.detail,
      accountMarker: observed.accountMarker, activeTaskId: taskId, humanWindow: observed.humanWindow, limitation: observed.limitation,
    });
  }

  /** Pauses the whole task/batch when the owned browser is not logged in or the site blocks automation. */
  private async requireReadySession(owner: string, taskId: string | null, batchId: string | null) {
    const browser = await this.browserFor(owner);
    const observed = await browser.inspectSession();
    await this.persistSession(owner, taskId, observed);
    const pause = sessionPauseReason(observed.state, observed.detail);
    if (!pause) return null;
    if (taskId) await this.store.setTaskState(taskId, { status: 'paused', pauseReason: pause.reason, pauseDetail: pause.detail });
    if (batchId) await this.store.setBatchState(batchId, 'paused', pause.reason);
    return pause;
  }

  // ---------- scan ----------
  private async runScan(work: WorkRow) {
    if (!work.task_id) throw new Error('SCAN_TASK_MISSING');
    let task = await this.store.taskForWork(work.task_id);
    if (!task) return;
    if (task.status === 'cancelled' || task.status === 'paused' || task.status === 'failed') return;
    if (task.phase === 'queued') task = (await this.store.setTaskState(task.id, { phase: advanceTaskPhase('queued', 'searching') })) ?? task;
    const pause = await this.requireReadySession(task.owner, task.id, null);
    if (pause) return;
    const browser = await this.browserFor(task.owner);
    const session = await this.store.session(task.owner);
    // Every observation of this scan is scoped to this owner, task revision and session generation, so a
    // response captured under another scan, task or session can never be accepted.
    const scanScope = { owner: task.owner, taskRevision: task.revision, sessionGeneration: session?.profile_generation ?? 0 };
    const seen = new Set<string>();
    // Each search's cards are read while that search is still the page's current one: the browser streams one
    // search at a time, so a detail read never depends on a later city/role leaving the earlier cards listed.
    try {
      const current = await this.store.taskForWork(task.id);
      let readCount = current?.read_count ?? 0;
      scan: for await (const batch of browser.searchPostings(task.policy, CAREER_MAX_POSTINGS, scanScope)) {
        // The list read itself succeeded, so the page-failure streak is reset for this search.
        await this.store.recordPageFailure(task.id, true);
        for (const card of batch.cards) {
          if (!card.sitePostingId || seen.has(card.sitePostingId)) continue;
          if (readCount >= CAREER_MAX_POSTINGS) break scan;
          // The exact evidence of the search that produced this card travels with it, so no posting is ever
          // attributed to a filter set that did not return it.
          const postingId = await this.store.upsertPosting(task.owner, {
            site: 'boss', sitePostingId: card.sitePostingId, url: card.url, title: card.title || '未命名岗位',
            company: card.company || '未识别公司', location: card.location, salaryRaw: card.salary || '面议',
            jdText: '', companyProfileText: '', identitySource: 'detail_link',
            nativeFilterEvidence: { ...batch.evidence },
          });
          if (await this.store.taskPostingByTaskAndPosting(task.id, postingId)) continue;
          // The distinct identity is reserved before any opening and never refunded, so a failure or an unknown
          // read still counts against the same identity and a repeat cannot spend a second reservation.
          const reservation = browser.reserveDetailRead(card.sitePostingId);
          if (!reservation.ok) {
            if (reservation.reason === 'already_reserved') continue;
            break scan;
          }
          seen.add(card.sitePostingId);
          // The durable read slot is reserved before the detail read, so the shared 30-posting budget covers
          // every search of this scan.
          const slot = await this.store.addReadSlot(task.id);
          if (slot === null) break scan;
          readCount = slot;
          const application = await this.store.applicationState(task.owner, postingId);
          let observed: ObservedPosting;
          try {
            observed = await browser.readPosting(card, batch.evidence);
            await this.store.recordPageFailure(task.id, true);
          } catch (error) {
            // A site block or a missing response proof is not a per-posting extraction failure: it stops the
            // whole scan instead of being swallowed, counted, or reset by the next successful read. The reserved
            // identity keeps its slot either way.
            const reaction = await reactToDetailFailure({
              error,
              pauseSession: async () => {
                await this.pauseForBrowser(work, error as BrowserUnavailable);
              },
              pauseProof: async detail => {
                await this.store.setTaskState(task.id, { status: 'paused', pauseReason: 'native_filter_unverified', pauseDetail: detail.slice(0, 300) });
              },
              countPageFailure: async () => {
                const failures = await this.store.recordPageFailure(task.id, false);
                if (!shouldPauseForPageFailures(failures)) return false;
                await this.store.setTaskState(task.id, { status: 'paused', pauseReason: 'page_failures', pauseDetail: `连续 ${failures} 次岗位详情读取失败。` });
                return true;
              },
            });
            if (reaction === 'stop') return;
            continue;
          }
          const decision = evaluatePosting({ policy: task.policy, posting: observed, duplicate: application ? 'already_contacted' : null });
          const snapshotHash = digest(observed);
          let match = null;
          let greeting = null;
          if (decision.disposition === 'eligible' && task.model_source?.connectionId) {
            const matched = await this.matchPosting(task, observed, snapshotHash, work);
            // The source was deleted or this actor lost the work between reading the card and the
            // provider call: nothing is dispatched and no snapshot may revive the personal posting.
            if (!matched) return;
            match = matched.receipt.match;
            greeting = matched.receipt.greeting;
          }
          const committed = await this.store.upsertTaskPosting(task.owner, {
            id: uuidFromHash(digest({ task: task.id, posting: postingId })), taskId: task.id, postingId, observed, snapshotHash,
            disposition: decision.disposition, decision, match, greeting, existingRevision: null,
          });
          // A late match never recreates a personal posting snapshot for a deleted or cancelled task.
          if (committed === null) return;
        }
      }
      // The search read proved which page this session now holds, so a stale unreadable state is replaced
      // by the session the work just used.
      await this.persistSession(task.owner, task.id, await browser.inspectSession());
    } catch (error) {
      await this.recordPageFailureAndPause(work, task, error);
      return;
    }
    // An empty search is a failure, not a successful task: surface it instead of reaching review with nothing read.
    if ((await this.store.countTaskPostings(task.id)) === 0) {
      await this.store.setTaskState(task.id, { status: 'failed', error: '本次搜索没有读取到任何岗位。请确认本机 BOSS 会话可正常读取搜索结果与筛选控件，然后重试生成。', incrementRevision: true });
      return;
    }
    await this.store.setTaskState(task.id, { phase: advanceTaskPhase('searching', 'matching') });
    await this.store.setTaskState(task.id, { phase: advanceTaskPhase('matching', 'review'), incrementRevision: true });
  }

  private async recordPageFailureAndPause(work: WorkRow, task: TaskRow, error: unknown) {
    if (isProofPause(error)) {
      await this.store.setTaskState(task.id, { status: 'paused', pauseReason: 'native_filter_unverified', pauseDetail: error instanceof Error ? error.message.slice(0, 300) : '' });
      return;
    }
    // A detected site restriction immediately pauses the task; it is never retried as a page failure.
    if (error instanceof BrowserUnavailable && error.code === 'SESSION_PAUSED') {
      await this.pauseForBrowser(work, error);
      return;
    }
    const failures = await this.store.recordPageFailure(task.id, false);
    if (shouldPauseForPageFailures(failures)) {
      await this.store.setTaskState(task.id, { status: 'paused', pauseReason: 'page_failures', pauseDetail: `连续 ${failures} 次页面读取失败。` });
      return;
    }
    // Retry the same search only through the durable work row; the threshold above bounds the retries.
    throw new CareerWorkRetry(error instanceof Error ? error.message.slice(0, 200) : 'PAGE_READ_FAILED');
  }

  private async matchPosting(task: TaskRow, observed: ObservedPosting, snapshotHash: string, work: WorkRow): Promise<{ receipt: CareerMatchReceipt } | null> {
    if (!task.model_source?.connectionId) throw new Error('TASK_HAS_NO_MODEL');
    const resume = await this.store.getResumeVersion(task.owner, task.resume_version_id);
    if (!resume) throw new Error('RESUME_VERSION_MISSING');
    const receiptWorkId = matchReceiptWorkId(work.id, observed.sitePostingId);
    // Persisted before the provider call: cleanup collects this receipt key even when the first match
    // never commits a snapshot, and a deleting source refuses the registration so nothing dispatches.
    if (!(await this.store.registerMatchAttempt({ workId: work.id, leaseGeneration: work.lease_generation, receiptWorkId, sitePostingId: observed.sitePostingId }))) return null;
    const sources: CareerGenerationSources = {
      postingSnapshotHash: snapshotHash, jdText: normalizeSourceText(observed.jdText),
      resumeVersionId: resume.id, resumeTextHash: task.resume_text_sha256, resumeText: resume.text,
    };
    const response = await this.agent().match({
      ownerId: task.owner, workId: receiptWorkId, generation: 0,
      modelConnectionId: task.model_source.connectionId, policy: careerPolicySchema.parse(task.policy), sources,
    });
    const receipt = validateMatchReceipt(sources, careerMatchReceiptSchema.parse(response));
    return { receipt };
  }

  /** Admission check shared by every external step: the worker must still own the DB lease and the
   *  private browser profile. Losing either stops admission and closes the owned page/process
   *  instead of surfacing a spurious browser failure for work another actor now owns. */
  private async admit(work: WorkRow, browser: BossBrowser) {
    if (!(await this.store.workStillOwned(work.id, work.lease_generation))) {
      await browser.closeBrowser().catch(() => {});
      return false;
    }
    try {
      browser.assertOwned();
    } catch {
      await browser.closeBrowser().catch(() => {});
      return false;
    }
    return true;
  }

  /** The batch's frozen approval session versus the session observed right now. */
  private sessionMatches(batch: BatchRow, session: SessionRow | null) {
    return deliveryAuthorized(
      { sessionGeneration: batch.session_generation, accountMarker: batch.account_marker },
      session ? { profileGeneration: session.profile_generation, accountMarker: session.account_marker } : null,
    );
  }

  /** R2: a reset or another account revokes the unstarted delivery and requires a new approval. */
  private async requireApprovedSession(owner: string, batch: BatchRow) {
    if (this.sessionMatches(batch, await this.store.session(owner))) return true;
    await this.store.revokeBatchDelivery(owner, batch.id);
    return false;
  }

  /** Persisted authority of this exact actor, consulted between external steps. */
  private effectGuard(work: WorkRow): EffectGuard {
    return {
      stillAllowed: async () => {
        if (!(await this.store.workStillOwned(work.id, work.lease_generation))) return false;
        if (!work.batch_id) return true;
        const [batch, session] = await Promise.all([this.store.batch(work.owner, work.batch_id), this.store.session(work.owner)]);
        if (!batch || batch.state === 'cancelled' || batch.state === 'paused') return false;
        // Clearing or a lost login/reset withdraws the session authority immediately, before the
        // serial session work can run its browser cleanup.
        if (session?.state !== 'ready') return false;
        return this.sessionMatches(batch, session);
      },
    };
  }

  /** Pre-dispatch intent for this exact batch. A posting re-reserved by a newer batch is refused
   *  instead of failing the task: the stale item simply has no external effect left to take. */
  private async beginOwnedEffect(input: EffectIntent) {
    try {
      return await this.store.beginEffect(input);
    } catch (error) {
      if (error instanceof CareerConflict && error.code === 'RESERVATION_REPLACED') return null;
      throw error;
    }
  }

  /** R7: unverified live controls never perform an external mutation. A human observation of the real
   *  site is the prerequisite; the fixture profile is marked verified for synthetic acceptance only. */
  private async requireVerifiedSite(task: TaskRow, batch: BatchRow, browser: BossBrowser) {
    if (browser.mutationsAllowed) return true;
    const detail = '真实 BOSS 站点的沟通与附件控件尚未通过人工观察验证，已在发起沟通前阻止外发。请先在真实页面完成一次人工观察并以证据更新站点配置。';
    await this.store.setTaskState(task.id, { status: 'paused', pauseReason: 'browser_unavailable', pauseDetail: detail });
    await this.store.setBatchState(batch.id, 'paused', 'browser_unavailable');
    return false;
  }

  private async runPresetContact(work:WorkRow){
    if(!['enabled','contact'].includes(this.config.BOSS_AUTOMATION))throw new CareerWorkRetry('CONTACT_MODE_DISABLED');
    const payload=z.strictObject({action:z.literal('site_preset'),contactId:z.uuid()}).parse(work.payload);
    const contact=await this.store.contact(work.owner,payload.contactId);
    if(!contact||!['queued','dispatching'].includes(contact.state))return;
    if(contact.task_id!==work.task_id)throw new Error('CONTACT_TARGET_MISMATCH');
    if(contact.state==='dispatching'){
      await this.store.settleContact(work,contact,{state:'unknown',reason:'worker_interrupted',evidence:[{observedAt:new Date().toISOString(),url:contact.posting_snapshot.url,summary:'此前点击执行者中断，结果保持未知，不重试。'}]});return;
    }
    const browser=await this.browserFor(work.owner);
    if(await this.requireReadySession(work.owner,contact.task_id,null)){
      await this.store.settleContact(work,contact,{state:'failed',reason:'session_not_ready',evidence:[]});return;
    }
    if(!(await this.admit(work,browser)))return;
    if(!(await this.store.beginContact(work,contact))){
      await this.store.settleContact(work,contact,{state:'failed',reason:'approval_session_changed',evidence:[]});return;
    }
    const guard:EffectGuard={stillAllowed:async()=>{
      if(!(await this.store.workStillOwned(work.id,work.lease_generation)))return false;
      const [current,task,session]=await Promise.all([this.store.contact(work.owner,contact.id),this.store.taskForWork(contact.task_id),this.store.session(work.owner)]);
      return current?.state==='dispatching'&&task?.status==='active'&&session?.state==='ready'&&session.profile_generation===contact.session_generation&&session.account_marker===contact.account_marker;
    }};
    let result:Awaited<ReturnType<BossBrowser['clickPresetGreeting']>>;
    try{result=await browser.clickPresetGreeting({postingUrl:contact.posting_snapshot.url,sitePostingId:contact.posting_snapshot.sitePostingId},guard);}
    catch(error){
      await this.store.settleContact(work,contact,{state:'unknown',reason:'actor_interrupted',evidence:[{observedAt:new Date().toISOString(),url:contact.posting_snapshot.url,summary:'点击执行者异常退出，结果保持未知，不自动重试。'}]});
      if(error instanceof BrowserUnavailable)await this.pauseForBrowser(work,error);return;
    }
    if(result.session)await this.persistSession(work.owner,contact.task_id,result.session);
    await this.store.settleContact(work,contact,result);
    if(result.state==='failed')await this.store.finishWork(work.id,work.lease_generation,'failed',result.reason);
    else if(result.state==='unknown')await this.store.finishWork(work.id,work.lease_generation,'completed',result.reason);
  }

  // ---------- delivery ----------
  private async runDelivery(work: WorkRow) {
    if(work.payload.action==='site_preset'){await this.runPresetContact(work);return;}

    if (!work.batch_id || !work.batch_item_id) throw new Error('DELIVERY_TARGET_MISSING');
    const action = z.object({ action: z.enum(['deliver', 'reconcile', 'attachment']).default('deliver') }).parse(work.payload).action;
    if (action === 'reconcile') { await this.runReconcile(work); return; }
    const batch = await this.store.batch(work.owner, work.batch_id);
    if (!batch) return;
    if (batch.state === 'cancelled') return;
    const item = await this.store.batchItem(work.owner, work.batch_id, work.batch_item_id);
    if (!item) return;
    if (batch.state === 'paused') return;
    const task = await this.store.taskForWork(batch.task_id);
    if (!task || task.status === 'cancelled') return;
    // A clear marks the session 'clearing' before its work runs: admit nothing while the reset is in flight.
    const currentSession = await this.store.session(work.owner);
    if (!currentSession || currentSession.state === 'clearing') return;
    const pause = await this.requireReadySession(work.owner, task.id, batch.id);
    if (pause) return;
    if (!(await this.requireApprovedSession(work.owner, batch))) return;
    const browser = await this.browserFor(work.owner);
    if (!(await this.requireVerifiedSite(task, batch, browser))) return;
    const resume = await this.store.getResumeVersion(work.owner, batch.resume_version_id);
    if (!resume) throw new Error('RESUME_VERSION_MISSING');
    const mayContinue = await this.deliverConversation(work, batch.id, item, task, browser);
    if (!mayContinue) return;
    const refreshed = await this.store.batchItem(work.owner, work.batch_id, work.batch_item_id);
    if (refreshed) await this.deliverAttachment(work, batch.id, refreshed, task, browser, resume, batch.original_name ?? resume.original_name);
    await this.settleBatchState(work.owner, batch.id);
  }

  private async deliverConversation(work: WorkRow, batchId: string, item: BatchItemRow, task: TaskRow, browser: BossBrowser): Promise<boolean> {
    if (item.conversation_state === 'confirmed' || item.conversation_state === 'unknown' || item.conversation_state === 'failed') return true;
    if (item.conversation_state === 'dispatching') {
      const open = await this.store.effects(item.id);
      const dispatching = open.find(effect => effect.phase === 'conversation' && effect.outcome === 'dispatching');
      if (dispatching) {
        await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'conversation', attempt: dispatching.attempt, outcome: 'unknown', reason: 'worker_interrupted', evidence: [{ observedAt: new Date().toISOString(), url: '', summary: '执行者中断后未观察到结果，不做自动重试。' }], expectedRevision: item.revision });
      }
      return true;
    }
    const posting = await this.store.getTaskPosting(work.owner, item.task_posting_id);
    if (!posting) return false;
    if (posting.snapshot_hash !== item.snapshot_hash) {
      await this.store.setItemStates(work.owner, item.id, { conversation: 'failed' });
      return true;
    }
    if (!(await this.admit(work, browser))) return false;
    const begun = await this.beginOwnedEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'conversation', expectedRevision: item.revision, from: 'not_started', to: 'dispatching', batchGeneration: 0 });
    if (!begun) return false;
    const observation = await browser.initiateConversation({ postingUrl: posting.observed.url, sitePostingId: posting.observed.sitePostingId, greeting: item.greeting, effectId: item.id }, this.effectGuard(work));
    // A stopped actor must never commit a receipt: cancellation already settled its intent as unknown.
    if (observation.stopped) {
      if (await this.store.workStillOwned(work.id, work.lease_generation)) {
        const outcome = observation.outcome === 'unknown' ? 'unknown' as const : 'failed' as const;
        await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'conversation', attempt: begun.attempt, outcome, reason: observation.reason, evidence: observation.evidence, expectedRevision: item.revision + 1 });
        await this.store.setApplicationState(work.owner, item.posting_id, outcome === 'unknown' ? 'unknown' : 'conversation_failed');
      }
      return false;
    }
    // A stale actor must never commit a receipt: the dispatch stays unknown for the next owner.
    if (!(await this.admit(work, browser))) return false;
    if (observation.outcome === 'pause_session') {
      if (observation.session) await this.persistSession(work.owner, task.id, observation.session);
      await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'conversation', attempt: begun.attempt, outcome: 'unknown', reason: observation.reason ?? 'pause_session', evidence: observation.evidence, expectedRevision: item.revision + 1 });
      await this.store.setBatchState(batchId, 'paused', observation.session ? sessionPauseReason(observation.session.state, observation.session.detail)?.reason ?? 'login_required' : 'login_required');
      return true;
    }
    const recorded = observation.outcome === 'awaiting_consent' ? ('unknown' as const) : observation.outcome;
    await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'conversation', attempt: begun.attempt, outcome: recorded, reason: observation.reason, evidence: observation.evidence, expectedRevision: item.revision + 1 });
    if (observation.outcome === 'awaiting_consent') {
      // The site needs recipient consent before the attachment; keep that state separate from the
      // unconfirmed greeting instead of reporting the item as fully applied.
      await this.store.setItemStates(work.owner, item.id, { attachment: 'awaiting_consent' });
    }
    if (recorded === 'confirmed') await this.store.setApplicationState(work.owner, item.posting_id, 'conversation_confirmed');
    else if (recorded === 'unknown') await this.store.setApplicationState(work.owner, item.posting_id, observation.outcome === 'awaiting_consent' ? 'awaiting_consent' : 'unknown');
    else await this.store.setApplicationState(work.owner, item.posting_id, 'conversation_failed');
    return true;
  }

  private async deliverAttachment(work: WorkRow, batchId: string, item: BatchItemRow, task: TaskRow, browser: BossBrowser, resume: ResumeRow, originalName: string) {
    if (item.conversation_state !== 'confirmed' || item.attachment_state === 'confirmed' || item.attachment_state === 'unknown' || item.attachment_state === 'failed') return;
    if (item.attachment_state === 'awaiting_consent') return;
    if (item.attachment_state === 'dispatching') {
      const open = await this.store.effects(item.id);
      const dispatching = open.find(effect => effect.phase === 'attachment' && effect.outcome === 'dispatching');
      if (dispatching) {
        await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'attachment', attempt: dispatching.attempt, outcome: 'unknown', reason: 'worker_interrupted', evidence: [{ observedAt: new Date().toISOString(), url: '', summary: '附件发送执行者中断，未观察到结果。' }], expectedRevision: item.revision });
      }
      return;
    }
    const posting = await this.store.getTaskPosting(work.owner, item.task_posting_id);
    if (!posting) return;
    if (!(await this.admit(work, browser))) return;
    const path = await this.fileStore.localPath(work.owner, resume.storage_key);
    const begun = await this.beginOwnedEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'attachment', expectedRevision: item.revision, from: item.attachment_state, to: 'dispatching', batchGeneration: 0 });
    if (!begun) return;
    const observation = await browser.sendOriginalResume({ postingUrl: posting.observed.url, sitePostingId: posting.observed.sitePostingId, filePath: path, originalName, sha256: resume.attachment_sha256, byteSize: resume.byte_size }, this.effectGuard(work));
    // A stopped actor must never commit a receipt: cancellation already settled its intent as unknown.
    if (observation.stopped) {
      if (await this.store.workStillOwned(work.id, work.lease_generation)) {
        const outcome = observation.outcome === 'unknown' ? 'unknown' as const : 'failed' as const;
        await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'attachment', attempt: begun.attempt, outcome, reason: observation.reason, evidence: observation.evidence, expectedRevision: item.revision + 1 });
        await this.store.setApplicationState(work.owner, item.posting_id, outcome === 'unknown' ? 'unknown' : 'attachment_failed');
      }
      return;
    }
    if (!(await this.admit(work, browser))) return;
    if (observation.outcome === 'pause_session') {
      if (observation.session) await this.persistSession(work.owner, task.id, observation.session);
      await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'attachment', attempt: begun.attempt, outcome: 'unknown', reason: observation.reason ?? 'pause_session', evidence: observation.evidence, expectedRevision: item.revision + 1 });
      await this.store.setBatchState(batchId, 'paused', observation.session ? sessionPauseReason(observation.session.state, observation.session.detail)?.reason ?? 'login_required' : 'login_required');
      return;
    }
    const recorded = observation.outcome;
    await this.store.recordEffect({ owner: work.owner, batchId, itemId: item.id, phase: 'attachment', attempt: begun.attempt, outcome: recorded, reason: observation.reason, evidence: observation.evidence, expectedRevision: item.revision + 1 });
    if (observation.outcome === 'confirmed') await this.store.setApplicationState(work.owner, item.posting_id, 'attachment_confirmed');
    else if (observation.outcome === 'awaiting_consent') await this.store.setApplicationState(work.owner, item.posting_id, 'awaiting_consent');
    else await this.store.setApplicationState(work.owner, item.posting_id, observation.outcome === 'unknown' ? 'unknown' : 'attachment_failed');
  }

  /** Read-only reconciliation of an unknown or consent-pending effect. It never sends and never
   *  guesses: only durable site evidence can promote an unknown outcome. */
  private async runReconcile(work: WorkRow) {
    if (!work.batch_id || !work.batch_item_id) throw new Error('DELIVERY_TARGET_MISSING');
    const item = await this.store.batchItem(work.owner, work.batch_id, work.batch_item_id);
    const batch = await this.store.batch(work.owner, work.batch_id);
    if (!item || !batch) return;
    if (batch.state === 'cancelled') return;
    // Read-only evidence is still only meaningful for the account the batch was approved under.
    if (!this.sessionMatches(batch, await this.store.session(work.owner))) {
      await this.store.revokeBatchDelivery(work.owner, batch.id);
      return;
    }
    const posting = await this.store.getTaskPosting(work.owner, item.task_posting_id);
    const resume = await this.store.getResumeVersion(work.owner, batch.resume_version_id);
    if (!posting) return;
    const browser = await this.browserFor(work.owner);
    if (!(await this.admit(work, browser))) return;
    const observation = await browser.reconcileEffect({ postingUrl: posting.observed.url, sitePostingId: posting.observed.sitePostingId, greeting: item.greeting, originalName: batch.original_name ?? '', originalSize: resume?.byte_size ?? 0, sha256: resume?.attachment_sha256 ?? batch.attachment_sha256 });
    if (observation.outcome === 'unknown' || observation.outcome === 'pause_session') return;
    const evidence = observation.evidence;
    if (item.conversation_state === 'unknown') {
      if (observation.reason === 'no_conversation') {
        await this.store.promoteEffect({ owner: work.owner, batchId: batch.id, itemId: item.id, phase: 'conversation', outcome: 'failed', reason: 'reconciled_no_conversation', evidence });
      } else {
        await this.store.promoteEffect({ owner: work.owner, batchId: batch.id, itemId: item.id, phase: 'conversation', outcome: 'confirmed', reason: 'reconciled_conversation', evidence });
      }
    }
    const refreshed = await this.store.batchItem(work.owner, batch.id, item.id);
    if (refreshed?.conversation_state === 'confirmed' && (refreshed.attachment_state === 'unknown' || refreshed.attachment_state === 'awaiting_consent')) {
      if (observation.reason === 'attachment_visible') {
        await this.store.promoteEffect({ owner: work.owner, batchId: batch.id, itemId: item.id, phase: 'attachment', outcome: 'confirmed', reason: 'reconciled_attachment', evidence });
        await this.store.setApplicationState(work.owner, item.posting_id, 'attachment_confirmed');
      }
    }
    await this.settleBatchState(work.owner, batch.id);
  }

  private async settleBatchState(owner: string, batchId: string) {
    const batch = await this.store.batch(owner, batchId);
    if (!batch || batch.state === 'cancelled' || batch.state === 'paused') return;
    const items = await this.store.batchItems(owner, batchId);
    const state = settleBatch(items.map(item => ({ conversation: item.conversation_state, attachment: item.attachment_state })));
    await this.store.setBatchState(batchId, state);
  }

  // ---------- preparation ----------
  private async runPreparation(work: WorkRow) {
    if (!work.preparation_id) throw new Error('PREPARATION_MISSING');
    const preparation = await this.store.preparation(work.owner, work.preparation_id);
    if (!preparation || preparation.status === 'cancelled' || preparation.status === 'ready') return;
    const task = await this.store.taskForWork(preparation.task_id);
    const posting = await this.store.getTaskPosting(work.owner, preparation.task_posting_id);
    const resume = await this.store.getResumeVersion(work.owner, preparation.resume_version_id);
    if (!task || !posting || !resume) {
      await this.store.setPreparationStatus(preparation.id, 'failed', '来源资料已删除，无法生成备题。');
      return;
    }
    await this.store.setPreparationStatus(preparation.id, 'generating');
    const jdText = normalizeSourceText(posting.observed.jdText);
    if (jdText.length < 20) {
      await this.store.setPreparationStatus(preparation.id, 'failed', '岗位描述不足以生成个性化备题。');
      return;
    }
    if (jdText.length > 12000) {
      await this.store.setPreparationStatus(preparation.id, 'failed', '岗位描述超过 12000 字上限，未截断；请人工处理该岗位后重试备题。');
      return;
    }
    const input: PersonalizedPreparationInput = {
      kind: 'resume_jd', role: posting.observed.title.slice(0, 120), roleFamily: task.policy.roleTargets.includes('fullstack') ? 'fullstack' : 'general',
      roleTarget: task.policy.roleTargets.includes('fullstack') ? 'fullstack' : 'agent_development',
      candidateLevel: 'experienced', round: 'first', roleType: 'technical', questionCount: 10,
      resume: { versionId: resume.id, textHash: preparation.resume_text_sha256, text: resume.text },
      jd: { snapshotHash: preparation.jd_snapshot_hash, text: jdText },
    };
    const sources: CareerGenerationSources = {
      postingSnapshotHash: preparation.jd_snapshot_hash, jdText, resumeVersionId: resume.id,
      resumeTextHash: preparation.resume_text_sha256, resumeText: resume.text,
    };
    try {
      const response = await this.agent().prepare({ ownerId: work.owner, workId: work.id, generation: preparation.generation, modelConnectionId: preparation.model.connectionId, input });
      const result = personalizedPreparationSchema.parse(response);
      if (result.sourceHashes.resume !== sources.resumeTextHash || result.sourceHashes.jd !== sources.postingSnapshotHash) throw new Error('PREPARATION_SOURCE_MISMATCH');
      await this.store.savePreparation(preparation.id, preparation.generation, result, result);
    } catch (error) {
      await this.store.setPreparationStatus(preparation.id, 'failed', error instanceof Error ? error.message.slice(0, 300) : '备题生成失败');
    }
  }

  // ---------- session and purge ----------
  private async runSession(work: WorkRow) {
    const {action,captureControls,inspectResumeName,inspectCompanyPostingId}=z.object({inspectCompanyPostingId:z.uuid().optional(),inspectResumeName:z.string().trim().min(1).max(80).optional(),action:z.enum(['open','check','clear']),captureControls:z.boolean().default(false)}).parse(work.payload);
    const browser = await this.browserFor(work.owner);
    if (action === 'clear') {
      await browser.clearSession();
      await this.profiles.remove(work.owner);
      this.browsers.delete(work.owner);
      await this.store.bumpSessionGeneration(work.owner);
      return;
    }
    // The owner's explicit check is the only read that may lift a latched pause; automated readiness
    // checks elsewhere use the read-only `inspectSession`.
    const observed = action === 'open' ? await browser.openSession() : await browser.checkSession();
    // A check that never launched the browser owns no profile lease to assert.
    if (browser.ownsProfile) browser.assertOwned();
    await this.persistSession(work.owner, work.task_id, observed);
    if(inspectCompanyPostingId){
      if(!['enabled','contact','search'].includes(this.config.BOSS_AUTOMATION))throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','当前模式不允许重读岗位。');
      const posting=await this.store.getTaskPosting(work.owner,inspectCompanyPostingId);
      if(!posting||posting.task_id!==work.task_id)throw new Error('POSTING_NOT_FOUND');
      const task=await this.store.taskForWork(posting.task_id);
      if(!task||task.model_source||task.status!=='active'||task.phase!=='review')throw new Error('PREVIEW_NOT_REVIEWABLE');
      const directory=join(careerDataDir(this.config),'observations',digest(work.owner).slice(0,32));
      await mkdir(directory,{recursive:true,mode:0o700});
      await writeFile(join(directory,`${posting.id}-${posting.snapshot_hash}-prior.json`),JSON.stringify(posting.observed),{mode:0o600});
      const data=posting.observed;
      const refreshed=await browser.readPosting({sitePostingId:data.sitePostingId,url:data.url,title:data.title,company:data.company,location:data.location,salary:data.salaryRaw},data.nativeFilterEvidence);
      if(!(await this.admit(work,browser)))return;
      const application=await this.store.applicationState(work.owner,posting.posting_id);
      const decision=evaluatePosting({policy:task.policy,posting:refreshed,duplicate:application?'already_contacted':null});
      await this.store.replacePreviewObservation(work.owner,{workId:work.id,leaseGeneration:work.lease_generation,taskId:task.id,postingId:posting.id,expectedRevision:posting.revision,observed:refreshed,decision});
      await this.persistSession(work.owner,task.id,await browser.inspectSession());
    }
    if(inspectResumeName){
      if(observed.state!=='ready')throw new BrowserUnavailable('SESSION_PAGE_NOT_READY','登录未就绪，未打开简历页。');
      const evidence=await browser.observeSiteResume(inspectResumeName);
      await this.persistSession(work.owner,work.task_id,await browser.inspectSession());
      const directory=join(careerDataDir(this.config),'observations',digest(work.owner).slice(0,32));
      await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'resume-controls.json'),JSON.stringify(evidence,null,2),{mode:0o600});
    }
    if(captureControls){const evidence=await browser.observeControls();const directory=join(careerDataDir(this.config),'observations',digest(work.owner).slice(0,32));await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,'controls.json'),JSON.stringify(evidence,null,2),{mode:0o600});}
  }

  private async runPurge(work: WorkRow) {
    const payload = z.object({ storageKeys: z.array(z.string()).max(50).default([]), workIds: z.array(z.uuid()).max(200).default([]), uploadIds: z.array(z.uuid()).max(50).default([]), quiesce: z.boolean().default(false) }).parse(work.payload);
    // Private original bytes are only deleted after the exact owner's browser actor is gone.
    if (payload.quiesce) await this.quiesceOwner(work.owner);
    const failed: string[] = [];
    for (const key of payload.storageKeys) {
      // A key that saved or staged personal data still references is never removed.
      if (await this.store.storageKeyInUse(work.owner, key)) continue;
      try { await this.fileStore.remove(key); } catch { failed.push('storage'); }
    }
    for (const id of payload.workIds) {
      let removed = false;
      try { removed = await this.agent().purgeReceipt(id); } catch { removed = false; }
      if (!removed) failed.push(`receipt:${id}`);
    }
    // Deleting a receipt writes the Agent tombstone that fences a late provider response, so an
    // unconfirmed deletion must stay queued for retry instead of reporting a completed cleanup.
    if (failed.length) throw new CareerWorkRetry(`PURGE_INCOMPLETE:${failed.length}`);
    // Confirmed cleanup: the expired staging rows no longer keep their extracted personal text.
    await this.store.clearExpiredUploads(payload.uploadIds);
  }

  /** Closes and forgets this owner's local browser so its private files are released. */
  private async quiesceOwner(owner: string) {
    const browser = this.browsers.get(owner);
    if (!browser) return;
    this.browsers.delete(owner);
    await browser.close().catch(() => {});
  }

  async close() {
    for (const browser of this.browsers.values()) await browser.close();
    this.browsers.clear();
    await this.database.pool.end();
  }
}
