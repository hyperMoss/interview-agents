import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerService } from '../apps/api/src/career';
import { CareerWorker } from '../apps/worker/src/career-worker';
import { BossBrowser } from '../apps/worker/src/boss-browser';
import { ResumeFileStore } from '../packages/career/src/storage';
import { digest, textSha256 } from '../packages/career/src/domain';
import type { ObservedPosting } from '../packages/contracts/src/career';
import { apiConfig, workerConfig } from './fixtures';
import { startBossFixture } from './boss-site-fixture';

const TEST_DATABASE = (process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite");
const MOLI = process.env.MOLI_EXECUTABLE ?? join(homedir(), '.local', 'bin', 'moli');
const suite = process.env.RUN_INTEGRATION === '1' && existsSync(MOLI) ? describe : describe.skip;

const policy = { roleTargets: ['fullstack'] as const, cities: ['广州'] as const, salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] };
const greeting = '您好，我在简历中说明了全栈项目中的接口与数据建模经历，希望进一步沟通这个岗位。';

// Recovery invariants at the real browser and durable-work boundaries:
// a dispatched-but-unobserved effect is never replayed, reconciliation is read-only, and repeated
// broad page failures pause the whole task. Synthetic fixture identities only.
suite('career recovery and external-effect fencing', () => {
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let dataDir: string;
  let browser: BossBrowser;
  let worker: CareerWorker;
  let api: CareerService;
  const owner = crypto.randomUUID();

  beforeAll(async () => {
    fixture = await startBossFixture();
    fixture.state.loggedIn = true;
    dataDir = await mkdtemp(join(tmpdir(), 'career-recovery-'));
    browser = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile, profileDirectory: join(dataDir, 'profile'),
      moliExecutable: MOLI, headedFallback: false,
    });
    const apiConf = { ...apiConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: 'http://127.0.0.1:9', CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli' as const };
    api = new CareerService(apiConf);
    worker = new CareerWorker(
      { ...workerConfig(), DATABASE_URL: TEST_DATABASE, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli', BOSS_MOLI_EXECUTABLE: MOLI, BOSS_HEADED_FALLBACK: 'off' },
      { browserFor: () => browser },
    );
  }, 120000);

  afterAll(async () => {
    await Promise.all([worker?.close(), api?.close()]);
    await browser?.close();
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 60000);

  const store = () => worker.store;
  const pool = () => worker.store.pool;

  async function runTicks(rounds = 12) {
    for (let index = 0; index < rounds; index += 1) {
      await worker.tick();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async function seedResume() {
    const files = new ResumeFileStore(dataDir);
    const text = '合成简历\n在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。';
    const bytes = Buffer.from(`${text}\n`, 'utf8');
    const stored = await files.put(owner, { bytes, extension: 'txt' });
    const upload = await store().createUpload(owner, { filename: 'synthetic-resume.txt', text, warnings: [], storageKey: stored.storageKey, sha256: stored.sha256, byteSize: stored.byteSize, contentType: 'text/plain' });
    return store().saveResumeVersion(owner, {
      requestId: crypto.randomUUID(), requestHash: digest({ kind: 'save-resume-version', stagingId: upload.id, label: '恢复测试简历', text }),
      stagingId: upload.id, label: '恢复测试简历', text,
      attachmentSha256: upload.sha256, byteSize: upload.byte_size, contentType: upload.content_type,
      originalName: upload.filename, storageKey: upload.storage_key, warnings: [], textSha256: textSha256(text),
    });
  }

  async function seedTask(resume: Awaited<ReturnType<typeof seedResume>>, taskPolicy: unknown) {
    return store().createTask(owner, {
      id: crypto.randomUUID(), resume, policy: taskPolicy, model: { connectionId: crypto.randomUUID(), label: 'fixture-model' },
      requestId: crypto.randomUUID(), requestHash: digest({ kind: 'create-career-task', resumeVersionId: resume.id, taskPolicy }),
    });
  }

  async function seedTaskAndBatch(input: { sitePostingId: string; title: string; company: string }) {
    const version = await seedResume();
    // Approval binds to the account and session generation observed on the explicitly opened page.
    const observedSession = await browser.openSession();
    await store().writeSession(owner, {
      state: observedSession.state, engine: observedSession.engine, accountMarker: observedSession.accountMarker,
      reason: observedSession.detail, humanWindow: observedSession.humanWindow, limitation: observedSession.limitation,
    });
    const task = await seedTask(version, policy);
    await pool().query("UPDATE app_career_work SET status='cancelled' WHERE task_id=$1 AND kind='scan'", [task.id]);
    await store().setTaskState(task.id, { phase: 'review' });
    const observed: ObservedPosting = {
      site: 'boss', sitePostingId: input.sitePostingId, url: fixture.profile.postingUrl(input.sitePostingId),
      title: input.title, company: input.company, location: '广州·天河', salaryRaw: '15-25K',
      jdText: '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用。',
      companyProfileText: '示例自研科技，自有研发团队，公司直招。', identitySource: 'detail_link',
      nativeFilterEvidence: { searchKey: '广州:fullstack', controls: [{ label: 'city', selected: '广州', url: fixture.origin }] },
    };
    const snapshotHash = digest(observed);
    const postingId = await store().upsertPosting(owner, observed);
    const taskPostingId = crypto.randomUUID();
    await store().upsertTaskPosting(owner, {
      id: taskPostingId, taskId: task.id, postingId, observed, snapshotHash, disposition: 'eligible',
      decision: { disposition: 'eligible', reasons: [{ code: 'role_matched', evidence: [] }], salary: { raw: '15-25K', status: 'monthly', currency: 'CNY', monthlyLowerCny: 15000, monthlyUpperCny: 25000, monthsPerYear: null }, blacklistMatches: [] },
      match: null, greeting: { text: greeting, factualClaims: [], uncertainties: [], modelAttribution: { kind: 'connection', connectionId: crypto.randomUUID(), model: 'fixture-model' } }, existingRevision: null,
    });
    const itemId = crypto.randomUUID();
    const current = await store().getTask(owner, task.id);
    const approved = await store().approve(owner, {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), taskId: task.id, expectedTaskRevision: current!.revision, resumeVersionId: version.id,
      items: [{ id: itemId, taskPostingId, postingSnapshotHash: snapshotHash, greetingDraftRevision: 0, finalGreeting: greeting, position: 0 }],
    });
    await pool().query("UPDATE app_career_work SET status='cancelled' WHERE task_id=$1 AND kind='preparation'", [task.id]);
    return { task, batch: approved.batch, itemId, version, postingId, snapshotHash, greeting };
  }

  it('turns a dispatched-but-unobserved greeting into unknown and never resends it', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-qualified-fullstack', title: '全栈工程师（AI 应用）', company: '示例自研科技' });
    const item = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    // Simulate an actor that committed intent and died before any receipt was written.
    await store().beginEffect({ owner, batchId: seeded.batch.id, itemId: seeded.itemId, phase: 'conversation', expectedRevision: item!.revision, from: 'not_started', to: 'dispatching', batchGeneration: 0 });
    await runTicks();
    const after = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(after?.conversation_state).toBe('unknown');
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-qualified-fullstack')).toHaveLength(0);
    await runTicks();
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-qualified-fullstack')).toHaveLength(0);
  }, 180000);

  it('reconciles an unknown attachment from durable site evidence without sending again', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-agent-shenzhen', title: 'Agent 开发工程师', company: '示例智能体公司' });
    await runTicks();
    const confirmed = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(confirmed?.conversation_state).toBe('confirmed');
    expect(confirmed?.attachment_state).toBe('confirmed');
    const siteReceipts = fixture.state.attachments.filter(item => item.postingId === 'fixture-agent-shenzhen');
    expect(siteReceipts).toHaveLength(1);
    // The worker recorded an unknown attachment after a dispatch whose receipt was lost.
    await pool().query("UPDATE app_career_batch_items SET attachment_state='unknown', revision=revision+1 WHERE id=$1", [seeded.itemId]);
    await pool().query("INSERT INTO app_career_effects(id,owner,batch_item_id,phase,attempt,intent_at,outcome,evidence) VALUES($1,$2,$3,'attachment',2,(strftime('%Y-%m-%dT%H:%M:%f000Z','now')),'unknown','[]')", [crypto.randomUUID(), owner, seeded.itemId]);
    await api.reconcileItem(owner, seeded.batch.id, seeded.itemId);
    await runTicks();
    const reconciled = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(reconciled?.attachment_state).toBe('confirmed');
    expect(fixture.state.attachments.filter(item => item.postingId === 'fixture-agent-shenzhen')).toHaveLength(1);
  }, 240000);

  it('reconciles the same approved attachment after a worker restart without sending again', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-blacklisted', title: '全栈工程师', company: '某某人才服务公司' });
    await runTicks();
    const item = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(item?.conversation_state).toBe('confirmed');
    expect(item?.attachment_state).toBe('confirmed');
    expect(fixture.state.attachments.filter(entry => entry.postingId === 'fixture-blacklisted')).toHaveLength(1);
    // Simulated worker restart: the owned browser process is gone but the private profile and the
    // site receipts persist, so a fresh actor must reconcile instead of sending again.
    await browser.close();
    const restarted = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile, profileDirectory: join(dataDir, 'profile'),
      moliExecutable: MOLI, headedFallback: false,
    });
    try {
      const observation = await restarted.reconcileEffect({
        postingUrl: fixture.profile.postingUrl('fixture-blacklisted'), sitePostingId: 'fixture-blacklisted',
        greeting: seeded.greeting, originalName: 'synthetic-resume.txt', originalSize: seeded.version.byte_size, sha256: seeded.version.attachment_sha256,
      });
      expect(observation.outcome).toBe('confirmed');
      expect(observation.reason).toBe('attachment_visible');
      expect(fixture.state.attachments.filter(entry => entry.postingId === 'fixture-blacklisted')).toHaveLength(1);
    } finally {
      await restarted.close();
    }
    await browser.ensureBrowser();
  }, 240000);

  it('does not promote an unknown attachment whose site receipt cannot be verified', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-corrupt-receipt', title: '全栈工程师', company: '示例回执公司' });
    await runTicks();
    const item = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(item?.conversation_state).toBe('confirmed');
    expect(item?.attachment_state).toBe('unknown');
    const sent = fixture.state.attachments.filter(entry => entry.postingId === 'fixture-corrupt-receipt').length;
    expect(sent).toBe(1);
    await api.reconcileItem(owner, seeded.batch.id, seeded.itemId);
    await runTicks();
    expect((await store().batchItem(owner, seeded.batch.id, seeded.itemId))?.attachment_state).toBe('unknown');
    expect(fixture.state.attachments.filter(entry => entry.postingId === 'fixture-corrupt-receipt').length).toBe(sent);
  }, 240000);

  it('never initiates a conversation during read-only reconciliation', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-sales-agent', title: 'AI Agent 销售顾问', company: '示例销售公司' });
    const before = fixture.state.messages.filter(message => message.postingId === 'fixture-sales-agent').length;
    await pool().query("UPDATE app_career_batch_items SET conversation_state='unknown', revision=revision+1 WHERE id=$1", [seeded.itemId]);
    await api.reconcileItem(owner, seeded.batch.id, seeded.itemId);
    await runTicks();
    const reconciled = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(reconciled?.conversation_state).toBe('unknown');
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-sales-agent').length).toBe(before);
  }, 240000);

  it('does not replay unknown effects on an explicit batch resume and requires a ready session', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-unknown-send', title: 'Agent 平台工程师', company: '示例自研平台' });
    await runTicks();
    const item = await store().batchItem(owner, seeded.batch.id, seeded.itemId);
    expect(item?.conversation_state).toBe('unknown');
    const sends = fixture.state.messages.filter(message => message.postingId === 'fixture-unknown-send').length;
    expect(sends).toBe(1);
    await store().writeSession(owner, { state: 'login_required', reason: '需要登录' });
    await expect(api.resumeBatch(owner, seeded.batch.id, { requestId: crypto.randomUUID(), expectedRevision: 0 })).rejects.toThrow();
    await store().setBatchState(seeded.batch.id, 'paused', 'login_required');
    await store().writeSession(owner, { state: 'ready', reason: null });
    const resumed = await api.resumeBatch(owner, seeded.batch.id, { requestId: crypto.randomUUID(), expectedRevision: 0 });
    expect(resumed.state).toBe('delivering');
    await runTicks();
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-unknown-send').length).toBe(sends);
  }, 180000);

  it('pauses the whole task after three consecutive broad search failures', async () => {
    const version = await seedResume();
    const task = await seedTask(version, policy);
    fixture.state.failSearch = true;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await worker.tick();
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const paused = await store().getTask(owner, task.id);
    expect(paused?.status).toBe('paused');
    expect(paused?.pause_reason).toBe('page_failures');
    expect(paused?.page_failure_count).toBeGreaterThanOrEqual(3);
    fixture.state.failSearch = false;
  }, 180000);

  it('fails the task instead of reaching review when the search reads no postings', async () => {
    const version = await seedResume();
    const task = await seedTask(version, { ...policy, cities: ['广州'], roleTargets: ['agent_development'] });
    await runTicks();
    const failed = await store().getTask(owner, task.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error ?? '').toContain('没有读取到任何岗位');
    expect(await store().countTaskPostings(task.id)).toBe(0);
  }, 240000);

  it('enforces the frozen approval revision when resuming a paused batch', async () => {
    const seeded = await seedTaskAndBatch({ sitePostingId: 'fixture-unknown-employment', title: '全栈工程师', company: '示例未知关系公司' });
    await store().setBatchState(seeded.batch.id, 'paused', 'login_required');
    await store().writeSession(owner, { state: 'ready', reason: null });
    await expect(api.resumeBatch(owner, seeded.batch.id, { requestId: crypto.randomUUID(), expectedRevision: seeded.batch.task_revision + 1 })).rejects.toThrow();
    const resumed = await api.resumeBatch(owner, seeded.batch.id, { requestId: crypto.randomUUID(), expectedRevision: seeded.batch.task_revision });
    expect(resumed.state).toBe('delivering');
    await api.cancelBatch(owner, seeded.batch.id);
    expect((await store().batch(owner, seeded.batch.id))?.state).toBe('cancelled');
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-unknown-employment')).toHaveLength(0);
  }, 240000);

  it('refuses to admit work when the browser profile is no longer owned or the lease moved on', async () => {
    await browser.ensureBrowser();
    expect(() => browser.assertOwned()).not.toThrow();
    await browser.closeBrowser();
    expect(() => browser.assertOwned()).toThrow('SESSION_OWNERSHIP');
    const work = await store().claimWork(['purge']);
    if (work) {
      expect(await store().workStillOwned(work.id, work.lease_generation)).toBe(true);
      await pool().query("UPDATE app_career_work SET lease_generation=lease_generation+1 WHERE id=$1", [work.id]);
      expect(await store().workStillOwned(work.id, work.lease_generation)).toBe(false);
      await store().finishWork(work.id, work.lease_generation + 1, 'completed');
    }
  }, 120000);
});
