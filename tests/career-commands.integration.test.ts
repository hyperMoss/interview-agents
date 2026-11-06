import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerService } from '../apps/api/src/career';
import { CareerConflict, type ResumeRow, type TaskRow } from '../packages/career/src/store';
import { digest, textSha256 } from '../packages/career/src/domain';
import { evaluatePosting } from '../packages/career/src/filters';
import type { CareerMatch, CareerPolicy } from '../packages/contracts/src/career';
import { apiConfig } from './fixtures';

const TEST_DATABASE = (process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite");
const suite = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

const resumeText = '合成简历\n在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。';
const greeting = '您好，我在简历中说明了全栈项目中的接口与数据建模经历，希望进一步沟通这个岗位。';

// Command identity, approval freeze and posting reservation at the shared store/API boundary.
// These are synthetic fixture identities; no browser or live site is involved.
suite('career command identity and posting reservation', () => {
  let api: CareerService;
  let dataDir: string;
  const owner = crypto.randomUUID();
  let modelConnectionId = '';

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'career-commands-'));
    api = new CareerService({ ...apiConfig(), DATABASE_URL: TEST_DATABASE, CAREER_LOCAL_DATA_DIR: dataDir });
    modelConnectionId = crypto.randomUUID();
    // An approval is bound to the observed account and generation, so the fixture session is ready first.
    await api.store.writeSession(owner, { state: 'ready', engine: 'moli', accountMarker: '0123456789abcdef', reason: null });
  }, 60000);

  afterAll(async () => {
    if (api) {
      // Only this run's synthetic owner: never leave claimable work that another worker could pick up.
      await api.store.pool.query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND status IN ('queued','processing')", [owner]);
      await api.close();
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  const store = () => api.store;
  const pool = () => api.store.pool;

  function policy(preferAiApplication: boolean): CareerPolicy {
    return { roleTargets: ['fullstack'], cities: ['广州'], salaryUpperMinCnyMonthly: 18000, preferAiApplication, companyBlacklistKeywords: [] };
  }

  function observed(sitePostingId: string, overrides: { salaryRaw?: string; jdText?: string; company?: string; companyProfileText?: string } = {}) {
    return {
      site: 'boss' as const, sitePostingId, url: `https://example.test/job_detail/${sitePostingId}.html`,
      title: '全栈工程师（AI 应用）', company: overrides.company ?? '示例自研科技', location: '广州·天河',
      salaryRaw: overrides.salaryRaw ?? '15-25K',
      jdText: overrides.jdText ?? '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用。',
      companyProfileText: overrides.companyProfileText ?? '示例自研科技，自有研发团队，公司直招。', identitySource: 'detail_link' as const,
      nativeFilterEvidence: { searchKey: '广州:fullstack', controls: [{ label: 'city', selected: '广州', url: 'https://example.test/web/geek/job?city=广州' }] },
    };
  }

  async function seedResume(label = '并发测试简历') {
    const upload = await store().createUpload(owner, {
      filename: 'synthetic-resume.txt', text: resumeText, warnings: [], storageKey: `career-commands/${crypto.randomUUID()}.txt`,
      sha256: textSha256(`${resumeText}\n`), byteSize: Buffer.byteLength(`${resumeText}\n`), contentType: 'text/plain',
    });
    return store().saveResumeVersion(owner, {
      requestId: crypto.randomUUID(), requestHash: digest({ kind: 'save-resume-version', stagingId: upload.id, label, text: resumeText }),
      stagingId: upload.id, label, text: resumeText, attachmentSha256: upload.sha256, byteSize: upload.byte_size,
      contentType: upload.content_type, originalName: upload.filename, storageKey: upload.storage_key,
      warnings: [], textSha256: textSha256(resumeText),
    });
  }

  async function seedReviewTask(resume: ResumeRow, taskPolicy: CareerPolicy): Promise<TaskRow> {
    const requestId = crypto.randomUUID();
    const task = await store().createTask(owner, {
      id: crypto.randomUUID(), resume, policy: taskPolicy, model: { connectionId: modelConnectionId, label: 'fixture-model' },
      requestId, requestHash: digest({ kind: 'create-career-task', requestId }),
    });
    await pool().query("UPDATE app_career_work SET status='cancelled' WHERE task_id=$1 AND kind='scan'", [task.id]);
    const review = await store().setTaskState(task.id, { phase: 'review' });
    if (!review) throw new Error('TASK_SEED_FAILED');
    return review;
  }

  /** A grounded match tuple: required coverage and the AI tie-break are the ordering inputs. */
  function matchFor(resume: ResumeRow, snapshotHash: string, jdText: string, input: { kind: 'supported' | 'gap'; ai: 'yes' | 'no' | 'unknown' }): CareerMatch {
    const quote = '负责全栈应用开发';
    const jdSource = { kind: 'jd' as const, snapshotHash, start: jdText.indexOf(quote), end: jdText.indexOf(quote) + quote.length, quote };
    const resumeQuote = resume.text.slice(0, 12);
    const assessment: CareerMatch['assessments'][number] = input.kind === 'supported'
      ? {
        kind: 'supported', competency: '全栈开发', priority: 'required', jdSources: [jdSource],
        resumeSources: [{ kind: 'resume', resumeVersionId: resume.id, resumeTextHash: resume.text_sha256, start: 0, end: resumeQuote.length, quote: resumeQuote }],
        rationale: '简历说明了同类技术栈的实际职责。',
      }
      : { kind: 'gap', competency: '大模型应用', priority: 'required', jdSources: [jdSource], explanation: '简历中没有可核对的模型应用经历。' };
    return {
      assessments: [assessment], strengths: [], gaps: [], uncertainties: [],
      aiApplication: { value: input.ai, jdSources: [jdSource] },
      modelAttribution: { kind: 'connection', connectionId: modelConnectionId, model: 'fixture-model' },
    };
  }

  async function seedPosting(task: TaskRow, taskPolicy: CareerPolicy, input: { sitePostingId: string; match: CareerMatch | null; overrides?: Parameters<typeof observed>[1] }) {
    const posting = observed(input.sitePostingId, input.overrides);
    const snapshotHash = digest(posting);
    const postingId = await store().upsertPosting(owner, posting);
    const taskPostingId = crypto.randomUUID();
    const decision = evaluatePosting({ policy: taskPolicy, posting });
    await store().upsertTaskPosting(owner, {
      id: taskPostingId, taskId: task.id, postingId, observed: posting, snapshotHash,
      disposition: decision.disposition, decision, match: input.match,
      greeting: { text: greeting, factualClaims: [], uncertainties: [], modelAttribution: { kind: 'connection', connectionId: modelConnectionId, model: 'fixture-model' } },
      existingRevision: null,
    });
    return { taskPostingId, postingId, snapshotHash, decision };
  }

  function approvalInput(task: TaskRow, resume: ResumeRow, items: Array<{ taskPostingId: string; postingSnapshotHash: string; greetingDraftRevision: number }>) {
    return {
      requestId: crypto.randomUUID(), expectedTaskRevision: task.revision, resumeVersionId: resume.id,
      items: items.map(item => ({ ...item, finalGreeting: greeting })),
    };
  }

  async function expectConflict(call: Promise<unknown>, code: string) {
    await expect(call).rejects.toMatchObject({ code });
  }

  /** Store-level approval input adds the ids/positions the API assigns before the store transaction. */
  function storeApproval(task: TaskRow, resume: ResumeRow, items: Array<{ taskPostingId: string; postingSnapshotHash: string; greetingDraftRevision: number }>) {
    const command = approvalInput(task, resume, items);
    return { id: crypto.randomUUID(), taskId: task.id, ...command, items: command.items.map((item, position) => ({ id: crypto.randomUUID(), position, ...item })) };
  }

  it('keeps an explicit outsourcing exclusion through owner review and the approval boundary', async () => {
    const resume = await seedResume('外包复核简历');
    const taskPolicy = policy(true);
    const task = await seedReviewTask(resume, taskPolicy);
    const seeded = await seedPosting(task, taskPolicy, {
      sitePostingId: 'fixture-outsourcing-review',
      match: null,
      overrides: { company: '示例外包服务', jdText: '外派至客户现场驻场开发，负责前端页面与接口联调。', companyProfileText: '示例外包服务，长期驻场人力外包。' },
    });
    expect(seeded.decision.disposition).toBe('excluded');
    const reviewed = await api.patchPosting(owner, task.id, seeded.taskPostingId, {
      requestId: crypto.randomUUID(), expectedRevision: 0,
      ownerReview: { decision: 'confirmed_direct', note: '招聘方口头表示直招', source: '聊天记录' },
    });
    expect(reviewed.decision.disposition).toBe('excluded');
    expect(reviewed.decision.reasons.some(reason => reason.code === 'employment_outsourcing')).toBe(true);
    expect(reviewed.decision.reasons.some(reason => reason.code === 'employment_direct')).toBe(false);
    await expect(api.approve(owner, task.id, approvalInput(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: seeded.snapshotHash, greetingDraftRevision: reviewed.greetingRevision }]))).rejects.toThrow();
    expect(await store().batchesForTask(task.id)).toHaveLength(0);
  }, 30000);

  it('returns the grounded shortlist order with the task AI tie-break preference', async () => {
    const resume = await seedResume('排序简历');
    const orderings: Array<{ prefer: boolean; expected: string[] }> = [{ prefer: true, expected: ['b', 'c', 'a'] }, { prefer: false, expected: ['b', 'a', 'c'] }];
    for (const ordering of orderings) {
      const taskPolicy = policy(ordering.prefer);
      const task = await seedReviewTask(resume, taskPolicy);
      const rows = [
        { sitePostingId: 'a', kind: 'gap' as const, ai: 'no' as const },
        { sitePostingId: 'b', kind: 'supported' as const, ai: 'yes' as const },
        { sitePostingId: 'c', kind: 'gap' as const, ai: 'yes' as const },
      ];
      for (const row of rows) {
        const posting = observed(row.sitePostingId);
        const snapshotHash = digest(posting);
        await seedPosting(task, taskPolicy, { sitePostingId: row.sitePostingId, match: matchFor(resume, snapshotHash, posting.jdText, row) });
      }
      await seedPosting(task, taskPolicy, { sitePostingId: 'd', match: null, overrides: { salaryRaw: '10-15K' } });
      const list = await api.listPostings(owner, task.id);
      expect(list.filter(row => row.decision.disposition === 'eligible').map(row => row.observed.sitePostingId)).toEqual(ordering.expected);
      expect(list.at(-1)?.observed.sitePostingId).toBe('d');
    }
  }, 60000);

  it('replays one resume version and one task for concurrent identical commands', async () => {
    const upload = await store().createUpload(owner, {
      filename: 'concurrent-resume.txt', text: resumeText, warnings: [], storageKey: `career-commands/${crypto.randomUUID()}.txt`,
      sha256: textSha256(`${resumeText}\n`), byteSize: Buffer.byteLength(`${resumeText}\n`), contentType: 'text/plain',
    });
    const requestId = crypto.randomUUID();
    const label = '并发简历版本';
    const requestHash = digest({ kind: 'save-resume-version', stagingId: upload.id, label, text: resumeText });
    const input = {
      requestId, requestHash, stagingId: upload.id, label, text: resumeText, attachmentSha256: upload.sha256,
      byteSize: upload.byte_size, contentType: upload.content_type, originalName: upload.filename,
      storageKey: upload.storage_key, warnings: [], textSha256: textSha256(resumeText),
    };
    const [first, second] = await Promise.all([store().saveResumeVersion(owner, input), store().saveResumeVersion(owner, { ...input })]);
    expect(second.id).toBe(first.id);
    const versions = await pool().query("SELECT count(*) AS total FROM app_resume_versions WHERE owner=$1 AND label=$2", [owner, label]);
    expect(versions.rows[0]?.total).toBe(1);
    const changedText = `${resumeText}另一处改动`;
    await expect(store().saveResumeVersion(owner, { ...input, text: changedText, requestHash: digest({ kind: 'save-resume-version', stagingId: upload.id, label, text: changedText }) })).rejects.toBeInstanceOf(CareerConflict);

    const createRequestId = crypto.randomUUID();
    const createInput = {
      id: crypto.randomUUID(), resume: first, policy: policy(true), model: { connectionId: modelConnectionId, label: 'fixture-model' },
      requestId: createRequestId, requestHash: digest({ kind: 'create-career-task', requestId: createRequestId }),
    };
    const [one, two] = await Promise.all([store().createTask(owner, createInput), store().createTask(owner, { ...createInput, id: crypto.randomUUID() })]);
    expect(two.id).toBe(one.id);
    const tasks = await pool().query("SELECT count(*) AS total FROM app_career_tasks WHERE owner=$1 AND resume_version_id=$2", [owner, first.id]);
    expect(tasks.rows[0]?.total).toBe(1);
  }, 60000);

  it('reserves one posting across concurrent approvals and replays the accepted command', async () => {
    const resume = await seedResume('并发审批简历');
    const taskPolicy = policy(true);
    const [firstTask, secondTask] = await Promise.all([seedReviewTask(resume, taskPolicy), seedReviewTask(resume, taskPolicy)]);
    const posting = observed('fixture-shared-reservation');
    const snapshotHash = digest(posting);
    const postingId = await store().upsertPosting(owner, posting);
    const seedTaskPosting = async (task: TaskRow) => {
      const taskPostingId = crypto.randomUUID();
      const decision = evaluatePosting({ policy: taskPolicy, posting });
      await store().upsertTaskPosting(owner, {
        id: taskPostingId, taskId: task.id, postingId, observed: posting, snapshotHash,
        disposition: decision.disposition, decision, match: null,
        greeting: { text: greeting, factualClaims: [], uncertainties: [], modelAttribution: { kind: 'connection', connectionId: modelConnectionId, model: 'fixture-model' } },
        existingRevision: null,
      });
      return taskPostingId;
    };
    const inputs = await Promise.all([firstTask, secondTask].map(async task => ({ input: storeApproval(task, resume, [{ taskPostingId: await seedTaskPosting(task), postingSnapshotHash: snapshotHash, greetingDraftRevision: 0 }]) })));
    const results = await Promise.allSettled(inputs.map(entry => store().approve(owner, entry.input)));
    const accepted = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ index, batch: result.value.batch }] : []);
    expect(accepted).toHaveLength(1);
    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'ALREADY_RESERVED' });
    const applications = await pool().query("SELECT state, batch_id FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, postingId]);
    expect(applications.rows).toHaveLength(1);
    expect(applications.rows[0]?.state).toBe('reserved');
    const replay = await store().approve(owner, inputs[accepted[0]!.index]!.input);
    expect(replay.replay).toBe(true);
    expect(replay.batch.id).toBe(accepted[0]!.batch.id);
    expect(await store().batchItems(owner, accepted[0]!.batch.id)).toHaveLength(1);
  }, 60000);

  it('keeps a confirmed conversation after a failed attachment and freezes the approved rows', async () => {
    const resume = await seedResume('附件失败简历');
    const taskPolicy = policy(true);
    const task = await seedReviewTask(resume, taskPolicy);
    const seeded = await seedPosting(task, taskPolicy, { sitePostingId: 'fixture-attachment-failed', match: null });
    await expectConflict(store().approve(owner, storeApproval(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: 'f'.repeat(64), greetingDraftRevision: 0 }])), 'POSTING_CHANGED');
    await expectConflict(store().approve(owner, storeApproval(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: seeded.snapshotHash, greetingDraftRevision: 1 }])), 'GREETING_CHANGED');
    const approved = await store().approve(owner, storeApproval(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: seeded.snapshotHash, greetingDraftRevision: 0 }]));
    const items = await store().batchItems(owner, approved.batch.id);
    expect(items).toHaveLength(1);
    const itemId = items[0]!.id;
    await pool().query("UPDATE app_career_batch_items SET conversation_state='confirmed', attachment_state='failed', revision=revision+1 WHERE id=$1", [itemId]);
    await pool().query("UPDATE app_career_applications SET state='attachment_failed', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, seeded.postingId]);
    await expectConflict(store().approve(owner, storeApproval(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: seeded.snapshotHash, greetingDraftRevision: 0 }])), 'ALREADY_RESERVED');
    const preserved = await store().batchItem(owner, approved.batch.id, itemId);
    expect(preserved?.conversation_state).toBe('confirmed');
    expect(await store().batchesForTask(task.id)).toHaveLength(1);
    const application = await pool().query("SELECT state, batch_id FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, seeded.postingId]);
    expect(application.rows[0]).toMatchObject({ state: 'attachment_failed', batch_id: approved.batch.id });
    // A conversation that provably never started may be re-approved through a fresh explicit command.
    await pool().query("UPDATE app_career_applications SET state='conversation_failed', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, seeded.postingId]);
    const retried = await store().approve(owner, storeApproval(task, resume, [{ taskPostingId: seeded.taskPostingId, postingSnapshotHash: seeded.snapshotHash, greetingDraftRevision: 0 }]));
    expect(retried.batch.id).not.toBe(approved.batch.id);
    expect(await store().batchesForTask(task.id)).toHaveLength(2);
  }, 60000);
});
