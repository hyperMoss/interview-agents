import { z } from 'zod';

export const bossConversationSchema = z.strictObject({
  accountKey: z.string().min(1).max(200),
  conversationKey: z.string().min(1).max(200),
  postingId: z.string().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  jdText: z.string().min(20).max(12000).nullable(),
  exchangeEvidence: z.string().min(1).max(1000),
  sourceUrl: z.url(), observedAt: z.iso.datetime(),
  postingUrl:z.url().nullable(),
  scope: z.literal('visible_window'),
  messages: z.array(z.strictObject({
    sourceId: z.string().max(200).nullable(),
    direction: z.enum(['self', 'recruiter', 'system', 'unknown']),
    text: z.string().min(1).max(8000), timeLabel: z.string().max(200).nullable(),
  })).min(1).max(200),
});
export type BossConversation = z.infer<typeof bossConversationSchema>;
export const bossConversationViewSchema = z.strictObject({
  id: z.uuid(), revision: z.number().int().positive(), snapshotHash: z.string(),
  manualJd: z.string().min(20).max(12000).nullable(),
  snapshot: bossConversationSchema,
});
export type BossConversationView = z.infer<typeof bossConversationViewSchema>;
export const bossConversationSummarySchema=z.object({id:z.uuid(),revision:z.number().int(),company:z.string(),title:z.string(),observedAt:z.iso.datetime()});
export const bossInboxSyncModeSchema=z.enum(['current','first_ten']);
export const bossInboxProgressSchema=z.strictObject({total:z.number().int().min(0).max(10),completed:z.number().int().min(0).max(10)}).refine(value=>value.completed<=value.total);
export const bossInboxSyncSchema = z.strictObject({ requestId: z.uuid(), mode:bossInboxSyncModeSchema.default('current') });
export const bossInboxJobSchema = z.object({ id: z.uuid(), status: z.enum(['queued','processing','completed','failed','cancelled']), failure: z.string().nullable(),progress:bossInboxProgressSchema.nullable().default(null) });
export const bossInboxSnapshotSchema = z.strictObject({ hash: z.string(), observedAt: z.iso.datetime(),messageCount:z.number().int() });
