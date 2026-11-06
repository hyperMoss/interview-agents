import { careerDecisionSchema, careerPolicySchema, careerEvidenceSchema, type CareerDecision, type CareerEvidence, type CareerPolicy, type ObservedPosting, type SalaryRange } from '../../contracts/src/career';

// Hard-filter evaluation for candidate-side BOSS postings. Native site filters narrow the
// result set; these decisions re-check the observed posting text so a native control is never
// treated as proof that a posting satisfies the constraint.

const NON_DEVELOPMENT = /销售|客服|运营|招聘|人事|主播|BD|商务拓展|市场|猎头|顾问|实习生招聘/;
const DEVELOPMENT = /开发|研发|工程师|架构|技术专家|程序设计|engineer|developer|architect/i;
const FULLSTACK = /全栈|full[\s-]?stack|前后端|前端.*后端|后端.*前端/i;
const AGENT = /智能体|agent|大模型|llm|ai\s*应用|ai应用/i;
const DIRECT_EMPLOYMENT = /直招|公司直招|自有团队|自研|正式员工|签约本公司/i;
const INTERMEDIARY = /猎头顾问|招聘中介|客户公司[:：]/i;
const OUTSOURCING = /外包|外派|驻场|劳务派遣|人才派遣|人力派遣|驻点服务|staffing|vendor|outsourc/i;
const CITY_MARKERS: Array<{ city: string; pattern: RegExp }> = [
  { city: '广州', pattern: /广州/ },
  { city: '深圳', pattern: /深圳/ },
  { city: '其他', pattern: /北京|上海|杭州|成都|武汉|南京|西安|苏州|重庆|长沙|厦门|合肥|郑州|天津/ },
];
const AMBIGUOUS_LOCATION = /远程|全国|不限|多地|珠三角|粤港澳|华南|线上/;

function fold(text: string) {
  const normalized = text.normalize('NFKC');
  return (normalized.length === text.length ? normalized : text).toLowerCase();
}

function textSliceEq(text: string, start: number, end: number, quote: string) {
  return start < end && end <= text.length && text.slice(start, end) === quote;
}

export function evidenceOf(field: CareerEvidence['field'], text: string, start: number, end: number): CareerEvidence {
  return careerEvidenceSchema.parse({ field, start, end, quote: text.slice(start, end) });
}

export function findEvidence(field: CareerEvidence['field'], text: string, pattern: RegExp): CareerEvidence | null {
  const match = fold(text).match(pattern);
  if (!match || match.index === undefined) return null;
  const end = match.index + match[0].length;
  if (end > text.length || fold(text.slice(match.index, end)) !== match[0]) return null;
  return evidenceOf(field, text, match.index, end);
}

/** Parses a visible BOSS salary string. 13薪 is metadata and never lifts a low monthly range. */
export function parseSalary(raw: string): SalaryRange {
  const text = raw.normalize('NFKC').trim();
  const base = { raw: raw.trim(), currency: 'CNY' as const, monthlyLowerCny: null, monthlyUpperCny: null, monthsPerYear: null };
  if (!text) return { ...base, status: 'unknown' };
  if (/面议|待定|薪资面议/.test(text)) return { ...base, status: 'negotiable' };
  const monthsMatch = text.match(/(\d{2})\s*薪/);
  const months = monthsMatch?.[1] ? Number(monthsMatch[1]) : null;
  if (/[/每]\s*天|元\s*\/\s*天|\/\s*day|日薪/.test(text)) return { ...base, status: 'non_monthly' };
  if (/万\s*\/\s*年|\/\s*year|年薪|年包/.test(text)) return { ...base, status: 'non_monthly' };
  const kRange = text.match(/(\d+(?:\.\d+)?)\s*[-~—–至]\s*(\d+(?:\.\d+)?)\s*[kK千]/);
  if (kRange?.[1] && kRange[2]) {
    const lower = Math.round(Number(kRange[1]) * 1000);
    const upper = Math.round(Number(kRange[2]) * 1000);
    if (lower > upper) return { ...base, status: 'unknown' };
    return { ...base, status: 'monthly', monthlyLowerCny: lower, monthlyUpperCny: upper, monthsPerYear: months };
  }
  const yuanRange = text.match(/(\d{4,6})\s*[-~—–至]\s*(\d{4,6})\s*(?:元)?\s*(?:\/\s*月|每月|月薪)?/);
  if (yuanRange?.[1] && yuanRange[2]) {
    const lower = Number(yuanRange[1]);
    const upper = Number(yuanRange[2]);
    if (lower > upper) return { ...base, status: 'unknown' };
    return { ...base, status: 'monthly', monthlyLowerCny: lower, monthlyUpperCny: upper, monthsPerYear: months };
  }
  const kOpen = text.match(/(\d+(?:\.\d+)?)\s*[kK千]\s*(?:以上|\+)/);
  if (kOpen?.[1]) return { ...base, status: 'unknown', monthlyLowerCny: Math.round(Number(kOpen[1]) * 1000), monthsPerYear: months };
  const kSingle = text.match(/^(\d+(?:\.\d+)?)\s*[kK千]$/);
  if (kSingle?.[1]) {
    const value = Math.round(Number(kSingle[1]) * 1000);
    return { ...base, status: 'monthly', monthlyLowerCny: value, monthlyUpperCny: value, monthsPerYear: months };
  }
  return { ...base, status: 'unknown' };
}

export function matchBlacklist(text: string, field: CareerEvidence['field'], keywords: string[], limit = 8) {
  const haystack = fold(text);
  const matches: CareerDecision['blacklistMatches'] = [];
  for (const keyword of keywords) {
    const needle = fold(keyword.trim());
    if (!needle) continue;
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      const end = index + needle.length;
      if (textSliceEq(text, index, end, text.slice(index, end))) {
        matches.push({ keyword: keyword.trim(), field, start: index, end, quote: text.slice(index, end) });
        break;
      }
      index = haystack.indexOf(needle, index + 1);
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

function roleReasons(policy: CareerPolicy, posting: ObservedPosting): CareerDecision['reasons'] {
  const reasons: CareerDecision['reasons'] = [];
  const title = posting.title;
  const jd = posting.jdText;
  for (const keyword of policy.customRoleKeywords ?? []) {
    for (const [field, text] of [['title', title], ['jd', jd]] as const) {
      const index = fold(text).indexOf(fold(keyword));
      if (index >= 0) return [{ code: 'role_matched', evidence: [evidenceOf(field, text, index, index + keyword.length)] }];
    }
  }
  const nonDev = findEvidence('title', title, NON_DEVELOPMENT) ?? findEvidence('jd', jd, NON_DEVELOPMENT);
  if (nonDev && !findEvidence('title', title, DEVELOPMENT)) {
    reasons.push({ code: 'role_mismatch', evidence: [nonDev] });
    return reasons;
  }
  const development = findEvidence('title', title, DEVELOPMENT) ?? findEvidence('jd', jd, DEVELOPMENT);
  const wantsFullstack = policy.roleTargets.includes('fullstack');
  const wantsAgent = policy.roleTargets.includes('agent_development');
  const fullstack = wantsFullstack ? findEvidence('title', title, FULLSTACK) ?? findEvidence('jd', jd, FULLSTACK) : null;
  const agent = wantsAgent ? findEvidence('title', title, AGENT) ?? findEvidence('jd', jd, AGENT) : null;
  if (fullstack || (agent && development)) {
    reasons.push({ code: 'role_matched', evidence: [fullstack ?? agent].filter((item): item is CareerEvidence => item !== null) });
    return reasons;
  }
  if (agent && !development) {
    reasons.push({ code: 'role_ambiguous', evidence: [agent] });
    return reasons;
  }
  if (development) reasons.push({ code: 'role_mismatch', evidence: [development] });
  else reasons.push({ code: 'role_ambiguous', evidence: posting.title ? [evidenceOf('title', title, 0, Math.min(title.length, 60))] : [] });
  return reasons;
}

function cityReasons(policy: CareerPolicy, posting: ObservedPosting) {
  const reasons: CareerDecision['reasons'] = [];
  const location = posting.location;
  const matched = CITY_MARKERS.filter(marker => marker.city !== '其他' && policy.cities.includes(marker.city as '广州' | '深圳')).map(marker => ({ city: marker.city, evidence: findEvidence('location', location, marker.pattern) })).find(item => item.evidence);
  if (matched?.evidence) {
    reasons.push({ code: 'city_matched', evidence: [matched.evidence] });
    return reasons;
  }
  const other = findEvidence('location', location, CITY_MARKERS[2]?.pattern ?? /$^/);
  if (other) {
    reasons.push({ code: 'city_mismatch', evidence: [other] });
    return reasons;
  }
  const ambiguous = findEvidence('location', location, AMBIGUOUS_LOCATION);
  reasons.push({ code: 'location_ambiguous', evidence: ambiguous ? [ambiguous] : location ? [evidenceOf('location', location, 0, Math.min(location.length, 60))] : [] });
  return reasons;
}

function salaryReasons(policy: CareerPolicy, posting: ObservedPosting, salary: SalaryRange) {
  const reasons: CareerDecision['reasons'] = [];
  const items = posting.salaryRaw ? [evidenceOf('salary', posting.salaryRaw, 0, posting.salaryRaw.length)] : [];
  if (salary.status === 'monthly' && salary.monthlyUpperCny !== null) {
    reasons.push({ code: salary.monthlyUpperCny >= policy.salaryUpperMinCnyMonthly ? 'salary_qualified' : 'salary_below_minimum', evidence: items });
    return reasons;
  }
  reasons.push({ code: 'salary_needs_review', evidence: items });
  return reasons;
}

function employmentReasons(posting: ObservedPosting): CareerDecision['reasons'] {
  const reasons: CareerDecision['reasons'] = [];
  const outsourcing = findEvidence('employment', posting.jdText, OUTSOURCING) ?? findEvidence('company', posting.company, OUTSOURCING) ?? findEvidence('employment', posting.companyProfileText, OUTSOURCING);
  if (outsourcing) {
    reasons.push({ code: 'employment_outsourcing', evidence: [outsourcing] });
    return reasons;
  }
  const intermediary = findEvidence('employment', posting.companyProfileText, INTERMEDIARY);
  if (intermediary) return [{ code: 'employment_intermediary', evidence: [intermediary] }];
  const direct = findEvidence('employment', posting.jdText, DIRECT_EMPLOYMENT) ?? findEvidence('employment', posting.companyProfileText, DIRECT_EMPLOYMENT);
  if (direct) {
    reasons.push({ code: 'employment_direct', evidence: [direct] });
    return reasons;
  }
  reasons.push({ code: 'employment_unknown', evidence: [] });
  return reasons;
}

export type PostingEvaluationInput = {
  policy: CareerPolicy;
  posting: ObservedPosting;
  ownerReview?: { decision: 'confirmed_direct' | 'excluded' | 'unresolved'; note: string; source: string } | null;
  duplicate?: 'duplicate_posting' | 'already_contacted' | null;
};

/** Single hard-filter evaluation shared by the worker and the API so eligibility is spelled once. */
export function evaluatePosting({ policy, posting, ownerReview, duplicate }: PostingEvaluationInput): CareerDecision {
  const salary = parseSalary(posting.salaryRaw);
  const blacklistMatches = [...matchBlacklist(posting.company, 'company', policy.companyBlacklistKeywords), ...matchBlacklist(posting.companyProfileText, 'employment', policy.companyBlacklistKeywords)].slice(0, 8);
  const reasons: CareerDecision['reasons'] = [
    ...(blacklistMatches.length ? [{ code: 'company_blacklisted' as const, evidence: blacklistMatches.slice(0, 4).map(match => evidenceOf(match.field, match.field === 'company' ? posting.company : posting.companyProfileText, match.start, match.end)) }] : []),
    ...roleReasons(policy, posting),
    ...cityReasons(policy, posting),
    ...salaryReasons(policy, posting, salary),
    ...(duplicate ? [{ code: duplicate, evidence: [] }] : []),
  ];
  if (posting.identitySource !== 'detail_link') {
    reasons.push({ code: posting.identitySource === 'conflict' ? 'identity_conflict' : 'identity_missing', evidence: [] });
  }
  if (ownerReview?.decision === 'excluded') reasons.push({ code: 'owner_review_excluded', evidence: [] });
  if (ownerReview?.decision === 'confirmed_direct') reasons.push({ code: 'owner_review_direct', evidence: [] });

  const employment = employmentReasons(posting);
  // Owner review may only resolve an unknown employment relationship into direct employment. It
  // never overrides an explicit outsourcing finding: explicit exclusions stay hard exclusions.
  if (ownerReview?.decision === 'confirmed_direct' && !employment.some(reason => ['employment_outsourcing','employment_intermediary'].includes(reason.code))) {
    reasons.push({ code: 'employment_direct', evidence: employment.flatMap(item => item.evidence) });
  } else {
    reasons.push(...employment);
  }

  const excluded = reasons.some(reason => ['role_mismatch', 'city_mismatch', 'salary_below_minimum', 'company_blacklisted', 'employment_outsourcing', 'employment_intermediary', 'duplicate_posting', 'already_contacted', 'identity_conflict', 'owner_review_excluded'].includes(reason.code));
  const review = reasons.some(reason => ['role_ambiguous', 'location_ambiguous', 'salary_needs_review', 'employment_unknown', 'identity_missing'].includes(reason.code));
  const disposition = excluded ? 'excluded' : review ? 'needs_review' : 'eligible';
  return careerDecisionSchema.parse({ disposition, reasons, salary, blacklistMatches });
}

export function parsePolicy(raw: unknown): CareerPolicy {
  return careerPolicySchema.parse(raw);
}

export type MatchOrderingInput = {
  decision: CareerDecision;
  match: { assessments: Array<{ kind: 'supported' | 'gap' | 'uncertain'; priority: 'required' | 'preferred' }>; aiApplication: { value: 'yes' | 'no' | 'unknown' } } | null;
  sitePostingId: string;
};

/** Grounded ordering: required coverage, then unresolved required gaps, then preferred coverage, AI tie-break, stable id. */
export function matchOrderingKey({ decision, match, sitePostingId }: MatchOrderingInput, preferAiApplication: boolean) {
  if (!match || !match.assessments.length) return { hasMatch: 0, requiredCoverage: 0, requiredGaps: Number.MAX_SAFE_INTEGER, preferredCoverage: 0, ai: 0, sitePostingId };
  const required = match.assessments.filter(assessment => assessment.priority === 'required');
  const preferred = match.assessments.filter(assessment => assessment.priority === 'preferred');
  const supported = (list: typeof required) => list.filter(assessment => assessment.kind === 'supported').length;
  return {
    hasMatch: 1,
    requiredCoverage: required.length ? supported(required) / required.length : 0,
    requiredGaps: required.filter(assessment => assessment.kind !== 'supported').length,
    preferredCoverage: preferred.length ? supported(preferred) / preferred.length : 0,
    ai: preferAiApplication ? (match.aiApplication.value === 'yes' ? 2 : match.aiApplication.value === 'unknown' ? 1 : 0) : 0,
    sitePostingId,
  };
}

export function orderShortlist<T extends MatchOrderingInput & { decision: CareerDecision }>(rows: T[], preferAiApplication: boolean): T[] {
  return rows
    .filter(row => row.decision.disposition === 'eligible')
    .sort((left, right) => {
      const a = matchOrderingKey(left, preferAiApplication);
      const b = matchOrderingKey(right, preferAiApplication);
      return b.hasMatch - a.hasMatch
        || b.requiredCoverage - a.requiredCoverage
        || a.requiredGaps - b.requiredGaps
        || b.preferredCoverage - a.preferredCoverage
        || b.ai - a.ai
        || a.sitePostingId.localeCompare(b.sitePostingId);
    });
}
