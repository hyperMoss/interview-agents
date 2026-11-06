import { describe, expect, it } from 'vitest';
import { careerPolicySchema, careerMatchReceiptSchema, type CareerMatchReceipt, type CareerPolicy, type ObservedPosting } from '../packages/contracts/src/career';
import { evaluatePosting, matchOrderingKey, orderShortlist, parseSalary } from '../packages/career/src/filters';
import { advanceAttachment, advanceConversation, approvalDigest, attachmentUnlocked, canReconcile, canRetryEffect, digest, sessionPauseReason, settleBatch, shouldPauseForPageFailures, normalizeSourceText, textSha256 } from '../packages/career/src/domain';
import { validateMatchReceipt, validatePersonalizedPreparation, type CareerGenerationSources } from '../packages/career/src/provenance';
import type { PersonalizedPreparationInput } from '../packages/contracts/src/preparation';
import { uuidFromHash } from '../apps/worker/src/career-worker';

const policy: CareerPolicy = careerPolicySchema.parse({
  roleTargets: ['fullstack', 'agent_development'], cities: ['广州', '深圳'], salaryUpperMinCnyMonthly: 18000,
  preferAiApplication: true, companyBlacklistKeywords: ['人才服务', 'Acme'],
});

function posting(overrides: Partial<ObservedPosting> = {}): ObservedPosting {
  return {
    site: 'boss', sitePostingId: 'fixture-qualified-fullstack', url: 'https://example.test/job_detail/fixture-qualified-fullstack.html',
    title: '全栈工程师（AI 应用）', company: '示例自研科技', location: '广州·天河', salaryRaw: '15-25K·13薪',
    jdText: '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用。',
    companyProfileText: '示例自研科技，自有研发团队，公司直招。', identitySource: 'detail_link',
    nativeFilterEvidence: { searchKey: '广州:fullstack', controls: [{ label: 'city', selected: '广州', url: 'https://example.test/web/geek/job?city=广州' }] },
    ...overrides,
  };
}

describe('salary semantics', () => {
  it('qualifies by the monthly upper bound and never lifts 13薪 into a higher monthly range', () => {
    expect(parseSalary('15-25K').monthlyUpperCny).toBe(25000);
    expect(parseSalary('18-18K')).toMatchObject({ status: 'monthly', monthlyLowerCny: 18000, monthlyUpperCny: 18000 });
    expect(parseSalary('10-15K').monthlyUpperCny).toBe(15000);
    expect(parseSalary('15-25K·13薪')).toMatchObject({ monthlyUpperCny: 25000, monthsPerYear: 13 });
    expect(parseSalary('12000-16000元/月').monthlyUpperCny).toBe(16000);
  });

  it('marks unknown units and open bounds as review instead of inventing a conversion', () => {
    expect(parseSalary('面议').status).toBe('negotiable');
    expect(parseSalary('25-35万/年').status).toBe('non_monthly');
    expect(parseSalary('300元/天').status).toBe('non_monthly');
    expect(parseSalary('20K以上')).toMatchObject({ status: 'unknown', monthlyLowerCny: 20000, monthlyUpperCny: null });
    expect(evaluatePosting({ policy, posting: posting({ salaryRaw: '面议' }) }).disposition).toBe('needs_review');
    expect(evaluatePosting({ policy, posting: posting({ salaryRaw: '10-15K' }) })).toMatchObject({ disposition: 'excluded' });
  });

  it('qualifies a range by its upper bound, so 17-30K clears an 18K threshold', () => {
    expect(parseSalary('17-30K')).toMatchObject({ status: 'monthly', monthlyLowerCny: 17000, monthlyUpperCny: 30000 });
    const decision = evaluatePosting({ policy, posting: posting({ salaryRaw: '17-30K' }) });
    expect(decision.disposition).toBe('eligible');
    expect(decision.reasons.map(reason => reason.code)).toContain('salary_qualified');
  });

  it('keeps a salary rendered in private-use glyphs unresolved instead of guessing its numbers', () => {
    // The live site sometimes renders salary digits as private-use glyphs; there is no honest mapping.
    const glyphs = '\uE0B7\uE0B8-\uE0B9\uE0BAK';
    expect(parseSalary(glyphs)).toMatchObject({ status: 'unknown', monthlyLowerCny: null, monthlyUpperCny: null });
    const decision = evaluatePosting({ policy, posting: posting({ salaryRaw: glyphs }) });
    expect(decision.disposition).toBe('needs_review');
    expect(decision.reasons.map(reason => reason.code)).toContain('salary_needs_review');
    // It can never reach an eligible shortlist, so it cannot enter an approved batch either.
    expect(orderShortlist([{ decision, match: null, sitePostingId: 'glyph-salary' }], true)).toHaveLength(0);
  });
});

describe('hard filters', () => {
  it('accepts an eligible direct-employment full stack posting and keeps salary evidence', () => {
    const decision = evaluatePosting({ policy, posting: posting() });
    expect(decision.disposition).toBe('eligible');
    expect(decision.reasons.map(reason => reason.code)).toEqual(expect.arrayContaining(['role_matched', 'city_matched', 'salary_qualified', 'employment_direct']));
    const fields: Record<string, string[]> = { title: [posting().title], company: [posting().company], location: [posting().location], salary: [posting().salaryRaw], jd: [posting().jdText], employment: [posting().jdText, posting().companyProfileText], link: [posting().url] };
    expect(decision.reasons.flatMap(reason => reason.evidence).every(evidence => fields[evidence.field]?.some(text => text.slice(evidence.start, evidence.end) === evidence.quote))).toBe(true);
  });

  it('ORs the two cities and two role targets and rejects non-development uses of Agent', () => {
    expect(evaluatePosting({ policy, posting: posting({ location: '深圳·南山', title: 'Agent 开发工程师', jdText: '负责 Agent 平台后端开发，使用 TypeScript 与 LLM 应用经验。' }) }).disposition).toBe('eligible');
    const sales = evaluatePosting({ policy, posting: posting({ title: 'AI Agent 销售顾问', jdText: '负责智能体产品的大客户销售，完成销售目标。' }) });
    expect(sales.disposition).toBe('excluded');
    expect(sales.reasons[0]?.code).toBe('role_mismatch');
  });

  it('reports literal blacklist matches with the exact observed span', () => {
    const decision = evaluatePosting({ policy, posting: posting({ company: 'ACME 人才服务有限公司', companyProfileText: 'ACME 人才服务有限公司' }) });
    expect(decision.disposition).toBe('excluded');
    const codes = decision.reasons.map(reason => reason.code);
    expect(codes).toContain('company_blacklisted');
    expect(decision.blacklistMatches.map(match => match.quote)).toEqual(expect.arrayContaining(['ACME', '人才服务']));
  });

  it('excludes explicit outsourcing and marks unknown employment for review instead of calling it direct', () => {
    const outsourcing = evaluatePosting({ policy, posting: posting({ company: '示例外包服务', jdText: '外派至客户现场驻场开发，负责前端页面与接口联调。', companyProfileText: '示例外包服务，长期驻场人力外包。' }) });
    expect(outsourcing.disposition).toBe('excluded');
    expect(outsourcing.reasons.some(reason => reason.code === 'employment_outsourcing')).toBe(true);
    const unknown = evaluatePosting({ policy, posting: posting({ companyProfileText: '示例未知关系公司，未说明雇佣关系。' }) });
    expect(unknown.disposition).toBe('needs_review');
    expect(unknown.reasons.some(reason => reason.code === 'employment_unknown')).toBe(true);
    const reviewed = evaluatePosting({ policy, posting: posting({ companyProfileText: '未说明雇佣关系。' }), ownerReview: { decision: 'confirmed_direct', note: '官网招聘页为公司直招', source: '公司官网' } });
    expect(reviewed.disposition).toBe('eligible');
    const outsourcingReviewed = evaluatePosting({
      policy, posting: posting({ company: '示例外包服务', jdText: '外派至客户现场驻场开发，负责前端页面与接口联调。', companyProfileText: '示例外包服务，长期驻场人力外包。' }),
      ownerReview: { decision: 'confirmed_direct', note: '招聘方口头表示直招', source: '聊天记录' },
    });
    expect(outsourcingReviewed.disposition).toBe('excluded');
    expect(outsourcingReviewed.reasons.some(reason => reason.code === 'employment_outsourcing')).toBe(true);
    expect(outsourcingReviewed.reasons.some(reason => reason.code === 'employment_direct')).toBe(false);
    const overridden = evaluatePosting({ policy, posting: posting({ salaryRaw: '10-15K' }), ownerReview: { decision: 'confirmed_direct', note: '想投', source: '主观' } });
    expect(overridden.disposition).toBe('excluded');
  });

  it('never spends eligibility on a posting without a stable identity', () => {
    expect(evaluatePosting({ policy, posting: posting({ identitySource: 'missing', sitePostingId: '' }) }).disposition).toBe('needs_review');
    expect(evaluatePosting({ policy, posting: posting({ identitySource: 'conflict' }) }).disposition).toBe('excluded');
  });
});

describe('grounded ordering', () => {
  const assessment = (kind: 'supported' | 'gap', priority: 'required' | 'preferred') => ({ kind, priority });
  const match = (assessments: ReturnType<typeof assessment>[], ai: 'yes' | 'no' | 'unknown') => ({ assessments, aiApplication: { value: ai } });

  it('orders by required coverage, unresolved required gaps, preferred coverage, AI preference and stable id', () => {
    const decision = evaluatePosting({ policy, posting: posting() });
    const rows = [
      { decision, sitePostingId: 'b', match: match([assessment('supported', 'required')], 'no') },
      { decision, sitePostingId: 'a', match: match([assessment('supported', 'required')], 'no') },
      { decision, sitePostingId: 'c', match: match([assessment('gap', 'required')], 'yes') },
      { decision, sitePostingId: 'd', match: match([assessment('supported', 'required'), assessment('supported', 'preferred')], 'yes') },
    ];
    expect(orderShortlist(rows, true).map(row => row.sitePostingId)).toEqual(['d', 'a', 'b', 'c']);
    expect(matchOrderingKey({ decision, sitePostingId: 'x', match: null }, true).hasMatch).toBe(0);
  });

  it('uses the AI application preference only to break an otherwise equal grounding tuple', () => {
    const decision = evaluatePosting({ policy, posting: posting() });
    const rows = ['a', 'b'].map((sitePostingId, index) => ({ decision, sitePostingId, match: match([assessment('supported', 'required')], index === 0 ? 'no' : 'yes') }));
    expect(orderShortlist(rows, true).map(row => row.sitePostingId)).toEqual(['b', 'a']);
    expect(orderShortlist(rows, false).map(row => row.sitePostingId)).toEqual(['a', 'b']);
  });

  it('keeps every eligible posting in the shortlist instead of applying a match cutoff', () => {
    const decision = evaluatePosting({ policy, posting: posting() });
    const rows = ['low', 'high'].map(id => ({ decision, sitePostingId: id, match: match([assessment('gap', 'required')], 'no') }));
    expect(orderShortlist(rows, true)).toHaveLength(2);
  });
});

describe('approval freeze and effect transitions', () => {
  const base = {
    taskId: '11111111-1111-4111-8111-111111111111', taskRevision: 3, resumeVersionId: '22222222-2222-4222-8222-222222222222',
    resumeTextSha256: textSha256('resume text'), attachmentSha256: textSha256('attachment bytes'), modelConnectionId: '33333333-3333-4333-8333-333333333333',
    sessionGeneration: 2, accountMarker: 'account-fixture',
    items: [{ taskPostingId: '44444444-4444-4444-8444-444444444444', postingSnapshotHash: digest('snapshot'), greetingDraftRevision: 1, finalGreeting: '您好，我在简历中说明了全栈项目经验，希望进一步沟通。' }],
  };

  it('changes the approval digest when greetings, snapshots, the resume or the bound session change', () => {
    const initial = approvalDigest(base);
    expect(approvalDigest({ ...base, items: [...base.items] })).toBe(initial);
    expect(approvalDigest({ ...base, items: [{ ...base.items[0]!, finalGreeting: '改过的招呼语，我希望进一步沟通。' }] })).not.toBe(initial);
    expect(approvalDigest({ ...base, resumeTextSha256: textSha256('other resume') })).not.toBe(initial);
    expect(approvalDigest({ ...base, items: [{ ...base.items[0]!, postingSnapshotHash: digest('other snapshot') }] })).not.toBe(initial);
    expect(approvalDigest({ ...base, sessionGeneration: base.sessionGeneration + 1 })).not.toBe(initial);
    expect(approvalDigest({ ...base, accountMarker: 'another-account-fixture' })).not.toBe(initial);
  });

  it('never replays a confirmed or unknown external effect', () => {
    expect(advanceConversation('not_started', 'dispatching')).toBe('dispatching');
    expect(advanceConversation('dispatching', 'confirmed')).toBe('confirmed');
    expect(() => advanceConversation('confirmed', 'dispatching')).toThrow('EFFECT_TRANSITION_REJECTED');
    expect(() => advanceConversation('unknown', 'dispatching')).toThrow('EFFECT_TRANSITION_REJECTED');
    expect(advanceConversation('failed', 'dispatching')).toBe('dispatching');
    expect(attachmentUnlocked('confirmed')).toBe('not_started');
    expect(attachmentUnlocked('unknown')).toBe('blocked_by_conversation');
    expect(canRetryEffect('conversation', 'unknown')).toBe(false);
    expect(canRetryEffect('attachment', 'failed')).toBe(true);
    expect(canReconcile('attachment', 'unknown')).toBe(true);
    expect(canReconcile('conversation', 'confirmed')).toBe(false);
  });

  it('requires an explicit continuation to retry after waiting for consent', () => {
    expect(advanceAttachment('awaiting_consent', 'dispatching', { explicitContinuation: true })).toBe('dispatching');
    expect(() => advanceAttachment('awaiting_consent', 'dispatching')).toThrow('EFFECT_TRANSITION_REJECTED');
    expect(() => advanceAttachment('confirmed', 'dispatching')).toThrow('EFFECT_TRANSITION_REJECTED');
  });

  it('settles a batch honestly with per-item uncertainty', () => {
    expect(settleBatch([{ conversation: 'confirmed', attachment: 'confirmed' }])).toBe('completed');
    expect(settleBatch([{ conversation: 'confirmed', attachment: 'unknown' }, { conversation: 'confirmed', attachment: 'confirmed' }])).toBe('completed_with_review');
    expect(settleBatch([{ conversation: 'confirmed', attachment: 'not_started' }])).toBe('delivering');
    expect(settleBatch([{ conversation: 'confirmed', attachment: 'awaiting_consent' }])).toBe('completed_with_review');
    expect(settleBatch([{ conversation: 'unknown', attachment: 'blocked_by_conversation' }], { paused: true })).toBe('paused');
    expect(settleBatch([{ conversation: 'unknown', attachment: 'blocked_by_conversation' }], { cancelled: true })).toBe('cancelled');
  });

  it('pauses the whole session on login, verification or restriction and after three broad failures', () => {
    expect(sessionPauseReason('login_required', '需要登录')).toEqual({ reason: 'login_required', detail: '需要登录' });
    expect(sessionPauseReason('verification_required', '验证码')).toMatchObject({ reason: 'verification_required' });
    expect(sessionPauseReason('restricted', '限制')).toMatchObject({ reason: 'site_restricted' });
    expect(sessionPauseReason('ready', '就绪')).toBeNull();
    expect(shouldPauseForPageFailures(2)).toBe(false);
    expect(shouldPauseForPageFailures(3)).toBe(true);
  });

  it('normalizes line endings without rewriting resume content', () => {
    expect(normalizeSourceText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(textSha256('a\nb')).toBe(textSha256('a\nb'));
    expect(uuidFromHash(digest({ a: 1 }))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(uuidFromHash(digest({ a: 1 }))).toBe(uuidFromHash(digest({ a: 1 })));
  });
});

describe('source provenance', () => {
  const jdText = '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用。';
  const resumeText = '在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。';
  const sources: CareerGenerationSources = {
    postingSnapshotHash: digest(jdText), jdText, resumeVersionId: '22222222-2222-4222-8222-222222222222',
    resumeTextHash: textSha256(resumeText), resumeText,
  };
  const jd = (quote: string) => ({ kind: 'jd' as const, snapshotHash: sources.postingSnapshotHash, start: jdText.indexOf(quote), end: jdText.indexOf(quote) + quote.length, quote });
  const resume = (quote: string) => ({ kind: 'resume' as const, resumeVersionId: sources.resumeVersionId, resumeTextHash: sources.resumeTextHash, start: resumeText.indexOf(quote), end: resumeText.indexOf(quote) + quote.length, quote });
  const attribution = { kind: 'connection' as const, connectionId: '33333333-3333-4333-8333-333333333333', model: 'fixture-model' };
  const receipt = (): CareerMatchReceipt => careerMatchReceiptSchema.parse({
    match: {
      assessments: [
        { kind: 'supported', competency: 'TypeScript 全栈开发', priority: 'required', jdSources: [jd('React 前端与 NestJS 后端')], resumeSources: [resume('React 与 NestJS 接口')], rationale: '简历说明了同类技术栈的实际职责。' },
        { kind: 'gap', competency: '大模型应用落地', priority: 'preferred', jdSources: [jd('使用大模型 API 构建 AI 应用')], explanation: '简历中没有可核对的模型应用经历。' },
      ],
      strengths: ['全栈技术栈与 JD 一致'], gaps: ['缺少大模型应用证据'], uncertainties: ['未说明团队规模'], aiApplication: { value: 'yes', jdSources: [jd('AI 应用')] }, modelAttribution: attribution,
    },
    greeting: { text: '您好，我在简历中写明了 React 与 NestJS 接口和 PostgreSQL 数据建模的经历，希望和您进一步沟通这个岗位。', factualClaims: [{ claim: '负责 React 与 NestJS 接口', resumeSources: [resume('React 与 NestJS 接口')], jdSources: [jd('React 前端与 NestJS 后端')] }], uncertainties: [], modelAttribution: attribution },
  });

  it('accepts only verbatim JD and resume citations', () => {
    expect(() => validateMatchReceipt(sources, receipt())).not.toThrow();
    const fabricatedJd = receipt();
    fabricatedJd.match.assessments[0] = { ...fabricatedJd.match.assessments[0]!, jdSources: [{ ...jd('React 前端与 NestJS 后端'), quote: '岗位要求不存在的原文' }] } as never;
    expect(() => validateMatchReceipt(sources, fabricatedJd)).toThrow('PROVENANCE_JD_QUOTE');
    const foreignResume = receipt();
    foreignResume.greeting.factualClaims[0] = { ...foreignResume.greeting.factualClaims[0]!, resumeSources: [{ ...resume('React 与 NestJS 接口'), resumeVersionId: '55555555-5555-4555-8555-555555555555' }] };
    expect(() => validateMatchReceipt(sources, foreignResume)).toThrow('PROVENANCE_RESUME_VERSION');
  });

  it('rejects greetings that leak contact details or promise availability or salary', () => {
    const contact = receipt();
    contact.greeting.text = '您好，我的电话 13800138000，随时到岗，期望薪资 30K。';
    expect(() => validateMatchReceipt(sources, contact)).toThrow(/PROVENANCE_CONTACT|PROVENANCE_COMMITMENT/);
  });
});

describe('personalized preparation provenance', () => {
  const jdText = '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用。';
  const resumeText = '在全栈项目中负责 React 与 NestJS 接口、PostgreSQL 数据建模，并为关键功能编写自动化测试。';
  const sources: CareerGenerationSources = { postingSnapshotHash: digest(jdText), jdText, resumeVersionId: '22222222-2222-4222-8222-222222222222', resumeTextHash: textSha256(resumeText), resumeText };
  const input: PersonalizedPreparationInput = {
    kind: 'resume_jd', role: '全栈工程师', roleFamily: 'fullstack', roleTarget: 'fullstack', candidateLevel: 'experienced', round: 'first', roleType: 'technical', questionCount: 10,
    resume: { versionId: sources.resumeVersionId, textHash: sources.resumeTextHash, text: resumeText },
    jd: { snapshotHash: sources.postingSnapshotHash, text: jdText },
  };
  const jd = (quote: string) => ({ kind: 'jd' as const, snapshotHash: sources.postingSnapshotHash, start: jdText.indexOf(quote), end: jdText.indexOf(quote) + quote.length, quote });
  const resume = (quote: string) => ({ kind: 'resume' as const, resumeVersionId: sources.resumeVersionId, resumeTextHash: sources.resumeTextHash, start: resumeText.indexOf(quote), end: resumeText.indexOf(quote) + quote.length, quote });
  const question = (index: number, purpose: 'jd_skill' | 'resume_project' | 'skill_gap') => ({
    id: uuidFromHash(digest({ index })), title: `问题 ${index}`, text: `第 ${index} 道问题，请说明具体方案与验证方式。`, requirementIndex: index % 2,
    category: 'technical' as const, difficulty: 'hard' as const, purpose,
    jdSources: [jd('React 前端与 NestJS 后端')],
    basis: purpose === 'skill_gap' ? { kind: 'gap' as const, missingCompetency: '大模型应用', guidanceLabel: 'preparation_not_experience' as const } : { kind: 'resume_evidence' as const, resumeSources: [resume('React 与 NestJS 接口')] },
    assessmentPoints: ['说明取舍', '给出验证方法'], referenceAnswerGuidance: ['解释边界条件', '说明如何度量效果'],
  });
  const output = () => ({ requirements: [{ competency: '全栈开发', priority: 'required' as const, quote: 'React 前端与 NestJS 后端' }, { competency: '自动化测试', priority: 'preferred' as const, quote: '编写自动化测试' }], questions: Array.from({ length: 10 }, (_, index) => question(index, index < 8 ? 'resume_project' : 'skill_gap')), uncertainties: ['简历未说明模型应用深度'] });

  it('requires exactly ten grounded questions with project or gap labeling', () => {
    expect(() => validatePersonalizedPreparation(input, sources, output())).not.toThrow();
    const nine = output();
    nine.questions = nine.questions.slice(0, 9);
    expect(() => validatePersonalizedPreparation(input, sources, nine)).toThrow();
    const projected = output();
    projected.questions[0] = { ...question(0, 'resume_project'), basis: { kind: 'gap', missingCompetency: '项目管理', guidanceLabel: 'preparation_not_experience' } } as never;
    expect(() => validatePersonalizedPreparation(input, sources, projected)).toThrow('PREPARATION_PROJECT_UNGROUNDED');
    const invented = output();
    invented.questions[0] = { ...question(0, 'resume_project'), basis: { kind: 'resume_evidence', resumeSources: [{ ...resume('React 与 NestJS 接口'), quote: '不存在的项目经历' }] } } as never;
    expect(() => validatePersonalizedPreparation(input, sources, invented)).toThrow('PROVENANCE_RESUME_QUOTE');
    const foreignVersion = output();
    foreignVersion.questions[0] = { ...question(0, 'resume_project'), basis: { kind: 'resume_evidence', resumeSources: [{ ...resume('React 与 NestJS 接口'), resumeVersionId: '66666666-6666-4666-8666-666666666666' }] } } as never;
    expect(() => validatePersonalizedPreparation(input, sources, foreignVersion)).toThrow('PROVENANCE_RESUME_VERSION');
  });
});


describe('direct-employer rule',()=>{
  it('keeps an explicit headhunter separate from outsourcing and refuses an owner direct override',()=>{
    const source=posting({company:'合成招聘公司',companyProfileText:'招聘主体：合成招聘公司 · 猎头顾问\n客户公司：某互联网公司'});
    for(const ownerReview of [undefined,{decision:'confirmed_direct' as const,note:'',source:'自研产品'}]){
      const result=evaluatePosting({policy,posting:source,ownerReview});
      expect(result.disposition).toBe('excluded');expect(result.reasons.some(r=>r.code==='employment_intermediary')).toBe(true);
      expect(result.reasons.some(r=>r.code==='employment_outsourcing')).toBe(false);
    }
  });
});


describe('custom candidate role directions',()=>{
  const custom=(keywords:string[])=>({...policy,roleTargets:[],customRoleKeywords:keywords});
  it('accepts custom-only directions and preserves old policies without the new field',()=>{
    expect(careerPolicySchema.parse(custom(['  Python  '])).customRoleKeywords).toEqual(['Python']);
    expect(careerPolicySchema.parse(policy).customRoleKeywords).toBeUndefined();
    expect(careerPolicySchema.safeParse(custom([])).success).toBe(false);
    for(const keywords of [[' '],['Python','python'],['x'.repeat(41)],Array.from({length:7},(_,i)=>String(i))])expect(careerPolicySchema.safeParse(custom(keywords)).success).toBe(false);
  });
  it('matches literal custom keywords with original title/JD evidence and OR semantics',()=>{
    const decision=evaluatePosting({policy:custom(['Java','C++']),posting:posting({title:'C++工程师',jdText:'负责企业系统开发。'})});
    expect(decision.disposition).toBe('eligible');expect(decision.reasons.find(r=>r.code==='role_matched')?.evidence).toEqual([{field:'title',start:0,end:3,quote:'C++'}]);
    expect(evaluatePosting({policy:custom(['.*']),posting:posting()}).reasons.some(r=>r.code==='role_matched')).toBe(false);
    const jd=evaluatePosting({policy:custom(['python']),posting:posting({title:'后端工程师',jdText:'使用 PYTHON 实现接口。'})});
    expect(jd.reasons.find(r=>r.code==='role_matched')?.evidence[0]?.quote).toBe('PYTHON');
  });
  it('supports non-development directions without removing salary and employment checks',()=>{
    const observed=posting({title:'产品运营',jdText:'负责产品运营。'});
    expect(evaluatePosting({policy:custom(['运营']),posting:observed}).disposition).toBe('eligible');
    expect(evaluatePosting({policy:custom(['运营']),posting:{...observed,salaryRaw:'10-15K'}}).disposition).toBe('excluded');
    expect(evaluatePosting({policy:custom(['运营']),posting:{...observed,companyProfileText:'雇佣关系待核实'}}).disposition).toBe('needs_review');
  });
});
