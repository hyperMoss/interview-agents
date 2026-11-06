import { describe, expect, it } from 'vitest';
import {
  bossSessionViewSchema, careerBatchItemViewSchema, careerDecisionSchema, careerGreetingSchema, careerTaskPostingViewSchema,
  type BossSessionView, type CareerBatchItemView, type CareerDecision, type CareerTaskPostingView,
} from '../packages/contracts/src/career';
import {
  actionLabels, approvalBlockers, approvalItems, approvalWarnings, batchItemActions, batchOutcome, formatSalary, greetingProblem,
  groupPostings, matchCoverage, preparationSummary, sessionGuidance, taskWarning, type CareerReasonCode,
} from '../apps/web/src/career-view';
import { personalizedPreparationSchema } from '../packages/contracts/src/preparation';

const hash = 'a'.repeat(64);
const decision = (disposition: CareerDecision['disposition'], codes: CareerReasonCode[], salary: Partial<CareerDecision['salary']> = {}): CareerDecision => careerDecisionSchema.parse({
  disposition,
  reasons: codes.map(code => ({ code, evidence: [] })),
  salary: { raw: '15-25K', status: 'monthly', currency: 'CNY', monthlyLowerCny: 15000, monthlyUpperCny: 25000, monthsPerYear: null, ...salary },
  blacklistMatches: [],
});
const greeting = (text: string) => careerGreetingSchema.parse({ text, factualClaims: [], uncertainties: [], modelAttribution: { kind: 'connection', connectionId: crypto.randomUUID(), model: 'fixture-model' } });
function posting(options: { disposition: CareerDecision['disposition']; codes: CareerReasonCode[]; title?: string; company?: string; greeting?: string }): CareerTaskPostingView {
  return careerTaskPostingViewSchema.parse({
    id: crypto.randomUUID(), postingId: crypto.randomUUID(), revision: 0, snapshotHash: hash,
    observed: {
      site: 'boss', sitePostingId: `fixture-${crypto.randomUUID().slice(0, 8)}`, url: `http://127.0.0.1:4178/job_detail/${crypto.randomUUID().slice(0, 8)}.html`,
      title: options.title ?? '全栈工程师', company: options.company ?? '示例自研科技', location: '广州·天河', salaryRaw: '15-25K',
      jdText: '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。', companyProfileText: '示例自研科技，自有研发团队。',
      identitySource: 'detail_link',
      nativeFilterEvidence: { searchKey: '广州:全栈', controls: [{ label: '城市', selected: '广州', url: 'http://127.0.0.1:4178/web/geek/job?city=广州' }] },
    },
    decision: decision(options.disposition, options.codes),
    match: null,
    greeting: options.greeting === undefined ? null : greeting(options.greeting),
    greetingRevision: options.greeting === undefined ? 0 : 2,
    ownerReview: null,
    preparation: null,
  });
}
function batchItem(conversation: CareerBatchItemView['conversation']['state'], attachment: CareerBatchItemView['attachment']['state']): CareerBatchItemView {
  return careerBatchItemViewSchema.parse({
    id: crypto.randomUUID(), taskPostingId: crypto.randomUUID(), revision: 3, company: '示例自研科技', title: '全栈工程师',
    location: '广州·天河', salaryRaw: '15-25K', snapshotHash: hash, greeting: '你好，我在示例项目里做过全栈开发，想和你聊聊这个岗位。', greetingSha256: hash,
    conversation: { state: conversation, evidence: [], reason: null },
    attachment: { state: attachment, evidence: [], reason: null, originalName: 'synthetic-resume.txt', attachmentSha256: hash },
    preparation: null,
  });
}
const session = (state: BossSessionView['state'], humanWindow: 'open' | 'none' = 'none'): BossSessionView => bossSessionViewSchema.parse({
  site: 'boss', engine: humanWindow === 'open' ? 'playwright' : 'moli', state, reason: null, accountMarker: null,
  generation: 0, humanWindow, affectedTaskIds: [], updatedAt: null, limitation: null,
});
const eligible = posting({ disposition: 'eligible', codes: ['role_matched', 'city_matched', 'salary_qualified', 'employment_direct'], greeting: '你好，我在示例项目里做过 React 与 NestJS 全栈开发，也有 LLM 应用经验，想了解这个岗位。' });

describe('career review presentation', () => {
  it('keeps every disposition visible and separates already-contacted records', () => {
    const records = [
      eligible,
      posting({ disposition: 'needs_review', codes: ['role_matched', 'city_matched', 'salary_qualified', 'employment_unknown'] }),
      posting({ disposition: 'excluded', codes: ['role_matched', 'city_matched', 'salary_below_minimum'] }),
      posting({ disposition: 'excluded', codes: ['already_contacted'] }),
    ];
    const groups = groupPostings(records);
    expect(groups.eligible.map(item => item.id)).toEqual([records[0]?.id]);
    expect(groups.needs_review.map(item => item.id)).toEqual([records[1]?.id]);
    expect(groups.excluded.map(item => item.id)).toEqual([records[2]?.id]);
    expect(groups.contacted.map(item => item.id)).toEqual([records[3]?.id]);
  });

  it('never claims a successful empty search and reports pause reasons by name', () => {
    expect(taskWarning({ state: { status: 'active', phase: 'review' }, readCount: 0, shortlistCount: 0 })).toContain('不是“没有符合条件的岗位”');
    expect(taskWarning({ state: { status: 'paused', phase: 'searching', reason: 'native_filter_unverified', detail: '原生筛选未确认' }, readCount: 4, shortlistCount: 0 })).toContain('原生筛选未能确认生效');
    expect(taskWarning({ state: { status: 'active', phase: 'searching' }, readCount: 4, shortlistCount: 2 })).toBeNull();
  });

  it('parses salary text without inventing a monthly value', () => {
    expect(formatSalary(decision('eligible', ['salary_qualified']))).toContain('15000–25000 元/月');
    expect(formatSalary(decision('excluded', ['salary_below_minimum'], { raw: '10-15K', monthlyLowerCny: 10000, monthlyUpperCny: 15000 }))).toContain('10000–15000 元/月');
    expect(formatSalary(decision('needs_review', ['salary_needs_review'], { raw: '面议', status: 'negotiable', monthlyLowerCny: null, monthlyUpperCny: null }))).toContain('面议');
    expect(formatSalary(decision('needs_review', ['salary_needs_review'], { raw: '20K以上', status: 'unknown', monthlyLowerCny: null, monthlyUpperCny: null }))).toContain('需人工核对');
  });

  it('shows grounded coverage instead of a pass score', () => {
    expect(matchCoverage({ ...eligible, match: null })).toBeNull();
    const withMatch = careerTaskPostingViewSchema.parse({
      ...eligible,
      match: {
        assessments: [
          { kind: 'supported', competency: 'React 全栈开发', priority: 'required', jdSources: [{ kind: 'jd', snapshotHash: hash, start: 0, end: 20, quote: '负责全栈应用开发：React 前端' }], resumeSources: [{ kind: 'resume', resumeVersionId: crypto.randomUUID(), resumeTextHash: hash, start: 0, end: 18, quote: '示例项目里的全栈开发' }], rationale: '简历里有对应实现。' },
          { kind: 'gap', competency: 'PostgreSQL 建模', priority: 'preferred', jdSources: [{ kind: 'jd', snapshotHash: hash, start: 20, end: 40, quote: 'PostgreSQL 数据建模' }], explanation: '简历没有体现建模经验。' },
        ],
        strengths: ['有全栈交付经验'], gaps: ['数据建模需要准备'], uncertainties: [], aiApplication: { value: 'unknown', jdSources: [] },
        modelAttribution: { kind: 'connection', connectionId: crypto.randomUUID(), model: 'fixture-model' },
      },
    });
    expect(matchCoverage(withMatch)).toEqual({ requiredSupport: '1/1', requiredGaps: 0, preferredSupport: '0/1' });
  });
});

describe('career approval composition', () => {
  it('rejects more than ten items, non-eligible rows, short greetings and a clearing session', () => {
    const eleven = Array.from({ length: 11 }, () => posting({ disposition: 'eligible', codes: ['role_matched'], greeting: eligible.greeting?.text }));
    const greetings = Object.fromEntries(eleven.map(item => [item.id, item.greeting?.text ?? '']));
    expect(approvalBlockers({ selected: eleven, greetings, resumeVersionId: crypto.randomUUID(), session: session('ready') })).toContain('一批最多 10 个岗位，当前选了 11 个。');
    const review = posting({ disposition: 'needs_review', codes: ['employment_unknown'] });
    expect(approvalBlockers({ selected: [review], greetings: { [review.id]: '你好，我想了解这个岗位的具体职责和团队情况。' }, resumeVersionId: crypto.randomUUID(), session: session('ready') })).toContain('所选岗位里包含需复核或已排除的记录，只能批准可投递岗位。');
    expect(approvalBlockers({ selected: [eligible], greetings: { [eligible.id]: '太短了' }, resumeVersionId: crypto.randomUUID(), session: session('ready') }).join()).toContain('招呼语至少需要 10 个字符');
    expect(approvalBlockers({ selected: [eligible], greetings: { [eligible.id]: eligible.greeting?.text ?? '' }, resumeVersionId: null, session: session('ready') })).toContain('先选择本任务固定的简历版本。');
    expect(approvalBlockers({ selected: [eligible], greetings: { [eligible.id]: eligible.greeting?.text ?? '' }, resumeVersionId: crypto.randomUUID(), session: session('clearing') })).toContain('BOSS 会话正在清除，不能批准新的外发。');
    expect(approvalBlockers({ selected: [eligible], greetings: {}, resumeVersionId: crypto.randomUUID(), session: session('ready') })).toEqual([]);
  });

  it('warns that a not-ready session only pauses delivery instead of faking readiness', () => {
    expect(approvalWarnings({ selected: [eligible], session: session('absent') })).toContain('本机 BOSS 会话尚未确认就绪。批准后批次会先暂停，登录并检查会话后再手动恢复。');
    expect(approvalWarnings({ selected: [eligible], session: session('ready') })).toContain('部分岗位缺少模型匹配结果：硬条件仍然有效，但不会展示匹配依据。');
  });

  it('freezes the exact edited text with the draft revision and snapshot hash', () => {
    const edited = '你好，我在示例项目里负责 React 与 NestJS 全栈开发，也做过 LLM 应用，希望进一步了解这个岗位。';
    const items = approvalItems([eligible], { [eligible.id]: edited });
    expect(items).toEqual([{ taskPostingId: eligible.id, postingSnapshotHash: eligible.snapshotHash, greetingDraftRevision: 2, finalGreeting: edited }]);
    expect(greetingProblem(edited)).toBeNull();
    expect(greetingProblem('x'.repeat(1201))).toContain('不能超过 1200');
  });
});

describe('career delivery actions', () => {
  it('never offers a blind retry for confirmed, unknown or awaiting-consent effects', () => {
    expect(batchItemActions(batchItem('confirmed', 'confirmed'), 'completed')).toEqual([]);
    expect(batchItemActions(batchItem('unknown', 'unknown'), 'delivering')).toEqual(['reconcile']);
    expect(batchItemActions(batchItem('confirmed', 'awaiting_consent'), 'delivering')).toEqual(['reconcile', 'resume_attachment']);
    expect(batchItemActions(batchItem('confirmed', 'failed'), 'delivering')).toEqual(['retry_attachment']);
    expect(batchItemActions(batchItem('failed', 'blocked_by_conversation'), 'delivering')).toEqual(['retry_conversation']);
    expect(batchItemActions(batchItem('failed', 'blocked_by_conversation'), 'cancelled')).toEqual([]);
    expect(actionLabels.retry_attachment).toContain('不重复招呼语');
  });

  it('summarises each phase separately and keeps the pause reason', () => {
    const outcome = batchOutcome({
      state: 'paused', pauseReason: 'login_required', items: [batchItem('confirmed', 'awaiting_consent'), batchItem('unknown', 'unknown'), batchItem('not_started', 'blocked_by_conversation')],
    });
    expect(outcome.conversations).toEqual({ confirmed: 1, awaiting: 0, failed: 0, unknown: 1, pending: 1 });
    expect(outcome.attachments).toEqual({ confirmed: 0, awaiting: 1, failed: 0, unknown: 1, pending: 1 });
    expect(outcome.pauseLabel).toBe('需要在本机浏览器登录');
  });
});

describe('career session guidance', () => {
  it('says the truth about a headless engine that cannot host a login window', () => {
    const headless = sessionGuidance(session('login_required', 'none'));
    expect(headless.tone).toBe('blocked');
    expect(headless.hostWindow).toBe(false);
    expect(headless.text).toContain('没有可操作窗口');
    const headed = sessionGuidance(session('login_required', 'open'));
    expect(headed.tone).toBe('action');
    expect(headed.text).toContain('本机弹出的浏览器窗口');
    expect(sessionGuidance(session('ready', 'open')).tone).toBe('ready');
    expect(sessionGuidance(session('restricted')).text).toContain('不会尝试绕过');
  });
});

describe('career preparation presentation', () => {
  it('counts question purposes and keeps gap questions labelled as preparation', () => {
    const question = (purpose: 'jd_skill' | 'resume_project' | 'skill_gap') => ({
      id: crypto.randomUUID(), title: `准备题 ${purpose}`, text: '请说明你在示例项目里的具体实现与验证方式，并解释取舍。',
      requirementIndex: 0, category: 'technical' as const, difficulty: 'medium' as const, purpose,
      jdSources: [{ kind: 'jd' as const, snapshotHash: hash, start: 0, end: 20, quote: '负责全栈应用开发：React 前端' }],
      basis: purpose === 'skill_gap'
        ? { kind: 'gap' as const, missingCompetency: 'PostgreSQL 建模', guidanceLabel: 'preparation_not_experience' as const }
        : { kind: 'resume_evidence' as const, resumeSources: [{ kind: 'resume' as const, resumeVersionId: crypto.randomUUID(), resumeTextHash: hash, start: 0, end: 18, quote: '示例项目里的全栈开发' }] },
      assessmentPoints: ['是否说明真实职责', '是否给出验证方式'],
      referenceAnswerGuidance: ['按 STAR 说明背景与取舍', '给出可验证的结果'],
    });
    const preparation = personalizedPreparationSchema.parse({
      kind: 'resume_jd',
      requirements: [{ competency: 'React 全栈开发', priority: 'required', quote: '负责全栈应用开发' }],
      questions: [question('jd_skill'), question('resume_project'), question('skill_gap'), ...Array.from({ length: 7 }, () => question('jd_skill'))],
      uncertainties: ['简历没有明确项目上线时间'],
      sourceHashes: { resume: hash, jd: hash },
      model: { connectionId: crypto.randomUUID(), label: 'fixture-model' },
      revision: 3,
    });
    const summary = preparationSummary(preparation);
    expect(summary?.questions).toBe(10);
    expect(summary?.purposes).toEqual([
      { purpose: 'jd_skill', label: 'JD 技能', count: 8 },
      { purpose: 'resume_project', label: '简历项目追问', count: 1 },
      { purpose: 'skill_gap', label: '缺口准备（不代表已有经历）', count: 1 },
    ]);
    expect(preparation.questions.filter(item => item.basis.kind === 'gap').every(item => item.basis.kind === 'gap' && item.basis.guidanceLabel === 'preparation_not_experience')).toBe(true);
  });
});
