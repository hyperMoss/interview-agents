import { z } from 'zod';
import { bankCreateSchema, bankDraftSchema, bankQuestionSchema, difficultySchema, roleFamilySchema, jdRequirementSchema } from './bank';
import { planningOptionsSchema } from './planning';
import { jdSourceRefSchema, resumeSourceRefSchema, sha256Schema } from './career';

export const preparationInputSchema = z.strictObject({
  role: z.string().trim().min(2).max(120),
  jobDescription: z.string().trim().min(20).max(12000),
  candidateLevel: planningOptionsSchema.shape.candidateLevel,
  round: planningOptionsSchema.shape.round,
  roleType: planningOptionsSchema.shape.roleType,
  roleFamily: roleFamilySchema,
  questionCount: z.number().int().min(3).max(12),
  focus: z.string().trim().max(1000).default(''),
});
export type PreparationInput = z.infer<typeof preparationInputSchema>;
export const preparationRequestSchema = z.strictObject({
  input: preparationInputSchema,
  modelConnectionId: z.uuid().nullable().default(null),
});
export const preparationRuntimeSchema = preparationRequestSchema.extend({ ownerId: z.uuid() });
export const requirementSchema = jdRequirementSchema;
export const preparedQuestionSchema = z.strictObject({
  title: z.string().trim().min(2).max(160),
  text: z.string().trim().min(10).max(3000),
  requirementIndex: z.number().int().min(0).max(11),
  category: z.enum(['technical', 'behavioral']),
  difficulty: difficultySchema,
  answerOutline: z.array(z.string().trim().min(2).max(300)).min(2).max(5),
  followUps: z.array(z.string().trim().min(5).max(300)).min(1).max(3),
});
export const preparationOutputSchema = z.strictObject({
  requirements: z.array(requirementSchema).min(1).max(12),
  questions: z.array(preparedQuestionSchema).min(3).max(12),
});
export type PreparationOutput = z.infer<typeof preparationOutputSchema>;
export const preparationResultSchema = preparationOutputSchema.extend({
  modelMode: z.enum(['demo', 'live']),
  model: z.string().min(1).max(200),
});
export type PreparationResult = z.infer<typeof preparationResultSchema>;
export const preparedBankDraftSchema = bankDraftSchema.extend({ jdRequirement: jdRequirementSchema });
export const savePreparationSchema = z.strictObject({
  questions: z.array(bankCreateSchema.extend({ draft: preparedBankDraftSchema })).min(1).max(12).refine(
    questions => new Set(questions.map(question => question.requestId)).size === questions.length,
    '每道题需要不同的保存编号。',
  ),
});
export const savedPreparationSchema = z.array(bankQuestionSchema).min(1).max(12);

// Personalized resume+JD preparation used by the career flow. Legacy JD-only contracts above stay unchanged.
export const personalizedPreparationInputSchema = z.strictObject({
  kind: z.literal('resume_jd'),
  role: z.string().trim().min(2).max(120),
  roleFamily: roleFamilySchema,
  roleTarget: z.enum(['fullstack', 'agent_development']),
  candidateLevel: planningOptionsSchema.shape.candidateLevel,
  round: planningOptionsSchema.shape.round,
  roleType: planningOptionsSchema.shape.roleType,
  questionCount: z.literal(10),
  resume: z.strictObject({ versionId: z.uuid(), textHash: sha256Schema, text: z.string().min(20).max(64000) }),
  jd: z.strictObject({ snapshotHash: sha256Schema, text: z.string().min(20).max(12000) }),
});
export type PersonalizedPreparationInput = z.infer<typeof personalizedPreparationInputSchema>;
export const personalizedQuestionSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(2).max(160),
  text: z.string().trim().min(10).max(3000),
  requirementIndex: z.number().int().min(0).max(9),
  category: z.enum(['technical', 'behavioral']),
  difficulty: difficultySchema,
  purpose: z.enum(['jd_skill', 'resume_project', 'skill_gap']),
  jdSources: z.array(jdSourceRefSchema).min(1).max(3),
  basis: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('resume_evidence'), resumeSources: z.array(resumeSourceRefSchema).min(1).max(3) }),
    z.strictObject({ kind: z.literal('gap'), missingCompetency: z.string().trim().min(2).max(80), guidanceLabel: z.literal('preparation_not_experience') }),
  ]),
  assessmentPoints: z.array(z.string().trim().min(2).max(300)).min(2).max(5),
  referenceAnswerGuidance: z.array(z.string().trim().min(2).max(300)).min(2).max(5),
});
export type PersonalizedQuestion = z.infer<typeof personalizedQuestionSchema>;
export const personalizedPreparationOutputSchema = z.strictObject({
  requirements: z.array(requirementSchema).min(1).max(10),
  questions: z.array(personalizedQuestionSchema).length(10),
  uncertainties: z.array(z.string().trim().min(2).max(300)).max(6),
});
export type PersonalizedPreparationOutput = z.infer<typeof personalizedPreparationOutputSchema>;
export const personalizedPreparationSchema = personalizedPreparationOutputSchema.extend({
  kind: z.literal('resume_jd'),
  sourceHashes: z.strictObject({ resume: sha256Schema, jd: sha256Schema }),
  model: z.strictObject({ connectionId: z.uuid(), label: z.string().min(1).max(200) }),
  revision: z.number().int().nonnegative(),
});
export type PersonalizedPreparation = z.infer<typeof personalizedPreparationSchema>;
export const personalizedPreparationRuntimeSchema = z.strictObject({
  ownerId: z.uuid(), workId: z.uuid(), generation: z.number().int().nonnegative(),
  modelConnectionId: z.uuid(), input: personalizedPreparationInputSchema,
});
export const personalizedQuestionEditSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(2).max(160),
  text: z.string().trim().min(10).max(3000),
  assessmentPoints: z.array(z.string().trim().min(2).max(300)).min(2).max(5),
  referenceAnswerGuidance: z.array(z.string().trim().min(2).max(300)).min(2).max(5),
  jdSources: z.array(jdSourceRefSchema).min(1).max(3),
  basis: personalizedQuestionSchema.shape.basis,
});
export const personalizedPreparationPatchSchema = z.strictObject({
  requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  questions: z.array(personalizedQuestionEditSchema).length(10),
});
export type PersonalizedQuestionEdit = z.infer<typeof personalizedQuestionEditSchema>;
export const careerSaveToBankSchema = z.strictObject({ questions: z.array(z.strictObject({ questionId: z.uuid(), requestId: z.uuid() })).min(1).max(10) });

/** Frozen posting facts for one career preparation, so the UI can show the exact sources it was built from. */
export const careerPreparationPostingSchema = z.strictObject({
  postingId: z.uuid(), sitePostingId: z.string().min(1).max(120), company: z.string().min(1).max(200), title: z.string().min(1).max(200),
  location: z.string().max(120), salaryRaw: z.string().max(120), url: z.url().max(500), jdText: z.string().max(20000),
});
export type CareerPreparationPosting = z.infer<typeof careerPreparationPostingSchema>;
export const careerPreparationViewSchema = z.strictObject({
  id: z.uuid(), taskId: z.uuid(), taskPostingId: z.uuid(),
  status: z.enum(['queued', 'generating', 'ready', 'failed', 'cancelled']),
  revision: z.number().int().nonnegative(), failure: z.string().nullable(), generation: z.number().int().nonnegative(),
  model: personalizedPreparationSchema.shape.model, edited: z.boolean(), preparation: personalizedPreparationSchema.nullable(),
  resumeVersionId: z.uuid(), resumeTextSha256: sha256Schema, jdSnapshotHash: sha256Schema,
  resume: z.strictObject({ versionId: z.uuid(), label: z.string().min(1).max(80), text: z.string().max(64000), textSha256: sha256Schema }),
  posting: careerPreparationPostingSchema,
  roleFamily: roleFamilySchema,
});
export type CareerPreparationView = z.infer<typeof careerPreparationViewSchema>;
