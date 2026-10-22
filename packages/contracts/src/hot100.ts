import { z } from 'zod';

export const hot100SourceUrl = 'https://leetcode.cn/studyplan/top-100-liked/';
export const hot100MetadataSchema = z.object({
  source: z.object({ url: z.literal(hot100SourceUrl), capturedAt: z.iso.date(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  questions: z.array(z.object({
    id: z.number().int().positive(), title: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/),
    difficulty: z.enum(['easy', 'medium', 'hard']), group: z.string().min(1), tags: z.array(z.string().min(1)),
  })).length(100),
}).superRefine(({ questions }, ctx) => {
  if (new Set(questions.map(q => q.id)).size !== 100 || new Set(questions.map(q => q.slug)).size !== 100) ctx.addIssue({ code: 'custom', message: 'Hot 100 必须有一百个不同题号和 slug。' });
});
export const hot100StatusSchema = z.enum(['todo', 'doing', 'reviewed']);
export type Hot100Status = z.infer<typeof hot100StatusSchema>;
