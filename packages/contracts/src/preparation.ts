import { z } from 'zod';
import { bankCreateSchema, bankDraftSchema, bankQuestionSchema, difficultySchema, roleFamilySchema, jdRequirementSchema } from './bank';
import { planningOptionsSchema } from './planning';

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
