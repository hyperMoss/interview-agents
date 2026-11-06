import { z } from 'zod';
import { difficultySchema, roleFamilySchema } from './bank';

// Shared candidate-side BOSS career contracts. JD, resume, company and page text are
// untrusted data; these schemas describe observations and decisions, never instructions.
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const bossAutomationModeSchema=z.enum(['enabled','contact','search','manual','paused']);
export type BossAutomationMode=z.infer<typeof bossAutomationModeSchema>;
export const careerSiteSchema = z.literal('boss');
export const careerRoleTargetSchema = z.enum(['fullstack', 'agent_development']);
export const careerCitySchema = z.enum(['广州', '深圳']);

export const careerPolicySchema = z.strictObject({
  roleTargets: z.array(careerRoleTargetSchema).max(2),
  customRoleKeywords: z.array(z.string().trim().min(1).max(40).refine(value => !/[\u0000-\u001f\u007f]/.test(value), '方向不能包含控制字符')).max(6).refine(values => new Set(values.map(value => value.normalize('NFKC').toLowerCase())).size === values.length, '自定义方向不能重复').optional(),
  cities: z.array(careerCitySchema).min(1).max(2),
  salaryUpperMinCnyMonthly: z.number().int().min(1000).max(100000),
  preferAiApplication: z.boolean(),
  companyBlacklistKeywords: z.array(z.string().trim().min(1).max(40)).max(50),
}).refine(policy => policy.roleTargets.length + (policy.customRoleKeywords?.length ?? 0) > 0, { message: '至少选择或添加一个岗位方向', path: ['roleTargets'] });
export type CareerPolicy = z.infer<typeof careerPolicySchema>;
// Server-enforced bounds of one manually started local task.
export const CAREER_MAX_POSTINGS = 30;
export const CAREER_MAX_BATCH_ITEMS = 10;
export const CAREER_PREPARATION_QUESTIONS = 10;

export const careerSourceFieldSchema = z.enum(['title', 'company', 'location', 'salary', 'jd', 'employment', 'link']);
export const careerEvidenceSchema = z.strictObject({
  field: careerSourceFieldSchema, start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1).max(400),
});
export type CareerEvidence = z.infer<typeof careerEvidenceSchema>;

export const salaryRangeSchema = z.strictObject({
  raw: z.string().min(1).max(120),
  status: z.enum(['monthly', 'negotiable', 'non_monthly', 'unknown']),
  currency: z.literal('CNY'),
  monthlyLowerCny: z.number().int().nonnegative().nullable(),
  monthlyUpperCny: z.number().int().nonnegative().nullable(),
  monthsPerYear: z.number().int().min(12).max(24).nullable(),
});
export type SalaryRange = z.infer<typeof salaryRangeSchema>;

export const careerDispositionSchema = z.enum(['eligible', 'excluded', 'needs_review']);
export const careerReasonCodeSchema = z.enum([
  'role_matched', 'role_mismatch', 'role_ambiguous',
  'city_matched', 'city_mismatch', 'location_ambiguous',
  'salary_qualified', 'salary_below_minimum', 'salary_needs_review',
  'company_blacklisted', 'employment_direct', 'employment_outsourcing', 'employment_intermediary', 'employment_unknown',
  'identity_missing', 'identity_conflict', 'duplicate_posting', 'already_contacted',
  'owner_review_direct', 'owner_review_excluded',
]);
export const careerReasonSchema = z.strictObject({ code: careerReasonCodeSchema, evidence: z.array(careerEvidenceSchema).max(4) });
export const careerDecisionSchema = z.strictObject({
  disposition: careerDispositionSchema, reasons: z.array(careerReasonSchema).min(1).max(8), salary: salaryRangeSchema,
  blacklistMatches: z.array(z.strictObject({ keyword: z.string().min(1).max(40), field: careerSourceFieldSchema, start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1).max(400) })).max(8),
});
export type CareerDecision = z.infer<typeof careerDecisionSchema>;

// Observed posting snapshot. Offsets in source references and evidence point into these LF-normalized strings.
export const observedPostingSchema = z.strictObject({
  site: careerSiteSchema,
  sitePostingId: z.string().min(1).max(120),
  url: z.url().max(500),
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  location: z.string().max(120),
  salaryRaw: z.string().min(1).max(120),
  jdText: z.string().max(20000),
  companyProfileText: z.string().max(4000),
  identitySource: z.enum(['detail_link', 'missing', 'conflict']),
  nativeFilterEvidence: z.strictObject({ method: z.enum(['native_controls', 'search_url']).optional(), searchKey: z.string().min(1).max(120), controls: z.array(z.strictObject({ label: z.string().min(1).max(40), selected: z.string().min(1).max(80), url: z.string().max(500) })).min(1).max(8) }),
});
export type ObservedPosting = z.infer<typeof observedPostingSchema>;

export const jdSourceRefSchema = z.strictObject({ kind: z.literal('jd'), snapshotHash: sha256Schema, start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(2).max(600) });
export const resumeSourceRefSchema = z.strictObject({ kind: z.literal('resume'), resumeVersionId: z.uuid(), resumeTextHash: sha256Schema, start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(2).max(600) });
export const careerSourceRefSchema = z.discriminatedUnion('kind', [jdSourceRefSchema, resumeSourceRefSchema]);
export type CareerSourceRef = z.infer<typeof careerSourceRefSchema>;

export const careerModelAttributionSchema = z.strictObject({ kind: z.literal('connection'), connectionId: z.uuid(), model: z.string().min(1).max(200) });
export type CareerModelAttribution = z.infer<typeof careerModelAttributionSchema>;
export const careerDeliveryAttributionSchema = z.discriminatedUnion('kind', [
  careerModelAttributionSchema,
  z.strictObject({ kind: z.literal('manual'), connectionId: z.null(), model: z.literal('手动确认') }),
]);
export const careerManualModelSourceSchema = z.strictObject({ connectionId: z.null(), label: z.literal('手动确认') });
export const careerBindResumeSchema = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), resumeVersionId: z.uuid() });

const jdSourceSchema = jdSourceRefSchema;
const resumeSourceSchema = resumeSourceRefSchema;
export const careerRequirementSchema = z.strictObject({ competency: z.string().trim().min(2).max(80), priority: z.enum(['required', 'preferred']) });
export const careerAssessmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('supported'), competency: z.string().trim().min(2).max(80), priority: z.enum(['required', 'preferred']), jdSources: z.array(jdSourceSchema).min(1).max(3), resumeSources: z.array(resumeSourceSchema).min(1).max(3), rationale: z.string().min(4).max(600) }),
  z.strictObject({ kind: z.enum(['gap', 'uncertain']), competency: z.string().trim().min(2).max(80), priority: z.enum(['required', 'preferred']), jdSources: z.array(jdSourceSchema).min(1).max(3), explanation: z.string().min(4).max(600) }),
]);
export const careerMatchSchema = z.strictObject({
  assessments: z.array(careerAssessmentSchema).min(1).max(12),
  strengths: z.array(z.string().min(2).max(300)).max(6),
  gaps: z.array(z.string().min(2).max(300)).max(6),
  uncertainties: z.array(z.string().min(2).max(300)).max(6),
  aiApplication: z.strictObject({ value: z.enum(['yes', 'no', 'unknown']), jdSources: z.array(jdSourceSchema).max(3) }),
  modelAttribution: careerModelAttributionSchema,
});
export type CareerMatch = z.infer<typeof careerMatchSchema>;

export const careerGreetingSchema = z.strictObject({
  text: z.string().trim().min(10).max(1200),
  factualClaims: z.array(z.strictObject({ claim: z.string().min(2).max(300), resumeSources: z.array(resumeSourceSchema).min(1).max(3), jdSources: z.array(jdSourceSchema).max(3) })).max(6),
  uncertainties: z.array(z.string().min(2).max(300)).max(6),
  modelAttribution: careerDeliveryAttributionSchema,
});
export type CareerGreeting = z.infer<typeof careerGreetingSchema>;

export const careerMatchReceiptSchema = z.strictObject({ match: careerMatchSchema, greeting: careerGreetingSchema });
export type CareerMatchReceipt = z.infer<typeof careerMatchReceiptSchema>;

/** Immutable sources resolved by the business service and sent to the Agent as data only. */
export const careerGenerationSourcesSchema = z.strictObject({
  postingSnapshotHash: sha256Schema,
  jdText: z.string().min(20).max(20000),
  resumeVersionId: z.uuid(),
  resumeTextHash: sha256Schema,
  resumeText: z.string().min(20).max(64000),
});
export type CareerGenerationSources = z.infer<typeof careerGenerationSourcesSchema>;
export const careerMatchRuntimeSchema = z.strictObject({
  ownerId: z.uuid(), workId: z.uuid(), generation: z.number().int().nonnegative(),
  modelConnectionId: z.uuid(), policy: careerPolicySchema, sources: careerGenerationSourcesSchema,
});
export const careerGenerationRuntimeSchema = z.strictObject({
  ownerId: z.uuid(), workId: z.uuid(), generation: z.number().int().nonnegative(), modelConnectionId: z.uuid(),
});

export const careerTaskPhaseSchema = z.enum(['queued', 'searching', 'matching', 'review']);
export const careerPauseReasonSchema = z.enum(['login_required', 'verification_required', 'site_restricted', 'page_failures', 'browser_unavailable', 'native_filter_unverified', 'model_unavailable']);
export const careerTaskStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('active'), phase: careerTaskPhaseSchema }),
  z.strictObject({ status: z.literal('failed'), phase: careerTaskPhaseSchema, error: z.string().min(1).max(400) }),
  z.strictObject({ status: z.literal('paused'), phase: careerTaskPhaseSchema, reason: careerPauseReasonSchema, detail: z.string().min(1).max(400) }),
  z.strictObject({ status: z.literal('cancelled'), phase: careerTaskPhaseSchema }),
]);
export type CareerTaskState = z.infer<typeof careerTaskStateSchema>;

const personalizedTaskCreateSchema = z.strictObject({
  requestId: z.uuid(), resumeVersionId: z.uuid(), modelConnectionId: z.uuid(), policy: careerPolicySchema,
  dataProcessingAcknowledged: z.literal(true),
});
export const careerTaskCreateSchema = z.union([
  z.strictObject({ mode: z.literal('preview'), requestId: z.uuid(), policy: careerPolicySchema }),
  personalizedTaskCreateSchema,
]);
const careerTaskViewBaseSchema = z.strictObject({
  id: z.uuid(), revision: z.number().int().nonnegative(), state: careerTaskStateSchema, policy: careerPolicySchema,
  mode: z.literal('personalized'),
  resumeVersionId: z.uuid(), resumeTextSha256: sha256Schema, attachmentSha256: sha256Schema,
  model: z.strictObject({ connectionId: z.uuid(), label: z.string().min(1).max(200) }),
  readCount: z.number().int().nonnegative(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  shortlistCount: z.number().int().nonnegative(), excludedCount: z.number().int().nonnegative(), reviewCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  batches: z.array(z.strictObject({ id: z.uuid(), state: z.enum(['approved', 'delivering', 'paused', 'completed', 'completed_with_review', 'cancelled']), approvedAt: z.iso.datetime() })),
});
export const careerTaskViewSchema = z.discriminatedUnion('mode', [
  careerTaskViewBaseSchema,
  careerTaskViewBaseSchema.extend({ mode: z.literal('manual'), model: careerManualModelSourceSchema }),
  careerTaskViewBaseSchema.extend({ mode: z.literal('preview'), resumeVersionId: z.null(), resumeTextSha256: z.null(), attachmentSha256: z.null(), model: z.null() }),
]);
export type CareerTaskView = z.infer<typeof careerTaskViewSchema>;

export const careerTaskPostingViewSchema = z.strictObject({
  id: z.uuid(), postingId: z.uuid(), revision: z.number().int().nonnegative(), snapshotHash: sha256Schema,
  observed: observedPostingSchema, decision: careerDecisionSchema, match: careerMatchSchema.nullable(),
  greeting: careerGreetingSchema.nullable(), greetingRevision: z.number().int().nonnegative(),
  ownerReview: z.strictObject({ decision: z.enum(['confirmed_direct', 'excluded', 'unresolved']), note: z.string().max(600), source: z.string().max(200) }).nullable(),
  preparation: z.strictObject({ id: z.uuid(), status: z.enum(['queued', 'generating', 'ready', 'failed', 'cancelled']), revision: z.number().int().nonnegative() }).nullable(),
});
export type CareerTaskPostingView = z.infer<typeof careerTaskPostingViewSchema>;

export const careerPostingPatchSchema = z.strictObject({
  requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  greetingText: z.string().trim().min(10).max(1200).optional(),
  ownerReview: z.strictObject({ decision: z.enum(['confirmed_direct', 'excluded', 'unresolved']), note: z.string().trim().max(600), source: z.string().trim().max(200) }).optional(),
}).refine(value => value.greetingText !== undefined || value.ownerReview !== undefined, '至少提交招呼语或复核结果。');

export const careerApprovalItemSchema = z.strictObject({ taskPostingId: z.uuid(), postingSnapshotHash: sha256Schema, greetingDraftRevision: z.number().int().nonnegative(), finalGreeting: z.string().trim().min(10).max(1200) });
export const careerApprovalSchema = z.strictObject({
  requestId: z.uuid(), expectedTaskRevision: z.number().int().nonnegative(), resumeVersionId: z.uuid(),
  items: z.array(careerApprovalItemSchema).min(1).max(CAREER_MAX_BATCH_ITEMS).refine(items => new Set(items.map(item => item.taskPostingId)).size === items.length, '同一岗位不能重复批准。'),
});

export const careerConversationStateSchema = z.enum(['not_started', 'dispatching', 'confirmed', 'failed', 'unknown']);
export const careerAttachmentStateSchema = z.enum(['blocked_by_conversation', 'not_started', 'awaiting_consent', 'dispatching', 'confirmed', 'failed', 'unknown']);
export const careerBatchStateSchema = z.enum(['approved', 'delivering', 'paused', 'completed', 'completed_with_review', 'cancelled']);

export const careerEffectEvidenceSchema = z.strictObject({
  observedAt: z.iso.datetime(), url: z.string().max(500), summary: z.string().min(2).max(400),
});
export const careerBatchItemViewSchema = z.strictObject({
  id: z.uuid(), taskPostingId: z.uuid(), revision: z.number().int().nonnegative(), company: z.string().min(1).max(200), title: z.string().min(1).max(200),
  location: z.string().max(120), salaryRaw: z.string().max(120), snapshotHash: sha256Schema,
  greeting: z.string().min(10).max(1200), greetingSha256: sha256Schema,
  conversation: z.strictObject({ state: careerConversationStateSchema, evidence: z.array(careerEffectEvidenceSchema).max(4), reason: z.string().max(200).nullable() }),
  attachment: z.strictObject({ state: careerAttachmentStateSchema, evidence: z.array(careerEffectEvidenceSchema).max(4), reason: z.string().max(200).nullable(), originalName: z.string().max(200), attachmentSha256: sha256Schema }),
  preparation: z.strictObject({ id: z.uuid(), status: z.enum(['queued', 'generating', 'ready', 'failed', 'cancelled']), revision: z.number().int().nonnegative() }).nullable(),
});
export type CareerBatchItemView = z.infer<typeof careerBatchItemViewSchema>;
export const careerBatchViewSchema = z.strictObject({
  id: z.uuid(), taskId: z.uuid(), digest: sha256Schema, taskRevision: z.number().int().nonnegative(), state: careerBatchStateSchema,
  approvedAt: z.iso.datetime(), resumeVersionId: z.uuid(), resumeLabel: z.string().min(1).max(200), attachmentSha256: sha256Schema,
  resumeTextSha256: sha256Schema, originalName: z.string().min(1).max(200), model: careerDeliveryAttributionSchema,
  sessionGeneration: z.number().int().nonnegative(), accountMarker: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  pauseReason: careerPauseReasonSchema.nullable(), items: z.array(careerBatchItemViewSchema).min(1).max(CAREER_MAX_BATCH_ITEMS),
});
export type CareerBatchView = z.infer<typeof careerBatchViewSchema>;

export const careerResumeCommandSchema = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative() });
export const careerCancelSchema = z.strictObject({ requestId: z.uuid() });
export const careerItemRetrySchema = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), phase: z.enum(['conversation', 'attachment']) });
export const careerItemReconcileSchema = z.strictObject({ requestId: z.uuid() });
export const careerItemResumeAttachmentSchema = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative() });
export const careerRetryGenerationSchema = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), modelConnectionId: z.uuid(), dataProcessingAcknowledged: z.literal(true) });
export const careerDeleteTaskSchema = z.strictObject({ requestId: z.uuid() });

export const bossSessionStateSchema = z.enum(['absent', 'starting', 'login_required', 'verification_required', 'ready', 'restricted', 'unavailable', 'clearing']);
/** `patchright` is the default driver; `moli` and `playwright` remain explicit legacy choices. */
export const bossEngineSchema = z.enum(['patchright', 'moli', 'playwright']);
export type BossEngine = z.infer<typeof bossEngineSchema>;
export const bossSessionViewSchema = z.strictObject({
  automationMode: bossAutomationModeSchema.optional(),
  site: careerSiteSchema, engine: bossEngineSchema, state: bossSessionStateSchema, reason: z.string().max(400).nullable(),
  accountMarker: z.string().regex(/^[0-9a-f]{16}$/).nullable(), generation: z.number().int().nonnegative(),
  humanWindow: z.enum(['none', 'open']), affectedTaskIds: z.array(z.uuid()).max(20), updatedAt: z.iso.datetime().nullable(),
  limitation: z.string().max(400).nullable(),
});
export type BossSessionView = z.infer<typeof bossSessionViewSchema>;
export const bossSessionOpenSchema = z.strictObject({ requestId: z.uuid() });
export const bossSiteResumeInspectSchema = z.strictObject({expectedName:z.string().trim().min(1).max(80)});
export const careerPostingReinspectSchema = z.strictObject({requestId:z.uuid()});
export const bossSessionCheckSchema = z.strictObject({ requestId: z.uuid() });
export const bossSessionClearSchema = z.strictObject({ requestId: z.uuid(), confirmed: z.literal(true) });

export const resumeUploadSchema = z.strictObject({ filename: z.string().min(1).max(200), text: z.string().max(64000), warnings: z.array(z.string()).max(20), stagingId: z.uuid(), byteSize: z.number().int().positive(), attachmentSha256: sha256Schema });
export const resumeVersionSaveSchema = z.strictObject({ requestId: z.uuid(), stagingId: z.uuid(), label: z.string().trim().min(1).max(80), text: z.string().trim().min(20).max(64000), warningsAcknowledged: z.boolean() });
export const resumeVersionSchema = z.strictObject({
  id: z.uuid(), label: z.string().min(1).max(80), originalName: z.string().min(1).max(200), contentType: z.string().min(1).max(120),
  byteSize: z.number().int().positive(), attachmentSha256: sha256Schema, text: z.string().max(64000), textSha256: sha256Schema,
  warnings: z.array(z.string()).max(20), createdAt: z.iso.datetime(),
});
export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export const resumeVersionListSchema = z.array(resumeVersionSchema.omit({ text: true }).extend({ textPreview: z.string().max(280) })).max(50);
export const resumeDeleteSchema = z.strictObject({ requestId: z.uuid(), confirmed: z.literal(true) });


export const careerContactApprovalSchema=z.strictObject({
 requestId:z.uuid(),expectedTaskRevision:z.number().int().nonnegative(),
 items:z.array(z.strictObject({taskPostingId:z.uuid(),snapshotHash:sha256Schema})).min(1).max(CAREER_MAX_BATCH_ITEMS).refine(items=>new Set(items.map(item=>item.taskPostingId)).size===items.length,'岗位不能重复。'),
});
export const careerContactStateSchema=z.enum(['queued','dispatching','confirmed','already_contacted','failed','unknown','cancelled']);
export const careerContactViewSchema=z.strictObject({
 id:z.uuid(),approvalId:z.uuid(),taskId:z.uuid(),taskPostingId:z.uuid(),snapshotHash:sha256Schema,
 company:z.string(),title:z.string(),url:z.url(),mode:z.literal('site_preset'),state:careerContactStateSchema,
 reason:z.string().nullable(),evidence:z.array(careerEffectEvidenceSchema),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),
});
export const careerContactApprovalViewSchema=z.strictObject({approvalId:z.uuid(),contacts:z.array(careerContactViewSchema)});
export type CareerContactView=z.infer<typeof careerContactViewSchema>;

export const careerContactRetrySchema=z.strictObject({requestId:z.uuid(),expectedUpdatedAt:z.iso.datetime()});
