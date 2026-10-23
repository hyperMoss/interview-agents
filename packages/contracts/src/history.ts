import { z } from 'zod';

export const interviewStatusSchema = z.enum([
  'preparing', 'awaiting_answer', 'evaluating', 'completed', 'failed', 'cancelled',
]);

export const interviewHistoryQuerySchema = z.strictObject({
  role: z.string().trim().max(120).optional(),
  status: interviewStatusSchema.optional(),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.preprocess(value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(50).default(20)),
});
export type InterviewHistoryQuery = z.infer<typeof interviewHistoryQuerySchema>;

export const interviewHistoryItemSchema = z.strictObject({
  id: z.uuid(),
  role: z.string(),
  status: interviewStatusSchema,
  createdAt: z.iso.datetime(),
  turnCount: z.number().int().nonnegative(),
  questionCount: z.number().int().min(1).max(30),
  modelMode: z.enum(['demo', 'live']),
  overallScore: z.number().min(0).max(100).nullable(),
});
export type InterviewHistoryItem = z.infer<typeof interviewHistoryItemSchema>;

export const interviewHistoryPageSchema = z.strictObject({
  items: z.array(interviewHistoryItemSchema).max(50),
  nextCursor: z.string().max(512).nullable(),
});
export type InterviewHistoryPage = z.infer<typeof interviewHistoryPageSchema>;
