import { z } from 'zod';
import { modelSourceSchema } from './models';
import { planningOptionsSchema,planSchema,evaluationSchema } from './planning';
import { bankQuestionSchema,difficultySchema,stageSchema,bankModeSchema } from './bank';
import { searchChoiceSchema,searchSnapshotSchema,researchSchema } from './search';

export const createInterviewSchema = z.strictObject({
  role: z.string().trim().min(2).max(120),
  level: z.enum(['junior', 'mid', 'senior']),
  resume: z.string().trim().min(20).max(16000),
  jobDescription: z.string().trim().min(20).max(12000),
  questionCount: z.number().int().min(1).max(30),
  focus: z.string().trim().max(1000).default(''),
  planning:planningOptionsSchema.optional(),
});
export type InterviewInput = z.infer<typeof createInterviewSchema>;
export const questionSchema = z.strictObject({
  text: z.string().min(5).max(16000), competency: z.string().min(2).max(100),
  kind: z.enum(['opening', 'technical', 'behavioral', 'followup','coding']),
  id:z.uuid().optional(),stage:stageSchema.optional(),difficulty:difficultySchema.optional(),bankId:z.uuid().optional(),bankMode:bankModeSchema.optional(),provenance:z.enum(['bank','adapted','generated']).optional(),
});
export const questionDirectiveSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('fixed'),question:questionSchema,expectedAnswer:z.string().max(8000)}),
  z.strictObject({kind:z.literal('generate'),question:questionSchema,anchor:bankQuestionSchema.nullable()}),
]);
export type QuestionDirective=z.infer<typeof questionDirectiveSchema>;
export const dimensionsSchema=z.strictObject({relevance:z.number().int().min(0).max(100),depth:z.number().int().min(0).max(100),clarity:z.number().int().min(0).max(100),evidence:z.number().int().min(0).max(100)});
export const assessmentSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  evidence: z.string().min(1).max(1600), feedback: z.string().min(1).max(1600),
  strengths: z.array(z.string().min(1).max(300)).max(4),
  improvements: z.array(z.string().min(1).max(300)).min(1).max(4),
  dimensions:dimensionsSchema.optional(),
  evaluation:evaluationSchema.optional(),
});
export const turnSchema = z.strictObject({ question: questionSchema, answer: z.string(), assessment: assessmentSchema,modelSource:modelSourceSchema.default({kind:'default'}),durationSeconds:z.number().nonnegative().optional(),research:searchSnapshotSchema.optional() });
export type Turn = z.infer<typeof turnSchema>;
export const reportSchema = z.strictObject({
  overallScore: z.number().min(0).max(100), summary: z.string(),
  strengths: z.array(z.string()), improvements: z.array(z.string()),
  dimensions:dimensionsSchema.optional(),
  evaluation:evaluationSchema.optional(),
});
const base = {
  id: z.uuid(), role: z.string(), createdAt: z.iso.datetime(), input: createInterviewSchema,
  turns: z.array(turnSchema), modelMode: z.enum(['demo', 'live']), revision: z.number().int().nonnegative(),
  modelSource: modelSourceSchema.default({kind:'default'}),
  plan:planSchema.optional(),startedAt:z.iso.datetime().optional(),presentedAt:z.iso.datetime().optional(),
  search:searchChoiceSchema.optional(),research:searchSnapshotSchema.optional(),
};
export const sessionSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...base, status: z.literal('preparing') }),
  z.strictObject({ ...base, status: z.literal('awaiting_answer'), question: questionSchema }),
  z.strictObject({ ...base, status: z.literal('evaluating'), question: questionSchema }),
  z.strictObject({ ...base, status: z.literal('completed'), report: reportSchema }),
  z.strictObject({ ...base, status: z.literal('failed'), error: z.string(),recovery:z.object({question:questionSchema,answer:z.string(),durationSeconds:z.number().nonnegative().optional()}).nullable().default(null) }),
  z.strictObject({ ...base, status: z.literal('cancelled') }),
]);
export type Session = z.infer<typeof sessionSchema>;
export const startInterviewSchema=z.strictObject({input:createInterviewSchema,modelConnectionId:z.uuid().nullable().default(null),search:searchChoiceSchema.default({kind:'off'})});
export const retrySchema=z.strictObject({requestId:z.uuid(),revision:z.number().int().nonnegative(),modelConnectionId:z.uuid().nullable().optional(),searchConnectionId:z.uuid().nullable().optional()});
export const answerSchema = z.strictObject({
  answer: z.string().min(10).max(12000).refine(value=>value.trim().length>=10,'回答至少包含 10 个有效字符。'), requestId: z.uuid(), revision: z.number().int().nonnegative(),
});
export const runtimeRequestSchema = z.strictObject({
  jobId: z.uuid(), input: createInterviewSchema, turns: z.array(turnSchema).max(30),
  current: z.object({ question: questionSchema, answer: z.string().min(10).max(12000),durationSeconds:z.number().nonnegative().optional() }).nullable(),
  ownerId: z.uuid().optional(), modelConnectionId:z.uuid().optional(),
  defaultModelReference:z.string().regex(/^[0-9a-f]{64}$/).optional(),
  plan:planSchema.optional(),next:questionDirectiveSchema.nullable().optional(),research:researchSchema.optional(),
});
export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;
export const runtimeResponseSchema = z.strictObject({
  modelMode: z.enum(['demo', 'live']), question: questionSchema.nullable(), assessment: assessmentSchema.nullable(),
  model:z.string().optional(),
  research:searchSnapshotSchema.optional(),
});
export type RuntimeResponse = z.infer<typeof runtimeResponseSchema>;
export const sessionListSchema = z.array(sessionSchema);
export const errorSchema = z.object({ message: z.string(), code: z.string().optional() });
