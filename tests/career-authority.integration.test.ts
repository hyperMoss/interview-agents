import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerService } from '../apps/api/src/career';
import { CareerWorker } from '../apps/worker/src/career-worker';
import { BossBrowser, accountMarkerFor, liveBossProfile } from '../apps/worker/src/boss-browser';
import { ResumeFileStore } from '../packages/career/src/storage';
import { digest, textSha256 } from '../packages/career/src/domain';
import { evaluatePosting } from '../packages/career/src/filters';
import { careerPolicySchema, type CareerPolicy, type ObservedPosting } from '../packages/contracts/src/career';
import type { WorkerConfig } from '../packages/config/src/index';
import { apiConfig, workerConfig } from './fixtures';
import { fixturePostings, startBossFixture } from './boss-site-fixture';

const TEST_DATABASE = (process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite");
const MOLI = process.env.MOLI_EXECUTABLE ?? join(homedir(), '.local', 'bin', 'moli');
const suite = process.env.RUN_INTEGRATION === '1' && existsSync(MOLI) ? describe : describe.skip;

// Actor authority at the real browser boundary: the approved session generation/account, the
// durable work lease and cancellation must stop the exact actor before its next external step.
// Synthetic fixture identities only; no real BOSS login, filter, receipt or send is claimed.
const policy: CareerPolicy = careerPolicySchema.parse({
  roleTargets: ['fullstack', 'agent_development'], cities: ['广州', '深圳'], salaryUpperMinCnyMonthly: 18000,
  preferAiApplication: true, companyBlacklistKeywords: [],
});
const greeting = '您好，我在简历中说明了全栈项目中的接口与数据建模经历，希望进一步沟通这个岗位。';

suite('career actor authority against the synthetic BOSS site', () => {
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let dataDir: string;
  let api: CareerService;
  let worker: CareerWorker;
  /** Short-lease worker proves renewal; the default worker keeps the 120s production lease. */
  let shortLeaseWorker: CareerWorker;
  let workerEnv: WorkerConfig;
  const browsers = new Map<string, BossBrowser>();
  const owners: string[] = [];

  beforeAll(async () => {
    fixture = await startBossFixture();
    dataDir = await mkdtemp(join(tmpdir(), 'career-authority-'));
    const apiConf = { ...apiConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: 'http://127.0.0.1:9', CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli' as const };
    api = new CareerService(apiConf);
    workerEnv = { ...workerConfig(), DATABASE_URL: TEST_DATABASE, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli', BOSS_MOLI_EXECUTABLE: MOLI, BOSS_HEADED_FALLBACK: 'off' };
    worker = new CareerWorker(workerEnv, { browserFor: owner => browserFor(owner) });
    shortLeaseWorker = new CareerWorker(workerEnv, { browserFor: owner => browserFor(owner), leaseSeconds: 1 });
  }, 120000);

  afterAll(async () => {
    // Only this suite's synthetic owners: never leave claimable work for another worker.
    await cancelOwnWork().catch(() => {});
    await Promise.all([worker?.close(), shortLeaseWorker?.close()]);
    await api?.close();
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 120000);

  const store = () => worker.store;
  const pool = () => worker.store.pool;

  function browserFor(owner: string) {
    const existing = browsers.get(owner);
    if (existing) return existing;
    const browser = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile,
      profileDirectory: join(dataDir, 'browser', owner), moliExecutable: MOLI, headedFallback: false,
    });
    browsers.set(owner, browser);
    return browser;
  }

  /** One synthetic owner with its own private profile, logged in as a specific fixture account. */
  async function newOwner(uid: string) {
    const owner = crypto.randomUUID();
    owners.push(owner);
    const browser = browserFor(owner);
    const page = await browser.ensureBrowser();
    await page.goto(`${fixture.origin}/login?as=${uid}`, { waitUntil: 'domcontentloaded' });
    const observed = await browser.inspectSession();
    expect(observed.state).toBe('ready');
    expect(observed.accountMarker).toBe(accountMarkerFor(uid));
    await store().writeSession(owner, {
      state: observed.state, engine: observed.engine, accountMarker: observed.accountMarker,
      reason: observed.detail, humanWindow: observed.humanWindow, limitation: observed.limitation,
    });
    return { owner, browser, page };
  }

  async function seedResume(owner: string) {
    const files = new ResumeFileStore(dataDir);
    const text = '合成简历\n在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。';
    const bytes = Buffer.from(`${text}\n`, 'utf8');
    const stored = await files.put(owner, { bytes, extension: 'txt' });
    const upload = await store().createUpload(owner, { filename: 'synthetic-resume.txt', text, warnings: [], storageKey: stored.storageKey, sha256: stored.sha256, byteSize: stored.byteSize, contentType: 'text/plain' });
    return store().saveResumeVersion(owner, {
      requestId: crypto.randomUUID(), requestHash: digest({ kind: 'save-resume-version', stagingId: upload.id, label: '权限测试简历', text }),
      stagingId: upload.id, label: '权限测试简历', text,
      attachmentSha256: upload.sha256, byteSize: upload.byte_size, contentType: upload.content_type,
      originalName: upload.filename, storageKey: upload.storage_key, warnings: [], textSha256: textSha256(text),
    });
  }

  function observedFor(sitePostingId: string): ObservedPosting {
    const posting = fixturePostings.find(item => item.id === sitePostingId);
    if (!posting) throw new Error('FIXTURE_POSTING_MISSING');
    return {
      site: 'boss', sitePostingId, url: fixture.profile.postingUrl(sitePostingId),
      title: posting.title, company: posting.company, location: posting.location, salaryRaw: posting.salary,
      jdText: posting.jd, companyProfileText: posting.companyProfile, identitySource: 'detail_link',
      nativeFilterEvidence: { searchKey: `${posting.city}:fullstack`, controls: [{ label: 'city', selected: posting.city, url: fixture.origin }] },
    };
  }

  /** Frozen approval for one synthetic posting, with unrelated scan/preparation work removed. */
  async function seedApprovedBatch(owner: string, sitePostingId: string, greetingText = greeting) {
    const resume = await seedResume(owner);
    const requestId = crypto.randomUUID();
    const task = await store().createTask(owner, {
      id: crypto.randomUUID(), resume, policy, model: { connectionId: crypto.randomUUID(), label: 'fixture-model' },
      requestId, requestHash: digest({ kind: 'create-career-task', requestId }),
    });
    await pool().query("UPDATE app_career_work SET status='cancelled' WHERE task_id=$1 AND kind='scan'", [task.id]);
    const review = await store().setTaskState(task.id, { phase: 'review' });
    expect(review).not.toBeNull();
    const observed = observedFor(sitePostingId);
    const decision = evaluatePosting({ policy, posting: observed });
    expect(decision.disposition).toBe('eligible');
    const postingId = await store().upsertPosting(owner, observed);
    const taskPostingId = crypto.randomUUID();
    const snapshotHash = digest(observed);
    if (!task.model_source) throw new Error('FIXTURE_PERSONALIZED_TASK_REQUIRED');
    await store().upsertTaskPosting(owner, {
      id: taskPostingId, taskId: task.id, postingId, observed, snapshotHash, disposition: decision.disposition, decision, match: null,
      greeting: { text: greetingText, factualClaims: [], uncertainties: [], modelAttribution: { kind: 'connection', connectionId: task.model_source.connectionId, model: task.model_source.label } },
      existingRevision: null,
    });
    const batch = await api.approve(owner, task.id, {
      requestId: crypto.randomUUID(), expectedTaskRevision: review!.revision, resumeVersionId: resume.id,
      items: [{ taskPostingId, postingSnapshotHash: snapshotHash, greetingDraftRevision: 0, finalGreeting: greetingText }],
    });
    await pool().query("UPDATE app_career_work SET status='cancelled' WHERE task_id=$1 AND kind='preparation'", [task.id]);
    const item = (await store().batchItems(owner, batch.id))[0];
    if (!item) throw new Error('BATCH_ITEM_MISSING');
    return { task, batch, item, postingId, taskPostingId, resume };
  }

  function messagesFor(sitePostingId: string) {
    return fixture.state.messages.filter(message => message.postingId === sitePostingId);
  }

  async function waitFor(read: () => boolean, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (read()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('TIMEOUT');
  }

  async function cancelOwnWork() {
    for (const owner of owners) await pool().query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND status IN ('queued','processing')", [owner]);
  }

  it('withdraws delivery authority as soon as the session clear is accepted during a delayed chat', async () => {
    const { owner } = await newOwner('authority-clear-live');
    const seeded = await seedApprovedBatch(owner, 'fixture-clear-during-chat');
    fixture.state.chatInputDelayMs = 1600;
    try {
      const ticking = worker.tick();
      await waitFor(() => fixture.state.chatOpens.includes('fixture-clear-during-chat'));
      const cleared = await api.clearSession(owner);
      expect(cleared.session.state).toBe('clearing');
      // Clear acceptance alone revoked the running approval; it does not wait for the serial clear work.
      expect((await store().batch(owner, seeded.batch.id))?.state).toBe('cancelled');
      await ticking;
    } finally {
      fixture.state.chatInputDelayMs = 0;
    }
    expect(messagesFor('fixture-clear-during-chat')).toHaveLength(0);
    const item = await store().batchItem(owner, seeded.batch.id, seeded.item.id);
    expect(item?.conversation_state).toBe('unknown');
    expect(item?.conversation_reason).toBe('cancelled_during_dispatch');
    expect((await store().effects(seeded.item.id)).filter(effect => effect.outcome === 'dispatching')).toHaveLength(0);
    // The queued clear work still destroys the private session, and nothing is dispatched afterwards.
    await worker.tick();
    expect(messagesFor('fixture-clear-during-chat')).toHaveLength(0);
    const session = await store().session(owner);
    expect(session?.state).toBe('absent');
    expect(session?.profile_generation).toBe(1);
  }, 180000);

  it('stops before submit when the batch is cancelled while the greeting fill is blocked', async () => {
    const { owner } = await newOwner('authority-fill');
    const seeded = await seedApprovedBatch(owner, 'fixture-fill-blocked');
    fixture.state.chatInputSealedMs = 2000;
    try {
      const ticking = worker.tick();
      await waitFor(() => fixture.state.chatOpens.includes('fixture-fill-blocked'));
      // The chat surface exists but its input is not editable yet, so `fill` is still blocked here.
      await new Promise(resolve => setTimeout(resolve, 400));
      await api.cancelBatch(owner, seeded.batch.id);
      await ticking;
    } finally {
      fixture.state.chatInputSealedMs = 0;
    }
    expect(messagesFor('fixture-fill-blocked')).toHaveLength(0);
    const item = await store().batchItem(owner, seeded.batch.id, seeded.item.id);
    expect(item?.conversation_state).toBe('unknown');
    expect(item?.conversation_reason).toBe('cancelled_during_dispatch');
  }, 180000);

  it('fences a stale batch retry once a new batch reserved the same posting', async () => {
    const { owner } = await newOwner('authority-reservation');
    const staleGreeting = '您好，这是旧批次的招呼语。';
    const freshGreeting = '您好，这是新批次的招呼语。';
    const stale = await seedApprovedBatch(owner, 'fixture-reservation-handover', staleGreeting);
    // A disabled contact entry is a proven-not-sent conversation failure, the only state that may be re-reserved.
    fixture.state.contactDisabledFor = 'fixture-reservation-handover';
    try {
      await worker.tick();
    } finally {
      fixture.state.contactDisabledFor = null;
    }
    const failed = await store().batchItem(owner, stale.batch.id, stale.item.id);
    expect(failed?.conversation_state).toBe('failed');
    expect(messagesFor('fixture-qualified-fullstack')).toHaveLength(0);
    const postingId = failed!.posting_id;
    const reservation = () => pool().query("SELECT state, batch_id FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, postingId]);
    expect((await reservation()).rows[0]).toMatchObject({ state: 'conversation_failed', batch_id: stale.batch.id });
    const effectsAfterFailure = await store().effects(stale.item.id);
    // A fresh batch B may reserve the provably failed posting.
    const fresh = await seedApprovedBatch(owner, 'fixture-reservation-handover', freshGreeting);
    expect((await reservation()).rows[0]).toMatchObject({ state: 'reserved', batch_id: fresh.batch.id });
    // The explicit retry command is rejected by the same reservation ownership proof inside its transaction.
    await expect(api.retryItem(owner, stale.batch.id, stale.item.id, { requestId: crypto.randomUUID(), expectedRevision: failed!.revision, phase: 'conversation' })).rejects.toThrow('该岗位已被新的批次重新占用');
    const staleQueued = await pool().query("SELECT count(*) AS total FROM app_career_work WHERE batch_id=$1 AND kind='delivery' AND status IN ('queued','processing')", [stale.batch.id]);
    expect(staleQueued.rows[0]).toMatchObject({ total: 0 });
    expect((await store().batchItem(owner, stale.batch.id, stale.item.id))?.conversation_state).toBe('failed');
    // Only B owns the external effects.
    await worker.tick();
    expect(messagesFor('fixture-reservation-handover')).toHaveLength(1);
    expect(messagesFor('fixture-reservation-handover')[0]?.text).toBe(freshGreeting);
    expect((await reservation()).rows[0]).toMatchObject({ batch_id: fresh.batch.id });
    // A stale A delivery that slipped past the command boundary never reaches the site.
    await pool().query("UPDATE app_career_batch_items SET conversation_state='not_started', revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [stale.item.id]);
    const staleWorkId = crypto.randomUUID();
    await store().enqueueWork({ id: staleWorkId, owner, kind: 'delivery', taskId: stale.task.id, batchId: stale.batch.id, batchItemId: stale.item.id, requestHash: `stale-retry:${crypto.randomUUID()}` });
    await worker.tick();
    expect(messagesFor('fixture-reservation-handover')).toHaveLength(1);
    expect((await store().work(staleWorkId))?.status).toBe('completed');
    expect((await store().batchItem(owner, stale.batch.id, stale.item.id))?.conversation_state).toBe('not_started');
    expect(await store().effects(stale.item.id)).toHaveLength(effectsAfterFailure.length);
    expect((await reservation()).rows[0]).toMatchObject({ batch_id: fresh.batch.id });
  }, 240000);

  it('keeps the retried batch on the reservation so a fresh approval cannot take it over mid-retry', async () => {
    const { owner } = await newOwner('authority-retry-reservation');
    const retriedGreeting = '您好，这是重试批次的招呼语。';
    const competitorGreeting = '您好，这是抢先批次的招呼语。';
    // Earlier owner-scoped cases share this synthetic posting, so only new greetings/chats count here.
    const greetingsBefore = messagesFor('fixture-reservation-handover').length;
    const chatOpensOf = () => fixture.state.chatOpens.filter(id => id === 'fixture-reservation-handover').length;
    const chatOpensBefore = chatOpensOf();
    const retried = await seedApprovedBatch(owner, 'fixture-reservation-handover', retriedGreeting);
    fixture.state.contactDisabledFor = 'fixture-reservation-handover';
    try {
      await worker.tick();
    } finally {
      fixture.state.contactDisabledFor = null;
    }
    const failed = await store().batchItem(owner, retried.batch.id, retried.item.id);
    expect(failed?.conversation_state).toBe('failed');
    expect(messagesFor('fixture-reservation-handover')).toHaveLength(greetingsBefore);
    const postingId = failed!.posting_id;
    const reservation = () => pool().query("SELECT state, batch_id FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, postingId]);
    expect((await reservation()).rows[0]).toMatchObject({ state: 'conversation_failed', batch_id: retried.batch.id });
    // Accepting the retry consumes that transferable failure in the retry transaction itself.
    await api.retryItem(owner, retried.batch.id, retried.item.id, { requestId: crypto.randomUUID(), expectedRevision: failed!.revision, phase: 'conversation' });
    expect((await reservation()).rows[0]).toMatchObject({ state: 'reserved', batch_id: retried.batch.id });
    fixture.state.chatInputDelayMs = 3000;
    const ticking = worker.tick();
    try {
      await waitFor(() => chatOpensOf() > chatOpensBefore);
      // The retried greeting is still in flight behind the delayed chat input, so a fresh approval of
      // the same posting must not transfer the reservation away from the retrying batch.
      await expect(seedApprovedBatch(owner, 'fixture-reservation-handover', competitorGreeting)).rejects.toThrow('ALREADY_RESERVED');
      expect(messagesFor('fixture-reservation-handover')).toHaveLength(greetingsBefore);
      expect((await reservation()).rows[0]).toMatchObject({ state: 'reserved', batch_id: retried.batch.id });
    } finally {
      fixture.state.chatInputDelayMs = 0;
      await ticking;
    }
    // The retried batch is the single reservation winner and its greeting left exactly once.
    expect(messagesFor('fixture-reservation-handover')).toHaveLength(greetingsBefore + 1);
    expect(messagesFor('fixture-reservation-handover')[greetingsBefore]?.text).toBe(retriedGreeting);
    expect((await store().batchItem(owner, retried.batch.id, retried.item.id))?.conversation_state).toBe('confirmed');
    const settled = (await reservation()).rows[0];
    expect(settled).toMatchObject({ batch_id: retried.batch.id });
    // The confirmed conversation claims an external effect, so no fresh approval may re-reserve it.
    expect(settled?.state).not.toBe('conversation_failed');
  }, 240000);

  it('stops between the contact click and the greeting send when the batch is cancelled', async () => {
    const { owner } = await newOwner('authority-cancel');
    const seeded = await seedApprovedBatch(owner, 'fixture-qualified-fullstack');
    fixture.state.chatInputDelayMs = 1600;
    try {
      const ticking = worker.tick();
      await waitFor(() => fixture.state.chatOpens.includes('fixture-qualified-fullstack'));
      await api.cancelBatch(owner, seeded.batch.id);
      await ticking;
    } finally {
      fixture.state.chatInputDelayMs = 0;
    }
    expect(messagesFor('fixture-qualified-fullstack')).toHaveLength(0);
    const item = await store().batchItem(owner, seeded.batch.id, seeded.item.id);
    expect(item?.conversation_state).toBe('unknown');
    expect(item?.conversation_reason).toBe('cancelled_during_dispatch');
    expect((await store().batch(owner, seeded.batch.id))?.state).toBe('cancelled');
    const effects = await store().effects(seeded.item.id);
    expect(effects.filter(effect => effect.outcome === 'dispatching')).toHaveLength(0);
    expect(effects.find(effect => effect.phase === 'conversation')?.outcome).toBe('unknown');
    // Nothing else is dispatched later for the cancelled approval.
    await worker.tick();
    expect(messagesFor('fixture-qualified-fullstack')).toHaveLength(0);
  }, 180000);

  it('stops the stale actor after a competing lease claim and never resends the greeting', async () => {
    const { owner, browser } = await newOwner('authority-lease');
    const seeded = await seedApprovedBatch(owner, 'fixture-agent-shenzhen');
    fixture.state.chatInputDelayMs = 1600;
    let competing: { id: string; lease_generation: number } | undefined;
    try {
      const ticking = worker.tick();
      await waitFor(() => fixture.state.chatOpens.includes('fixture-agent-shenzhen'));
      const claimed = await pool().query("SELECT id, lease_generation FROM app_career_work WHERE batch_id=$1 AND kind='delivery' AND status='processing'", [seeded.batch.id]);
      competing = z.object({ id: z.string(), lease_generation: z.number() }).parse(claimed.rows[0]);
      expect(competing).toBeDefined();
      // Another actor takes the work while this one is still between browser actions.
      await pool().query("UPDATE app_career_work SET lease_generation=lease_generation+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [competing!.id]);
      await ticking;
    } finally {
      fixture.state.chatInputDelayMs = 0;
    }
    expect(await store().renewLease(competing!.id, competing!.lease_generation, 5)).toBe(false);
    expect(messagesFor('fixture-agent-shenzhen')).toHaveLength(0);
    const interrupted = await store().batchItem(owner, seeded.batch.id, seeded.item.id);
    expect(interrupted?.conversation_state).toBe('dispatching');
    // Closing the owned actor also closed its private browser; the same evidenced account signs in
    // again and the next owner claims the abandoned row only to fence the intent as unknown.
    const page = await browser.ensureBrowser();
    await page.goto(`${fixture.origin}/login?as=authority-lease`, { waitUntil: 'domcontentloaded' });
    await pool().query("UPDATE app_career_work SET status='queued', lease_until=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [competing!.id]);
    await worker.tick();
    expect(messagesFor('fixture-agent-shenzhen')).toHaveLength(0);
    expect((await store().batchItem(owner, seeded.batch.id, seeded.item.id))?.conversation_state).toBe('unknown');
  }, 180000);

  it('renews its owned lease while a long browser operation runs', async () => {
    const { owner } = await newOwner('authority-renew');
    const seeded = await seedApprovedBatch(owner, 'fixture-unknown-send');
    fixture.state.chatInputDelayMs = 3000;
    try {
      const ticking = shortLeaseWorker.tick();
      await waitFor(() => fixture.state.chatOpens.includes('fixture-unknown-send'));
      await new Promise(resolve => setTimeout(resolve, 1500));
      // A one second lease would have expired: only the heartbeat can still hold it.
      const row = await pool().query("SELECT lease_until > strftime('%Y-%m-%dT%H:%M:%f000Z','now','+0.2 seconds') AS fresh FROM app_career_work WHERE batch_id=$1 AND kind='delivery'", [seeded.batch.id]);
      expect(row.rows[0]).toMatchObject({ fresh: true });
      await ticking;
    } finally {
      fixture.state.chatInputDelayMs = 0;
    }
    // The greeting left exactly once under the renewed lease; the site then failed to confirm it.
    expect(messagesFor('fixture-unknown-send')).toHaveLength(1);
    expect((await store().batchItem(owner, seeded.batch.id, seeded.item.id))?.conversation_state).toBe('unknown');
  }, 180000);

  it('revokes unstarted delivery when the session is cleared and refuses to resume the old approval', async () => {
    const { owner } = await newOwner('authority-reset');
    const seeded = await seedApprovedBatch(owner, 'fixture-wrong-attachment');
    await api.clearSession(owner);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await worker.tick();
      if ((await store().batch(owner, seeded.batch.id))?.state === 'cancelled') break;
    }
    expect((await store().batch(owner, seeded.batch.id))?.state).toBe('cancelled');
    expect((await store().batchItem(owner, seeded.batch.id, seeded.item.id))?.conversation_state).toBe('not_started');
    expect(messagesFor('fixture-wrong-attachment')).toHaveLength(0);
    const queued = await pool().query("SELECT count(*) AS total FROM app_career_work WHERE batch_id=$1 AND kind='delivery' AND status IN ('queued','processing')", [seeded.batch.id]);
    expect(queued.rows[0]?.total).toBe(0);
    const session = await store().session(owner);
    expect(session?.profile_generation).toBe(1);
    expect(session?.account_marker).toBeNull();
    await expect(api.resumeBatch(owner, seeded.batch.id, { requestId: crypto.randomUUID(), expectedRevision: seeded.batch.taskRevision })).rejects.toThrow();
  }, 180000);

  it('revokes delivery when the same profile observes a different account', async () => {
    const { owner, page } = await newOwner('authority-account-a');
    const seeded = await seedApprovedBatch(owner, 'fixture-corrupt-receipt');
    await page.goto(`${fixture.origin}/login?as=authority-account-b`, { waitUntil: 'domcontentloaded' });
    await worker.tick();
    expect((await store().batch(owner, seeded.batch.id))?.state).toBe('cancelled');
    expect((await store().batchItem(owner, seeded.batch.id, seeded.item.id))?.conversation_state).toBe('not_started');
    expect(messagesFor('fixture-corrupt-receipt')).toHaveLength(0);
    expect((await store().session(owner))?.account_marker).toBe(accountMarkerFor('authority-account-b'));
  }, 180000);

  it('gives two owner sessions separate loopback endpoints and separate login state', async () => {    const left = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile,
      profileDirectory: join(dataDir, 'browser', `owner-left-${crypto.randomUUID()}`), moliExecutable: MOLI, headedFallback: false,
    });
    const right = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile,
      profileDirectory: join(dataDir, 'browser', `owner-right-${crypto.randomUUID()}`), moliExecutable: MOLI, headedFallback: false,
    });
    try {
      const leftPage = await left.ensureBrowser();
      await leftPage.goto(`${fixture.origin}/login?as=owner-left`, { waitUntil: 'domcontentloaded' });
      const signedIn = await left.inspectSession();
      // Each owner opens its own session explicitly: a session check never launches a browser itself.
      const rightOpened = await right.openSession();
      const signedInAgain = await right.checkSession();
      expect(signedIn.state).toBe('ready');
      expect(signedIn.accountMarker).toBe(accountMarkerFor('owner-left'));
      expect(rightOpened.state).toBe('login_required');
      expect(rightOpened.accountMarker).toBeNull();
      expect(signedInAgain.state).toBe('login_required');
      expect(signedInAgain.accountMarker).toBeNull();
      const leftPort = left.cdpEndpoint?.port;
      const rightPort = right.cdpEndpoint?.port;
      expect(left.cdpEndpoint?.host).toBe('127.0.0.1');
      expect(right.cdpEndpoint?.host).toBe('127.0.0.1');
      expect(leftPort).toBeDefined();
      expect(rightPort).toBeDefined();
      expect(leftPort).not.toBe(rightPort);
      // The unauthenticated profile keeps its own page and never sees the other login.
      const rightPage = await right.ensureBrowser();
      await rightPage.goto(`${fixture.origin}/`, { waitUntil: 'domcontentloaded' });
      expect(await rightPage.locator('.user-nav').count()).toBe(0);
      expect(await leftPage.locator('.user-nav').count()).toBe(1);
    } finally {
      await left.close();
      await right.close();
    }
  }, 240000);

  it('blocks an unverified live site before the contact action and pauses for human observation', async () => {
    // The live profile intentionally stays unverified: fixture attributes are not live BOSS support.
    expect(liveBossProfile(fixture.origin).verified).toBe(false);
    const owner = crypto.randomUUID();
    owners.push(owner);
    fixture.state.loggedIn = true;
    try {
      const liveBrowser = new BossBrowser({
        engine: 'moli', origin: fixture.origin, profile: liveBossProfile(fixture.origin),
        profileDirectory: join(dataDir, 'browser', `unverified-${owner}`), moliExecutable: MOLI, headedFallback: false,
      });
      browsers.set(`unverified:${owner}`, liveBrowser);
      // The owner opens the session first; delivery then reaches the unverified-site gate instead of pausing
      // on the absence of a page.
      expect((await liveBrowser.openSession()).state).toBe('ready');
      await store().writeSession(owner, { state: 'ready', engine: 'moli', accountMarker: accountMarkerFor('fixture-uid'), reason: null });
      const seeded = await seedApprovedBatch(owner, 'fixture-consent');
      const unverified = new CareerWorker(workerEnv, { browserFor: () => liveBrowser });
      try {
        await unverified.tick();
      } finally {
        await unverified.close();
      }
      expect((await store().batch(owner, seeded.batch.id))?.state).toBe('paused');
      const task = await store().getTask(owner, seeded.task.id);
      expect(task?.status).toBe('paused');
      expect(task?.pause_reason).toBe('browser_unavailable');
      expect(task?.pause_detail ?? '').toContain('人工观察');
      // Blocked before the contact action: no greeting and not even a dispatch intent.
      expect(messagesFor('fixture-consent')).toHaveLength(0);
      expect(await store().effects(seeded.item.id)).toHaveLength(0);
      expect((await store().batchItem(owner, seeded.batch.id, seeded.item.id))?.conversation_state).toBe('not_started');
    } finally {
      fixture.state.loggedIn = false;
    }
  }, 240000);
});
