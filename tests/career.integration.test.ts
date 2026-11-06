import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentServer } from '../apps/agent/src/server';
import { InterviewService } from '../apps/api/src/interviews';
import { CareerService } from '../apps/api/src/career';
import { ResumeVersionService } from '../apps/api/src/resume-versions';
import { CareerWorker } from '../apps/worker/src/career-worker';
import { BossBrowser } from '../apps/worker/src/boss-browser';
import { ResumeFileStore } from '../packages/career/src/storage';
import { bankDraftSchema } from '../packages/contracts/src/bank';
import { Pool } from "../packages/database/src/sqlite";
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

suite('career vertical flow across API, worker, real browser client and Agent', () => {
  let provider: Awaited<ReturnType<typeof startProviderFixture>>;
  let runtime: Awaited<ReturnType<typeof createAgentServer>>;
  let bridge: Awaited<ReturnType<typeof serveFixture>>;
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let api: CareerService;
  let resumes: ResumeVersionService;
  let worker: CareerWorker;
  let ticker: NodeJS.Timeout | undefined;
  let dataDir: string;
  const browsers = new Map<string, BossBrowser>();
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();

  beforeAll(async () => {
    provider = await startProviderFixture();
    runtime = await createAgentServer({ ...agentConfig(), AGENT_DATABASE_URL: TEST_AGENT_DATABASE });
    bridge = await serveFixture(request => runtime.app.fetch(request));
    fixture = await startBossFixture();
    // The dedicated session starts already logged in for this synthetic acceptance run; the login
    // pause/resume behaviour is exercised explicitly further below.
    fixture.state.loggedIn = true;
    dataDir = await mkdtemp(join(tmpdir(), 'career-acceptance-'));
    const apiConf = { ...apiConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli' as const };
    api = new CareerService(apiConf);
    resumes = new ResumeVersionService(apiConf);
    worker = new CareerWorker(
      { ...workerConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli', BOSS_MOLI_EXECUTABLE: MOLI, BOSS_HEADED_FALLBACK: 'off' },
      {
        browserFor: user => {
          const existing = browsers.get(user);
          if (existing) return existing;
          const browser = new BossBrowser({
            engine: 'moli', origin: fixture.origin, profile: fixture.profile,
            profileDirectory: join(dataDir, 'browser', user),
            moliExecutable: MOLI, headedFallback: false,
          });
          browsers.set(user, browser);
          return browser;
        },
      },
    );
    // Production runs a one-second reconciliation loop; the acceptance run uses a faster loop so the
    // asynchronous session/preparation commands behave exactly as they do in the app.
    ticker = setInterval(() => { void worker.tick(); }, 100);
  }, 120000);

  afterAll(async () => {
    if (ticker) clearInterval(ticker);
    await Promise.all([api?.close(), resumes?.close(), worker?.close()]);
    await bridge?.close();
    await runtime?.close();
    await provider?.close();
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 120000);

  const resumeText = '在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。参与大模型 API 的接入与评测。';
  let resumeVersionId = '';
  let taskId = '';
  let batchId = '';

  async function waitIdle(timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    // A work row is briefly 'processing' before its commit; require two consecutive idle reads.
    let idleReads = 0;
    while (Date.now() < deadline) {
      const pending = await api.store.pool.query("SELECT 1 FROM app_career_work WHERE owner=$1 AND status IN ('queued','processing') LIMIT 1", [owner]);
      idleReads = pending.rows.length ? 0 : idleReads + 1;
      if (idleReads >= 2) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('CAREER_WORK_TIMEOUT');
  }

  async function postings() {
    const token = await api.getTask(owner, taskId);
    const list = await api.listPostings(owner, taskId);
    return { task: token, list };
  }

  it('stores an immutable resume version with its original bytes', async () => {
    const buffer = Buffer.from(`合成简历\n${resumeText}\n`, 'utf8');
    const upload = await resumes.upload(owner, { originalname: 'synthetic-resume.txt', mimetype: 'text/plain', buffer, size: buffer.length });
    expect(upload.attachmentSha256).toBe(createHash('sha256').update(buffer).digest('hex'));
    const saved = await resumes.save(owner, { requestId: crypto.randomUUID(), stagingId: upload.stagingId, label: '全栈简历 v1', text: `合成简历\n${resumeText}`, warningsAcknowledged: true });
    resumeVersionId = saved.id;
    expect(saved.textSha256).toBe(createHash('sha256').update(saved.text, 'utf8').digest('hex'));
    const original = await resumes.original(owner, saved.id);
    expect(createHash('sha256').update(original.bytes).digest('hex')).toBe(saved.attachmentSha256);
    await expect(resumes.original(other, saved.id)).rejects.toThrow();
    await expect(resumes.get(other, saved.id)).rejects.toThrow();
  });

  it('creates a task with the selected model connection and scans with native filters', async () => {
    const model = await api.models.save(owner, { baseUrl: provider.baseUrl, model: 'coach-alpha', apiKey: 'fixture-alpha-key', remember: false, timeoutMs: 10000 });
    // A check never launches the browser, so the owner opens the dedicated session explicitly first.
    await api.openSession(owner);
    await waitIdle(30000);
    expect((await api.store.session(owner))?.state).toBe('ready');
    const task = await api.createTask(owner, { requestId: crypto.randomUUID(), resumeVersionId, modelConnectionId: model.id, policy, dataProcessingAcknowledged: true });
    taskId = task.id;
    expect(task.state).toEqual({ status: 'active', phase: 'queued' });
    await waitIdle();
    const { task: refreshed, list } = await postings();
    expect(refreshed.state).toEqual({ status: 'active', phase: 'review' });
    expect(refreshed.readCount).toBeGreaterThanOrEqual(10);
    const byCompany = new Map(list.map(row => [row.observed.company, row]));
    expect(byCompany.get('示例自研科技')?.decision.disposition).toBe('eligible');
    expect(byCompany.get('示例低薪公司')?.decision.disposition).toBe('excluded');
    expect(byCompany.get('示例外包服务')?.decision.disposition).toBe('excluded');
    expect(byCompany.get('某某人才服务公司')?.decision.disposition).toBe('excluded');
    expect(byCompany.get('示例未知关系公司')?.decision.disposition).toBe('needs_review');
    expect(byCompany.get('示例销售公司')?.decision.disposition).toBe('excluded');
    const qualified = byCompany.get('示例自研科技');
    expect(qualified?.greeting?.text).toContain('您好');
    expect(qualified?.match?.assessments.length).toBeGreaterThan(0);
    expect(fixture.state.requestedFilters.some(filter => filter.city === '广州' && filter.position === '全栈')).toBe(true);
    expect(fixture.state.requestedFilters.some(filter => filter.city === '深圳' && filter.position === 'Agent 开发')).toBe(true);
    expect(fixture.state.requestedFilters.some(filter => filter.salary === '10-20K')).toBe(true);
  }, 180000);

  it('freezes an exact approval and rejects stale, ineligible or replayed content', async () => {
    const { task, list } = await postings();
    const eligible = list.filter(row => row.decision.disposition === 'eligible');
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    const chosen = ['示例自研科技', '示例自研软件', '示例自研平台'].map(company => eligible.find(row => row.observed.company === company));
    expect(chosen.every(Boolean)).toBe(true);
    const items = chosen.map((row, index) => ({ taskPostingId: row!.id, postingSnapshotHash: row!.snapshotHash, greetingDraftRevision: row!.greetingRevision, finalGreeting: `${row!.greeting?.text ?? '您好，希望进一步沟通。'}（候选人确认 ${index + 1}）` }));
    const requestId = crypto.randomUUID();
    const input = { requestId, expectedTaskRevision: task.revision, resumeVersionId, items };
    await expect(api.approve(owner, taskId, { ...input, expectedTaskRevision: task.revision - 1 })).rejects.toThrow();
    await expect(api.approve(owner, taskId, { ...input, items: [{ ...items[0]!, postingSnapshotHash: 'f'.repeat(64) }, ...items.slice(1)] })).rejects.toThrow();
    const lowSalary = list.find(row => row.observed.company === '示例低薪公司');
    await expect(api.approve(owner, taskId, { ...input, requestId: crypto.randomUUID(), items: [{ taskPostingId: lowSalary!.id, postingSnapshotHash: lowSalary!.snapshotHash, greetingDraftRevision: lowSalary!.greetingRevision, finalGreeting: '您好，我想申请这个岗位并进一步沟通。' }] })).rejects.toThrow();
    const batch = await api.approve(owner, taskId, input);
    batchId = batch.id;
    expect(batch.items.map(item => item.greeting)).toEqual(items.map(item => item.finalGreeting));
    expect(batch.attachmentSha256).toBe((await resumes.get(owner, resumeVersionId)).attachmentSha256);
    expect(batch.resumeVersionId).toBe(resumeVersionId);
    const replay = await api.approve(owner, taskId, input);
    expect(replay.id).toBe(batch.id);
    await expect(api.approve(owner, taskId, { ...input, items: [{ ...items[0]!, finalGreeting: '您好，改过的招呼语，希望进一步沟通这个岗位。' }, ...items.slice(1)] })).rejects.toThrow();
  }, 60000);

  it('delivers conversation and the exact original attachment, pausing only uncertain items', async () => {
    const before = fixture.counts();
    await waitIdle();
    const batch = await api.batchView(owner, batchId);
    expect(batch.items).toHaveLength(3);
    const byCompany = new Map(batch.items.map(item => [item.company, item]));
    const confirmed = byCompany.get('示例自研科技');
    expect(confirmed?.conversation.state).toBe('confirmed');
    expect(confirmed?.attachment.state).toBe('confirmed');
    const consent = byCompany.get('示例自研软件');
    expect(consent?.conversation.state).toBe('unknown');
    expect(consent?.attachment.state).toBe('awaiting_consent');
    const unknown = byCompany.get('示例自研平台');
    expect(unknown?.conversation.state).toBe('unknown');
    expect(byCompany.get('示例自研平台')?.attachment.state).toBe('blocked_by_conversation');
    expect(batch.state).toBe('completed_with_review');
    expect(fixture.counts().conversations).toBe(before.conversations + 2);
    const attachment = fixture.state.attachments.find(item => item.sha256 === batch.attachmentSha256);
    expect(attachment?.byteSize).toBe((await resumes.original(owner, resumeVersionId)).bytes.length);
    const afterFirstDelivery = fixture.counts();
    await waitIdle();
    expect(fixture.counts()).toEqual(afterFirstDelivery);
  }, 180000);

  it('generates ten grounded preparation questions per approved posting without blocking delivery', async () => {
    const preparations = await api.store.preparationsForTask(taskId);
    expect(preparations).toHaveLength(3);
    const ready = preparations.filter(preparation => preparation.status === 'ready');
    expect(ready.length).toBe(3);
    const view = await api.getPreparation(owner, ready[0]!.id);
    expect(view.preparation?.questions).toHaveLength(10);
    // The preparation view carries the frozen sources, so the UI does not re-fetch the task, postings and resume.
    expect(view.resumeVersionId).toBe(resumeVersionId);
    expect(view.resume.textSha256).toBe(view.resumeTextSha256);
    expect(view.resume.text.length).toBeGreaterThan(20);
    expect(view.posting.sitePostingId).toBeTruthy();
    expect(view.posting.jdText.length).toBeGreaterThan(20);
    expect(view.jdSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(['fullstack', 'general']).toContain(view.roleFamily);
    expect(new Set(view.preparation?.questions.map(question => question.purpose)).size).toBeGreaterThanOrEqual(2);
    expect(view.preparation?.questions.every(question => question.jdSources.length > 0)).toBe(true);
    expect(view.model.label).toBe('coach-alpha');
    const edited = await api.patchPreparation(owner, ready[0]!.id, {
      requestId: crypto.randomUUID(), expectedRevision: view.revision,
      questions: view.preparation!.questions.map((question, index) => ({ id: question.id, title: index === 0 ? '编辑后的题目一' : question.title, text: question.text, assessmentPoints: question.assessmentPoints, referenceAnswerGuidance: question.referenceAnswerGuidance, jdSources: question.jdSources, basis: question.basis })),
    });
    expect(edited.preparation?.questions[0]?.title).toBe('编辑后的题目一');
    const exported = await api.exportPreparation(owner, ready[0]!.id, 'markdown');
    expect(exported.body).toContain('编辑后的题目一');
    expect(exported.body).not.toContain(dataDir);
    const banked = await api.savePreparationToBank(owner, ready[0]!.id, { questions: [{ questionId: edited.preparation!.questions[0]!.id, requestId: crypto.randomUUID() }] });
    expect(banked).toHaveLength(1);
    expect(banked[0]?.career?.preparationId).toBe(ready[0]!.id);
    expect(banked[0]?.content).toContain('第 1 题');
  }, 120000);

  it('keeps preparation failure independent from delivery and retries only preparation', async () => {
    const { task } = await postings();
    const postingsList = await api.listPostings(owner, taskId);
    const unselected = postingsList.find(row => row.observed.company === '示例未知关系公司');
    expect(unselected).toBeDefined();
    provider.state.failCareer = true;
    const preparation = await api.manualPreparation(owner, taskId, unselected!.id);
    await waitIdle(60000);
    const failed = await api.getPreparation(owner, preparation.id);
    expect(failed.status).toBe('failed');
    provider.state.failCareer = false;
    const before = fixture.counts();
    await api.retryPreparation(owner, preparation.id, { requestId: crypto.randomUUID() });
    await waitIdle(60000);
    const retried = await api.getPreparation(owner, preparation.id);
    expect(retried.status).toBe('ready');
    expect(retried.preparation?.questions).toHaveLength(10);
    expect(fixture.counts()).toEqual(before);
    const batch = await api.batchView(owner, batchId);
    expect(batch.items.filter(item => item.conversation.state === 'confirmed')).toHaveLength(1);
    expect(task.readCount).toBeGreaterThan(0);
  }, 120000);

  it('persists cross-task dedup for contacted and unknown postings', async () => {
    const settings = await api.models.settings(owner);
    expect(settings.active?.id).toBeDefined();
    const second = await api.createTask(owner, { requestId: crypto.randomUUID(), resumeVersionId, modelConnectionId: settings.active!.id, policy, dataProcessingAcknowledged: true });
    const previousTask = taskId;
    taskId = second.id;
    await waitIdle();
    const list = await api.listPostings(owner, taskId);
    const contacted = list.find(row => row.observed.company === '示例自研科技');
    expect(contacted?.decision.reasons.some(reason => reason.code === 'already_contacted')).toBe(true);
    expect(contacted?.decision.disposition).toBe('excluded');
    const pending = list.find(row => row.observed.company === '示例附件公司');
    expect(pending?.decision.disposition).toBe('eligible');
    taskId = previousTask;
  }, 180000);

  it('isolates owners across tasks, batches and preparations', async () => {
    await expect(api.getTask(other, taskId)).rejects.toThrow();
    await expect(api.listPostings(other, taskId)).rejects.toThrow();
    await expect(api.batchView(other, batchId)).rejects.toThrow();
    const preparations = await api.store.preparationsForTask(taskId);
    await expect(api.getPreparation(other, preparations[0]!.id)).rejects.toThrow();
    await expect(api.resumeAttachment(other, batchId, (await api.batchView(owner, batchId)).items[0]!.id, { requestId: crypto.randomUUID(), expectedRevision: 0 })).rejects.toThrow();
  }, 60000);

  it('pauses the whole task on a login requirement and resumes only after an observed login', async () => {
    fixture.state.loggedIn = false;
    const settings = await api.models.settings(owner);
    const task = await api.createTask(owner, { requestId: crypto.randomUUID(), resumeVersionId, modelConnectionId: settings.active!.id, policy, dataProcessingAcknowledged: true });
    await waitIdle(30000);
    const paused = await api.getTask(owner, task.id);
    expect(paused.state).toMatchObject({ status: 'paused', reason: 'login_required' });
    const session = await api.store.session(owner);
    expect(session?.state).toBe('login_required');
    const browser = browsers.get(owner);
    const page = await browser!.ensureBrowser();
    await page.goto(`${fixture.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#login-submit');
    await page.waitForSelector('.user-nav');
    const checked = await api.checkSession(owner);
    expect(checked.session.state).toBe('ready');
    await api.resumeTask(owner, task.id, { requestId: crypto.randomUUID(), expectedRevision: paused.revision });
    await waitIdle();
    const resumed = await api.getTask(owner, task.id);
    expect(resumed.state).toEqual({ status: 'active', phase: 'review' });
    fixture.state.loggedIn = true;
  }, 180000);

  it('deletes a resume version, its tasks and private original bytes', async () => {
    await resumes.remove(owner, resumeVersionId, crypto.randomUUID());
    await waitIdle(60000);
    expect(await api.store.getResumeVersion(owner, resumeVersionId)).toBeNull();
    const tasks = await api.listTasks(owner);
    expect(tasks.length).toBe(0);
    const files = await api.store.pool.query("SELECT count(*) AS total FROM app_resume_files WHERE owner=$1", [owner]);
    expect(files.rows[0]?.total).toBe(0);
  }, 60000);

  it('deletes derived bank questions and strict interviews with a career task and retries an unconfirmed receipt purge', async () => {
    const interviewApi = new InterviewService({ ...apiConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin });
    const agentPool = new Pool({ connectionString: TEST_AGENT_DATABASE });
    const createdSessions: string[] = [];
    try {
      const buffer = Buffer.from(`合成删除简历\n${resumeText}\n`, 'utf8');
      const upload = await resumes.upload(owner, { originalname: 'synthetic-delete.txt', mimetype: 'text/plain', buffer, size: buffer.length });
      const version = await resumes.save(owner, { requestId: crypto.randomUUID(), stagingId: upload.stagingId, label: '删除清理简历', text: `合成删除简历\n${resumeText}`, warningsAcknowledged: true });
      const settings = await api.models.settings(owner);
      const modelConnectionId = settings.active?.id ?? (await api.models.save(owner, { baseUrl: provider.baseUrl, model: 'coach-alpha', apiKey: 'fixture-alpha-key', remember: false, timeoutMs: 10000 })).id;
      // The deletion above released this owner's browser actor, so the owner opens the session again
      // before the new task: an automated check never starts a browser on its own.
      await api.openSession(owner);
      await waitIdle(30000);
      expect((await api.store.session(owner))?.state).toBe('ready');
      const task = await api.createTask(owner, { requestId: crypto.randomUUID(), resumeVersionId: version.id, modelConnectionId, policy, dataProcessingAcknowledged: true });
      await waitIdle();
      const target = (await api.listPostings(owner, task.id)).find(row => row.match !== null);
      expect(target).toBeDefined();
      const preparation = await api.manualPreparation(owner, task.id, target!.id);
      await waitIdle();
      const view = await api.getPreparation(owner, preparation.id);
      expect(view.status).toBe('ready');
      // The bank keeps the personal career provenance; the control question is owner-scoped but independent.
      const banked = await api.savePreparationToBank(owner, preparation.id, { questions: [{ questionId: view.preparation!.questions[0]!.id, requestId: crypto.randomUUID() }] });
      const derivedBankId = banked[0]!.id;
      const controlBank = await api.bank.create(owner, crypto.randomUUID(), bankDraftSchema.parse({
        title: '独立的 JD 问题', content: '请说明你如何验证幂等键在并发请求下仍然有效，并给出可观察的证据。', category: 'technical', difficulty: 'medium', roleFamilies: ['general'],
        jdRequirement: { competency: '幂等与验证', priority: 'required', quote: '独立整理的岗位要求原文，不来自被删除的简历。' },
      }));
      const options = { durationMinutes: 60, answerLength: 'short' as const, candidateLevel: 'experienced' as const, round: 'first' as const, practiceMode: 'candidate' as const, roleType: 'technical' as const, roleFamily: 'fullstack' as const, codingRequested: false };
      const derivedInterview = await interviewApi.create(owner, { ...input, planning: { ...options, bankMode: 'strict', bankIds: [derivedBankId] } });
      const controlInterview = await interviewApi.create(owner, { ...input, planning: { ...options, bankMode: 'strict', bankIds: [controlBank.id] } });
      createdSessions.push(derivedInterview.id, controlInterview.id);
      expect((await api.store.pool.query("SELECT 1 FROM app_interview_materials WHERE session_id IN (SELECT value FROM json_each($1))", [[derivedInterview.id, controlInterview.id]])).rowCount).toBe(2);
      const derivedJobs = await api.store.pool.query("SELECT id FROM app_jobs WHERE session_id=$1", [derivedInterview.id]);
      expect(derivedJobs.rowCount).toBeGreaterThan(0);
      expect((await api.store.pool.query("SELECT count(*) AS total FROM app_career_work WHERE owner=$1 AND status='queued'", [owner])).rows[0]?.total).toBe(0);

      // Freeze the shared test database: no other actor may complete this cleanup first.
      if (ticker) { clearInterval(ticker); ticker = undefined; }
      await api.store.pool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','+1 hour') WHERE owner<>$1 AND status IN ('queued','processing')", [owner]);

      await api.deleteTask(owner, task.id);
      await expect(api.getTask(owner, task.id)).rejects.toThrow();
      const remaining = await api.bank.list(owner);
      expect(remaining.some(question => question.id === derivedBankId)).toBe(false);
      expect(remaining.some(question => question.id === controlBank.id)).toBe(true);
      await expect(interviewApi.get(owner, derivedInterview.id)).rejects.toThrow();
      expect((await interviewApi.get(owner, controlInterview.id)).id).toBe(controlInterview.id);
      expect((await api.store.pool.query("SELECT count(*) AS total FROM app_interview_materials WHERE session_id=$1", [derivedInterview.id])).rows[0]?.total).toBe(0);
      expect((await api.store.pool.query("SELECT count(*) AS total FROM app_interview_materials WHERE session_id=$1", [controlInterview.id])).rows[0]?.total).toBe(1);
      expect((await api.store.pool.query("SELECT count(*) AS total FROM app_career_task_postings WHERE task_id=$1", [task.id])).rows[0]?.total).toBe(0);
      expect(await api.store.getResumeVersion(owner, version.id)).not.toBeNull();
      const queuedDeletions = await api.store.pool.query("SELECT job_id FROM app_deletions WHERE job_id IN (SELECT value FROM json_each($1))", [derivedJobs.rows.map(row => row.id)]);
      expect(queuedDeletions.rowCount).toBe(derivedJobs.rowCount);

      // The durable cleanup was written before the cascade and carries the real receipt keys.
      const purge = await api.store.pool.query("SELECT id, payload FROM app_career_work WHERE owner=$1 AND kind='purge' AND status='queued' ORDER BY created_at DESC LIMIT 1", [owner]);
      const purgeRow = z.object({ id: z.string(), payload: z.object({ workIds: z.array(z.string()) }) }).parse(purge.rows[0]);
      const purgeWorkId = purgeRow.id;
      const receiptIds = purgeRow.payload.workIds;
      expect(receiptIds.length).toBeGreaterThan(0);
      const existing = await agentPool.query("SELECT work_id FROM agent_runtime_career_receipts WHERE work_id IN (SELECT value FROM json_each($1))", [receiptIds]);
      expect(existing.rowCount).toBeGreaterThan(0);
      const failId = existing.rows[0]!.work_id as string;

      let failOnce: string | null = failId;
      const purgeWorker = new CareerWorker(
        { ...workerConfig(), DATABASE_URL: TEST_DATABASE, AGENT_URL: bridge.origin, CAREER_LOCAL_DATA_DIR: dataDir, BOSS_SITE_ORIGIN: fixture.origin, BOSS_BROWSER_ENGINE: 'moli' },
        {
          browserFor: () => { throw new Error('PURGE_MUST_NOT_OPEN_A_BROWSER'); },
          agent: {
            match: async () => { throw new Error('PURGE_MUST_NOT_MATCH'); },
            prepare: async () => { throw new Error('PURGE_MUST_NOT_PREPARE'); },
            purgeReceipt: async workId => {
              if (workId === failOnce) { failOnce = null; return false; }
              const response = await fetch(`${bridge.origin}/internal/v1/career/receipts/${workId}`, { method: 'DELETE', headers: { authorization: `Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}` }, signal: AbortSignal.timeout(10000) });
              return response.ok;
            },
          },
        },
      );
      try {
        await purgeWorker.tick();
        const held = await api.store.pool.query("SELECT status, failure FROM app_career_work WHERE id=$1", [purgeWorkId]);
        expect(held.rows[0]?.status).toBe('queued');
        expect(held.rows[0]?.failure).toContain('PURGE_INCOMPLETE');
        // One unconfirmed deletion never reports success and writes no tombstone.
        expect((await agentPool.query("SELECT 1 FROM agent_runtime_career_receipts WHERE work_id=$1", [failId])).rowCount).toBe(1);
        expect((await agentPool.query("SELECT 1 FROM agent_runtime_deleted_career_work WHERE work_id=$1", [failId])).rowCount).toBe(0);
        expect(await api.store.claimWork(['purge'])).toBeNull();
        await api.store.pool.query("UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now','-1 second') WHERE id=$1", [purgeWorkId]);
        await purgeWorker.tick();
        expect((await api.store.pool.query("SELECT status FROM app_career_work WHERE id=$1", [purgeWorkId])).rows[0]?.status).toBe('completed');
        expect((await agentPool.query("SELECT work_id FROM agent_runtime_career_receipts WHERE work_id IN (SELECT value FROM json_each($1))", [receiptIds])).rowCount).toBe(0);
        expect((await agentPool.query("SELECT work_id FROM agent_runtime_deleted_career_work WHERE work_id IN (SELECT value FROM json_each($1))", [receiptIds])).rowCount).toBe(receiptIds.length);
      } finally {
        await purgeWorker.close();
      }
    } finally {
      if (!ticker) ticker = setInterval(() => { void worker.tick(); }, 100);
      // Leave no pending interview job behind: a later generation-worker suite claims the oldest one.
      for (const sessionId of createdSessions) await interviewApi.remove(owner, sessionId).catch(() => {});
      await Promise.all([interviewApi.onModuleDestroy(), agentPool.end()]);
    }
  }, 300000);

  it('deletes expired staged originals by their real storage keys and keeps saved originals', async () => {
    const files = new ResumeFileStore(dataDir);
    const text = `合成过期简历\n${resumeText}`;
    const expiredBuffer = Buffer.from(`${text}\n`, 'utf8');
    const expiredUpload = await resumes.upload(owner, { originalname: 'synthetic-expired.txt', mimetype: 'text/plain', buffer: expiredBuffer, size: expiredBuffer.length });
    const expiredKey = (await api.store.pool.query("SELECT storage_key FROM app_resume_uploads WHERE id=$1", [expiredUpload.stagingId])).rows[0]?.storage_key as string;
    await api.store.pool.query("UPDATE app_resume_uploads SET expires_at=strftime('%Y-%m-%dT%H:%M:%f000Z','now','-1 hour') WHERE id=$1", [expiredUpload.stagingId]);
    const keptBuffer = Buffer.from(`合成保留简历\n${resumeText}\n`, 'utf8');
    const keptUpload = await resumes.upload(owner, { originalname: 'synthetic-kept.txt', mimetype: 'text/plain', buffer: keptBuffer, size: keptBuffer.length });
    const keptKey = (await api.store.pool.query("SELECT storage_key FROM app_resume_uploads WHERE id=$1", [keptUpload.stagingId])).rows[0]?.storage_key as string;
    const kept = await resumes.save(owner, { requestId: crypto.randomUUID(), stagingId: keptUpload.stagingId, label: '保留简历', text: `合成保留简历\n${resumeText}`, warningsAcknowledged: true });
    const triggerBuffer = Buffer.from(`合成触发简历\n${resumeText}\n`, 'utf8');
    await resumes.upload(owner, { originalname: 'synthetic-trigger.txt', mimetype: 'text/plain', buffer: triggerBuffer, size: triggerBuffer.length });

    // Claiming the expired row keeps its real key instead of expiring it out of the sweep's reach.
    expect((await api.store.pool.query("SELECT status FROM app_resume_uploads WHERE id=$1", [expiredUpload.stagingId])).rows[0]?.status).toBe('expired');
    expect((await api.store.pool.query("SELECT count(*) AS total FROM app_career_work WHERE owner=$1 AND kind='purge' AND payload->'storageKeys' ? $2", [owner, expiredKey])).rows[0]?.total).toBeGreaterThan(0);
    await waitIdle();
    expect(await files.exists(expiredKey)).toBe(false);
    expect(await files.exists(keptKey)).toBe(true);
    expect((await resumes.original(owner, kept.id)).bytes.length).toBe(keptBuffer.length);
  }, 120000);

  it('reports an unopened session as absent and only becomes ready after an explicit open', async () => {
    // Clearing releases the browser actor and the private profile, so no managed page is held any more.
    await api.clearSession(owner);
    await waitIdle(30000);
    expect((await api.store.session(owner))?.state).toBe('absent');
    // A check reads the page the actor holds; with none open it reports the absence instead of readiness.
    const checked = await api.checkSession(owner);
    expect(checked.session.state).toBe('absent');

    // Only the explicit open creates the page, and the check afterwards reads it without navigating.
    await api.openSession(owner);
    await waitIdle(30000);
    const opened = await api.store.session(owner);
    expect(opened?.state).toBe('ready');
    expect(opened?.engine).toBe('moli');
    expect(opened?.human_window).toBe('none');
    const reread = await api.checkSession(owner);
    expect(reread.session.state).toBe('ready');
  }, 60000);
});
