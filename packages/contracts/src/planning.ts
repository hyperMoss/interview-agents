import { z } from 'zod';
import { bankModeSchema,difficultySchema,roleFamilySchema,stageSchema } from './bank';

export const planningOptionsSchema=z.strictObject({
  durationMinutes:z.number().int().min(5).max(120),answerLength:z.enum(['short','medium','long']),
  candidateLevel:z.enum(['intern','new_grad','experienced']),round:z.enum(['first','second','hr']),
  practiceMode:z.enum(['candidate','interviewer']),roleType:z.enum(['technical','nontechnical']),roleFamily:roleFamilySchema,
  codingRequested:z.boolean(),bankMode:bankModeSchema,bankIds:z.array(z.uuid()).max(100).default([]),
});
export type PlanningOptions=z.infer<typeof planningOptionsSchema>;
export const phaseCountsSchema=z.strictObject({intro:z.number().int().nonnegative(),qa:z.number().int().nonnegative(),coding:z.number().int().nonnegative(),reverse:z.number().int().nonnegative()});
export const planProgressSchema=z.strictObject({elapsedSeconds:z.number().min(0).max(7200),completed:phaseCountsSchema,qaSeconds:z.array(z.number().min(0).max(7200)).max(30)});
export type PlanProgress=z.infer<typeof planProgressSchema>;
export const planSchema=z.strictObject({
  version:z.literal(2),revision:z.number().int().nonnegative(),options:planningOptionsSchema,
  codingEnabled:z.boolean(),codingReason:z.string(),difficulty:difficultySchema,
  stages:z.array(z.strictObject({kind:stageSchema,seconds:z.number().nonnegative(),questions:z.number().int().nonnegative(),completed:z.number().int().nonnegative()})).length(4),
  totalQuestions:z.number().int().min(0).max(30),remainingQuestions:z.number().int().min(0).max(30),
  progress:planProgressSchema,availableQa:z.number().int().nonnegative().nullable(),
});
export type InterviewPlan=z.infer<typeof planSchema>;
export const previewPlanSchema=z.strictObject({options:planningOptionsSchema});
export const replanSchema=z.strictObject({requestId:z.uuid(),revision:z.number().int().nonnegative(),durationMinutes:z.number().int().min(5).max(120),answerLength:z.enum(['short','medium','long'])});
const score=z.number().int().min(0).max(100);
export const evaluationSchema=z.strictObject({technical:score.nullable(),communication:score,overallQuality:score,
  rationale:z.strictObject({technical:z.string().max(500).nullable(),communication:z.string().min(1).max(500),overallQuality:z.string().min(1).max(500)})});
export type Evaluation=z.infer<typeof evaluationSchema>;
