import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from "../packages/database/src/sqlite";
import { createAgentServer } from '../apps/agent/src/server';
import { CareerService } from '../apps/api/src/career';
import { ResumeVersionService } from '../apps/api/src/resume-versions';
import { QuestionBank } from '../apps/api/src/bank';
import { deleteCareerDerivedPersonalData } from '../apps/api/src/career-deletion';
import { CareerWorker } from '../apps/worker/src/career-worker';
import { BossBrowser } from '../apps/worker/src/boss-browser';
import { CareerStorageError, ResumeFileStore } from '../packages/career/src/storage';
import { matchReceiptWorkId } from '../packages/career/src/domain';
import type { MatchAttempt } from '../packages/career/src/store';
import { newSession } from '../packages/interview/src/domain';
import { bankDraftSchema } from '../packages/contracts/src/bank';
import type { WorkerConfig } from '../packages/config/src/index';
import { apiConfig, agentConfig, workerConfig, input } from './fixtures';
import { startProviderFixture, serveFixture } from './provider-fixture';
import { startBossFixture } from './boss-site-fixture';

const TEST_DATABASE = (process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite");
const TEST_AGENT_DATABASE = (process.env.SQLITE_TEST_AGENT_URL ?? "file:/tmp/interview-tests-agent.sqlite");
const MOLI = process.env.MOLI_EXECUTABLE ?? join(homedir(), '.local', 'bin', 'moli');
const suite = process.env.RUN_INTEGRATION === '1' && existsSync(MOLI) ? describe : describe.skip;

const policy = {
  roleTargets: ['fullstack', 'agent_development'] as const,
  cities: ['广州', '深圳'] as const,
  salaryUpperMinCnyMonthly: 18000,
  preferAiApplication: true,
  companyBlacklistKeywords: ['人才服务'],
};
const resumeText = '在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。参与大模型 API 的接入与评测。';

// Remaining privacy gaps of the BOSS workflow at the persistence and Agent boundary: the receipt of
// an attempted match must survive a deletion during dispatch, strict interviews must be found from
// their frozen provenance, and expired staging originals must be claimed, purged and cleared without
// another upload. Synthetic fixture identities only; no real BOSS session or send is involved.
suite('career privacy cleanup at the persistence and Agent boundary', () => {
  let provider: Awaited<ReturnType<typeof startProviderFixture>>;
  let runtime: Awaited<ReturnType<typeof createAgentServer>>;
  let bridge: Awaited<ReturnType<typeof serveFixture>>;
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let api: CareerService;
  let resumes: ResumeVersionService;
  let worker: CareerWorker;
  let workerEnv: WorkerConfig;
  let dataDir: string;
  let appPool: Pool;
  let agentPool: Pool;
  const browsers = new Map<string, BossBrowser>();
  const owners: string[] = [];

  beforeAll(async () => {
    provider = await startProviderFixture();
    // The synthetic provider accepts the key this suite chooses for its own connection.
    provider.state.acceptAnyKey = true;
    runtime = await createAgentServer({ ...agentConfig(), AGENT_DATABASE_URL: TEST_AGENT_DATABASE });
    bridge = await serveFixture(request => runtime.app.fetch(request));
    fixture = await startBossFixture();
    fixture.state.loggedIn = true;
    dataDir = await mkdtemp(join(tmpdir(), 'career-privacy-'));
    const apiConf = { ...apiConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli' as const };
    api = new CareerService(apiConf);
    resumes = new ResumeVersionService(apiConf);
    workerEnv = { ...workerConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli', BOSS_MOLI_EXECUTABLE: MOLI, BOSS_HEADED_FALLBACK: 'off' };
    worker = new CareerWorker(workerEnv, { browserFor: owner => browserFor(owner) });
    appPool = api.store.pool;
    agentPool = new Pool({ connectionString: TEST_AGENT_DATABASE });
    // This suite drives ticks explicitly and must never claim another suite's pending work.
    await appPool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','+2 hours') WHERE status IN ('queued','processing')");
  }, 120000);

  afterAll(async () => {
    for (const owner of owners) await cleanOwner(owner).catch(() => {});
    await Promise.all([api?.close(), resumes?.close(), worker?.close(), agentPool?.end()]);
    await bridge?.close();
    await runtime?.close();
    await provider?.close();
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 120000);

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

  function newOwner() {
    const owner = crypto.randomUUID();
    owners.push(owner);
    return owner;
  }

  async function cleanOwner(owner: string) {
    await appPool.query("DELETE FROM app_career_work WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_career_tasks WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_career_postings WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_career_browser_sessions WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_interviews WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_bank_questions WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_resume_uploads WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_resume_versions WHERE owner=$1", [owner]);
    await appPool.query("DELETE FROM app_resume_files WHERE owner=$1", [owner]);
  }

  async function waitFor<T>(label: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value as T;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`TIMEOUT:${label}`);
  }

  function careerMatchCalls() {
    return provider.calls.filter(call => {
      try {
        return (JSON.parse(call.content) as { kind?: string }).kind === 'career-match';
      } catch {
        return false;
      }
    }).length;
  }

  it('collects the attempted match receipt when the first match is deleted while the provider is delayed', async () => {
    const owner = newOwner();
    const buffer = Buffer.from(`合成隐私简历\n${resumeText}\n`, 'utf8');
    const upload = await resumes.upload(owner, { originalname: 'synthetic-privacy.txt', mimetype: 'text/plain', buffer, size: buffer.length });
    const version = await resumes.save(owner, { requestId: crypto.randomUUID(), stagingId: upload.stagingId, label: '隐私清理简历', text: `合成隐私简历\n${resumeText}`, warningsAcknowledged: true });
    const model = await api.models.save(owner, { baseUrl: provider.baseUrl, model: 'career-privacy-fixture', apiKey: 'fixture-career-key', remember: false, timeoutMs: 15000 });

    let release: () => void = () => {};
    provider.state.holdCareerMatch = new Promise<void>(resolve => { release = () => resolve(); });
    let scanning: Promise<void> | null = null;
    // The scan needs an explicitly opened session: an automated check never launches a browser.
    expect((await browserFor(owner).openSession()).state).toBe('ready');
    try {
      const task = await api.createTask(owner, { requestId: crypto.randomUUID(), resumeVersionId: version.id, modelConnectionId: model.id, policy, dataProcessingAcknowledged: true });
      scanning = worker.tick();
      const scanWork = await waitFor('SCAN_WORK', async () => {
        const row = (await appPool.query("SELECT id FROM app_career_work WHERE owner=$1 AND kind='scan' AND task_id=$2", [owner, task.id])).rows[0];
        return row ? { id: row.id as string } : null;
      }, 30000);

      // The attempt is durable before the provider answers, and no receipt exists yet.
      const attempt = await waitFor('MATCH_ATTEMPT', async () => {
        const row = (await appPool.query("SELECT payload FROM app_career_work WHERE id=$1", [scanWork.id])).rows[0];
        const first = ((row?.payload as { matchAttempts?: MatchAttempt[] }).matchAttempts ?? [])[0];
        return first ?? null;
      }, 60000);
      expect((await appPool.query("SELECT status FROM app_career_work WHERE id=$1", [scanWork.id])).rows[0]?.status).toBe('processing');
      expect(attempt.receiptWorkId).toBe(matchReceiptWorkId(scanWork.id, attempt.sitePostingId));
      // The held provider call proves dispatch happened after the attempt was durable.
      await waitFor('PROVIDER_CALL', async () => careerMatchCalls() === 1, 30000);
      expect((await agentPool.query("SELECT 1 FROM agent_runtime_career_receipts WHERE work_id=$1", [attempt.receiptWorkId])).rowCount).toBe(0);

      // Deleting the source during the delayed first match must still collect that receipt key.
      await api.deleteTask(owner, task.id);
      const purge = await waitFor('PURGE_WITH_ATTEMPT', async () => {
        const row = (await appPool.query("SELECT id, payload FROM app_career_work WHERE owner=$1 AND kind='purge' AND payload->'workIds' ? $2", [owner, attempt.receiptWorkId])).rows[0];
        return row ? { id: row.id as string } : null;
      }, 15000);

      release();
      await scanning;
      // The late provider result commits its receipt but never revives a personal posting snapshot.
      await waitFor('LATE_RECEIPT', async () => (await agentPool.query("SELECT 1 FROM agent_runtime_career_receipts WHERE work_id=$1", [attempt.receiptWorkId])).rowCount === 1);
      expect((await appPool.query("SELECT count(*) AS total FROM app_career_task_postings WHERE task_id=$1", [task.id])).rows[0]?.total).toBe(0);
      expect((await appPool.query("SELECT count(*) AS total FROM app_career_tasks WHERE id=$1", [task.id])).rows[0]?.total).toBe(0);
      // The deleted source admits no further match attempt, so the provider is never called again.
      expect(careerMatchCalls()).toBe(1);

      for (let index = 0; index < 10; index += 1) {
        const status = (await appPool.query("SELECT status FROM app_career_work WHERE id=$1", [purge.id])).rows[0]?.status;
        if (status === 'completed') break;
        await worker.tick();
      }
      expect((await appPool.query("SELECT status FROM app_career_work WHERE id=$1", [purge.id])).rows[0]?.status).toBe('completed');
      expect((await agentPool.query("SELECT 1 FROM agent_runtime_career_receipts WHERE work_id=$1", [attempt.receiptWorkId])).rowCount).toBe(0);
      expect((await agentPool.query("SELECT 1 FROM agent_runtime_deleted_career_work WHERE work_id=$1", [attempt.receiptWorkId])).rowCount).toBe(1);
    } finally {
      provider.state.holdCareerMatch = null;
      release();
      await scanning?.catch(() => {});
    }
  }, 180000);

  it('finds the strict interview by frozen career provenance after the bank question and its source are gone', async () => {
    const owner = newOwner();
    const bank = new QuestionBank(appPool);
    const resumeVersionId = crypto.randomUUID();
    const preparationId = crypto.randomUUID();
    const provenance = {
      kind: 'resume_jd' as const, preparationId, postingSnapshotHash: 'a'.repeat(64), resumeVersionId,
      resumeTextSha256: 'b'.repeat(64), jdSnapshotHash: 'a'.repeat(64), purpose: 'resume_project' as const,
    };
    const content = '请说明你在全栈项目中如何拆分接口与数据建模的职责，并给出可核验的结果。';
    const derived = await bank.create(owner, crypto.randomUUID(), bankDraftSchema.parse({
      title: '派生自查题的岗位问题', content, category: 'technical', difficulty: 'medium', roleFamilies: ['fullstack'], career: provenance,
    }));
    const control = await bank.create(owner, crypto.randomUUID(), bankDraftSchema.parse({
      title: '独立整理的岗位问题', content, category: 'technical', difficulty: 'medium', roleFamilies: ['general'],
    }));
    const derivedInterview = crypto.randomUUID();
    const controlInterview = crypto.randomUUID();
    for (const [sessionId, question] of [[derivedInterview, derived], [controlInterview, control]] as const) {
      await appPool.query("INSERT INTO app_interviews(id, owner, state) VALUES($1,$2,$3)", [sessionId, owner, JSON.stringify(newSession(input, 'demo'))]);
      await appPool.query("INSERT INTO app_interview_materials(session_id, questions) VALUES($1,$2)", [sessionId, JSON.stringify([question])]);
    }

    // First cleanup pass stops after the bank question; the interview still freezes the provenance.
    const impact = await api.store.derivedPersonalData(owner, { resumeVersionId, preparationIds: [] });
    expect(impact.bankQuestionIds).toEqual([derived.id]);
    expect(impact.interviewSessionIds).toEqual([derivedInterview]);
    expect(await bank.removeCareerDerived(owner, impact.bankQuestionIds)).toBe(1);

    // The retry sees no bank question at all and must still find the interview by preparationId.
    const remaining = await api.store.derivedPersonalData(owner, { preparationIds: [preparationId] });
    expect(remaining.bankQuestionIds).toEqual([]);
    expect(remaining.interviewSessionIds).toEqual([derivedInterview]);
    const deleted = await deleteCareerDerivedPersonalData(api.store, bank, owner, { preparationIds: [preparationId] });
    expect(deleted.interviewSessionIds).toEqual([derivedInterview]);

    expect((await appPool.query("SELECT 1 FROM app_interviews WHERE id=$1", [derivedInterview])).rowCount).toBe(0);
    expect((await appPool.query("SELECT 1 FROM app_interview_materials WHERE session_id=$1", [derivedInterview])).rowCount).toBe(0);
    expect((await appPool.query("SELECT 1 FROM app_interviews WHERE id=$1", [controlInterview])).rowCount).toBe(1);
    expect((await appPool.query("SELECT 1 FROM app_interview_materials WHERE session_id=$1", [controlInterview])).rowCount).toBe(1);
    expect((await appPool.query("SELECT 1 FROM app_bank_questions WHERE id=$1", [control.id])).rowCount).toBe(1);
  }, 60000);

  it('expires staged originals in bounded chunks without another upload and clears their text only after cleanup', async () => {
    const owner = newOwner();
    const files = new ResumeFileStore(dataDir);
    const expiredKeys: string[] = [];
    const expiredIds: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const bytes = Buffer.from(`合成过期简历 ${index}\n${resumeText}\n`, 'utf8');
      const stored = await files.put(owner, { bytes, extension: 'txt' });
      const upload = await api.store.createUpload(owner, {
        filename: `synthetic-expired-${index}.txt`, text: `合成过期简历 ${index}\n${resumeText}`, warnings: ['合成告警'],
        storageKey: stored.storageKey, sha256: stored.sha256, byteSize: stored.byteSize, contentType: 'text/plain',
      });
      expiredIds.push(upload.id);
      expiredKeys.push(stored.storageKey);
    }
    const recentBytes = Buffer.from(`合成待保存简历\n${resumeText}\n`, 'utf8');
    const recentFile = await files.put(owner, { bytes: recentBytes, extension: 'txt' });
    const recent = await api.store.createUpload(owner, {
      filename: 'synthetic-recent.txt', text: `合成待保存简历\n${resumeText}`, warnings: [],
      storageKey: recentFile.storageKey, sha256: recentFile.sha256, byteSize: recentFile.byteSize, contentType: 'text/plain',
    });
    await appPool.query("UPDATE app_resume_uploads SET expires_at=strftime('%Y-%m-%dT%H:%M:%f000Z','now','-1 hour') WHERE id IN (SELECT value FROM json_each($1))", [expiredIds]);

    // One idle tick reconciles expiry without any other upload from this owner.
    await worker.tick();
    const expiredAfterOneTick = await appPool.query("SELECT count(*) AS total FROM app_resume_uploads WHERE owner=$1 AND status='expired'", [owner]);
    expect(expiredAfterOneTick.rows[0]?.total).toBe(20);

    // Park the queued purges so the remaining expiry is reconciled without them being processed yet.
    for (let index = 0; index < 40; index += 1) {
      const staged = await appPool.query("SELECT count(*) AS total FROM app_resume_uploads WHERE owner=$1 AND status='staged' AND id <> $2", [owner, recent.id]);
      if (staged.rows[0]?.total === 0) break;
      await appPool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','+1 hour') WHERE owner=$1 AND kind='purge' AND status='queued'", [owner]);
      await worker.tick();
    }
    expect((await appPool.query("SELECT count(*) AS total FROM app_resume_uploads WHERE owner=$1 AND status='expired'", [owner])).rows[0]?.total).toBe(51);
    expect((await appPool.query("SELECT status FROM app_resume_uploads WHERE id=$1", [recent.id])).rows[0]?.status).toBe('staged');

    // Every claim has its durable purge, and no purge payload exceeds the storage-key cap.
    const purgeRows = await appPool.query("SELECT id, payload FROM app_career_work WHERE owner=$1 AND kind='purge'", [owner]);
    const chunks = purgeRows.rows.map(row => (row.payload as { storageKeys: string[]; uploadIds: string[] }));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.storageKeys.length <= 50 && chunk.storageKeys.length === chunk.uploadIds.length)).toBe(true);
    const queued = new Set(chunks.flatMap(chunk => chunk.uploadIds));
    expect([...queued].sort()).toEqual([...expiredIds].sort());

    // A failed cleanup keeps the work queued and leaves the extracted text untouched.
    class FailingRemoveStore extends ResumeFileStore {
      override async remove(): Promise<void> {
        throw new CareerStorageError('STORAGE_UNAVAILABLE', 'synthetic removal failure');
      }
    }
    const failingWorker = new CareerWorker(workerEnv, { fileStore: new FailingRemoveStore(dataDir) });
    await appPool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','-1 second') WHERE owner=$1 AND kind='purge' AND status='queued'", [owner]);
    try {
      await failingWorker.tick();
    } finally {
      await failingWorker.close();
    }
    const failed = await appPool.query("SELECT id, failure FROM app_career_work WHERE owner=$1 AND kind='purge' AND status='queued' AND failure IS NOT NULL", [owner]);
    expect(failed.rowCount).toBe(1);
    expect(failed.rows[0]?.failure).toContain('PURGE_INCOMPLETE');
    expect((await appPool.query("SELECT count(*) AS total FROM app_resume_uploads WHERE owner=$1 AND status='expired' AND extracted_text<>''", [owner])).rows[0]?.total).toBe(51);
    for (const key of expiredKeys) expect(await files.exists(key)).toBe(true);

    // The retried cleanup removes the bytes and only then drops the extracted text and filename.
    await appPool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','-1 second') WHERE owner=$1 AND kind='purge' AND status='queued'", [owner]);
    for (let index = 0; index < 20; index += 1) {
      const pending = await appPool.query("SELECT count(*) AS total FROM app_career_work WHERE owner=$1 AND kind='purge' AND status IN ('queued','processing')", [owner]);
      if (pending.rows[0]?.total === 0) break;
      await worker.tick();
    }
    expect((await appPool.query("SELECT count(*) AS total FROM app_career_work WHERE owner=$1 AND kind='purge' AND status<>'completed'", [owner])).rows[0]?.total).toBe(0);
    for (const key of expiredKeys) expect(await files.exists(key)).toBe(false);
    const cleared = await appPool.query("SELECT extracted_text, filename, warnings FROM app_resume_uploads WHERE id IN (SELECT value FROM json_each($1))", [expiredIds]);
    expect(cleared.rows.every(row => row.extracted_text === '' && row.filename === '' && (row.warnings as string[]).length === 0)).toBe(true);
    expect((await appPool.query("SELECT extracted_text FROM app_resume_uploads WHERE id=$1", [recent.id])).rows[0]?.extracted_text).toContain('合成待保存简历');
    expect(await files.exists(recentFile.storageKey)).toBe(true);
  }, 120000);
});
