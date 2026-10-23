import { z } from 'zod';
import { planningOptionsSchema } from './planning';
import { preparationInputSchema, preparationResultSchema } from './preparation';
import { bankDraftSchema } from './bank';

export const workspaceCategories = ['algorithm', 'preparation', 'interviews', 'profiles', 'reviews', 'settings'] as const;
export type WorkspaceCategory = typeof workspaceCategories[number];
export const workspaceCategoryLabels: Record<WorkspaceCategory, string> = {
  algorithm: '算法作答与跟打', preparation: 'JD 备题', interviews: '面试资料与未提交答案',
  profiles: '岗位资料档案', reviews: '面试复习清单', settings: '本机页面偏好',
};
const profileInputSchema = z.strictObject({
  role: z.string().max(120), resume: z.string().max(64000), jobDescription: z.string().max(12000),
  level: z.enum(['junior', 'mid', 'senior']), questionCount: z.number().int().min(1).max(30),
  focus: z.string().max(1000).default(''), planning: planningOptionsSchema.optional(),
});
export const workspaceIntakeSchema = profileInputSchema.extend({
  step: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  searchEnabled: z.boolean().optional(), searchQuery: z.string().max(200).optional(),
});
export const jobProfileSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), input: profileInputSchema, updatedAt: z.iso.datetime(),
});
export const jobProfilesSchema = z.strictObject({ version: z.literal(1), profiles: z.array(jobProfileSchema).max(50) });
export type JobProfile = z.infer<typeof jobProfileSchema>;
export const reviewItemSchema = z.strictObject({
  id: z.uuid(), interviewId: z.uuid(), questionId: z.string().min(1).max(160), title: z.string().min(1).max(240),
  questionText: z.string().max(16000), evidence: z.string().max(12000).default(''),
  notes: z.string().max(3000), dueAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
});
export const reviewListSchema = z.strictObject({ version: z.literal(1), items: z.array(reviewItemSchema).max(1000) });
export type ReviewItem = z.infer<typeof reviewItemSchema>;

const drillKindSchema = z.enum(['statement', 'code']);
const drillSchema = z.strictObject({ key: z.string().max(150), kind: drillKindSchema, reference: z.string().max(14000), typed: z.string().max(30000) });
const algorithmDraftSchema = z.strictObject({
  version: z.literal(1), problem: z.string().max(14000),
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('example'), title: z.string().max(200), patternId: z.string().max(80) }),
    z.strictObject({ kind: z.literal('bank'), title: z.string().max(200), id: z.uuid() }),
    z.strictObject({ kind: z.literal('hot100'), title: z.string().max(200), id: z.number().int().positive() }),
    z.strictObject({ kind: z.literal('custom'), title: z.string().max(200) }),
  ]),
  patternId: z.string().max(80), kind: drillKindSchema, drills: z.array(drillSchema).max(20),
});
const hot100EntrySchema = z.strictObject({
  questionId: z.number().int().positive(), code: z.string().max(12000), notes: z.string().max(3000), status: z.enum(['todo', 'doing', 'reviewed']),
  favorite: z.boolean().optional(), needsReview: z.boolean().optional(), reviewCount: z.number().int().min(0).max(100000).optional(),
  lastReviewedAt: z.iso.datetime().nullable().optional(), nextReviewAt: z.iso.datetime().nullable().optional(),
});
const hot100DraftSchema = z.strictObject({
  version: z.literal(1), selectedId: z.number().int().positive(),
  filters: z.strictObject({
    query: z.string().max(200).default(''), group: z.string().max(80).default('all'),
    difficulty: z.enum(['all', 'easy', 'medium', 'hard']).default('all'),
    status: z.enum(['all', 'todo', 'doing', 'reviewed']).default('all'),
    favoritesOnly: z.boolean().optional(), reviewOnly: z.boolean().optional(),
  }),
  entries: z.array(hot100EntrySchema).max(100),
});
const preparationCardSchema = z.strictObject({
  requestId: z.uuid(), draft: bankDraftSchema.extend({ title: z.string().max(160), content: z.string().max(3000) }),
  selected: z.boolean(), savedId: z.uuid().nullable(),
});
const preparationPageSchema = z.strictObject({
  form: preparationInputSchema.extend({ role: z.string().max(120), jobDescription: z.string().max(12000) }),
  draft: z.strictObject({ input: preparationInputSchema, result: preparationResultSchema, cards: z.array(preparationCardSchema).min(3).max(12) }).nullable(),
});
const answerKey = /^answer-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-.{1,150}$/i;
const knownKeys = new Set(['interview-intake', 'interview-selected', 'jd-preparation-v1', 'algorithm-practice-v1', 'hot100-practice-v1', 'algorithm-view', 'job-profiles-v1', 'review-list-v1', 'workspace-route']);
export function isWorkspaceKey(key: string) { return knownKeys.has(key) || answerKey.test(key); }
export function workspaceCategory(key: string): WorkspaceCategory {
  if (key === 'algorithm-practice-v1' || key === 'hot100-practice-v1' || key === 'algorithm-view') return 'algorithm';
  if (key === 'jd-preparation-v1') return 'preparation';
  if (key === 'job-profiles-v1') return 'profiles';
  if (key === 'review-list-v1') return 'reviews';
  return key === 'workspace-route' ? 'settings' : 'interviews';
}
export function isSensitiveWorkspaceKey(key: string) { return !['algorithm', 'settings'].includes(workspaceCategory(key)); }

export function normalizeWorkspaceValue(key: string, value: string, salvage = false): string {
  if (!isWorkspaceKey(key)) throw new Error('不支持的本机数据类型。');
  if (value.length > 2_000_000) throw new Error('单项本机数据超过 2 MB。');
  if (answerKey.test(key)) return z.string().max(30000).parse(value);
  if (key === 'interview-selected') return z.uuid().parse(value);
  if (key === 'algorithm-view') return z.enum(['patterns', 'hot100']).parse(value);
  if (key === 'workspace-route') return z.string().max(500).regex(/^#/).parse(value);
  const parsed: unknown = JSON.parse(value);
  if (key === 'interview-intake') return JSON.stringify(workspaceIntakeSchema.parse(parsed));
  if (key === 'jd-preparation-v1') return JSON.stringify(preparationPageSchema.parse(parsed));
  if (key === 'job-profiles-v1') return JSON.stringify(parseCollection(parsed, jobProfilesSchema, 'profiles', jobProfileSchema, salvage));
  if (key === 'review-list-v1') return JSON.stringify(parseCollection(parsed, reviewListSchema, 'items', reviewItemSchema, salvage));
  if (key === 'algorithm-practice-v1') return JSON.stringify(parseCollection(parsed, algorithmDraftSchema, 'drills', drillSchema, salvage));
  if (!salvage) return JSON.stringify(hot100DraftSchema.parse(parsed));
  const oldDraft = z.object({ version: z.literal(1), selectedId: z.unknown(), filters: z.unknown(), entries: z.array(z.unknown()).max(2000) }).parse(parsed);
  const entries = new Map<number, z.infer<typeof hot100EntrySchema>>();
  for (const item of oldDraft.entries) { const entry = hot100EntrySchema.safeParse(item); if (entry.success) entries.set(entry.data.questionId, entry.data); }
  const filters = hot100DraftSchema.shape.filters.safeParse(oldDraft.filters);
  const selectedId = hot100DraftSchema.shape.selectedId.safeParse(oldDraft.selectedId);
  return JSON.stringify(hot100DraftSchema.parse({
    version: 1, selectedId: selectedId.success ? selectedId.data : entries.keys().next().value ?? 1,
    filters: filters.success ? filters.data : hot100DraftSchema.shape.filters.parse({}), entries: [...entries.values()].slice(-100),
  }));
}
function parseCollection<T>(value: unknown, schema: z.ZodType<T>, field: string, itemSchema: z.ZodType, salvage: boolean): T {
  if (!salvage) return schema.parse(value);
  const object = z.record(z.string(), z.unknown()).parse(value);
  const items = z.array(z.unknown()).max(2000).parse(object[field]);
  const valid = items.flatMap(item => { const result = itemSchema.safeParse(item); return result.success ? [result.data] : []; });
  const limits: Record<string, number> = { profiles: 50, items: 1000, drills: 20 };
  return schema.parse({ ...object, [field]: valid.slice(-(limits[field] ?? valid.length)) });
}
export const workspaceBackupRecordSchema = z.strictObject({
  key: z.string().max(220).refine(isWorkspaceKey, '不支持的本机数据类型。'), value: z.string().max(2_000_000),
}).superRefine((record, context) => {
  try { normalizeWorkspaceValue(record.key, record.value); }
  catch { context.addIssue({ code: 'custom', message: '备份中的数据格式无效。' }); }
});
const backupConflictSchema = z.strictObject({
  key: z.string().max(220).refine(isWorkspaceKey), localValue: z.string().max(2_000_000).nullable(), remoteValue: z.string().max(2_000_000).nullable(),
}).superRefine((conflict, context) => {
  try {
    if (conflict.localValue !== null) normalizeWorkspaceValue(conflict.key, conflict.localValue);
    if (conflict.remoteValue !== null) normalizeWorkspaceValue(conflict.key, conflict.remoteValue);
  } catch { context.addIssue({ code: 'custom', message: '备份中的冲突版本无效。' }); }
});
export const workspaceBackupSchema = z.strictObject({
  format: z.literal('interview-agents-workspace'), version: z.literal(1), exportedAt: z.iso.datetime(),
  includesSensitive: z.boolean(), records: z.array(workspaceBackupRecordSchema).max(1500), conflicts: z.array(backupConflictSchema).max(1500).default([]),
}).superRefine((bundle, context) => {
  if (new Set(bundle.records.map(record => record.key)).size !== bundle.records.length) context.addIssue({ code: 'custom', message: '备份包含重复记录。' });
  if (new Set(bundle.conflicts.map(record => record.key)).size !== bundle.conflicts.length) context.addIssue({ code: 'custom', message: '备份包含重复冲突。' });
  if (!bundle.includesSensitive && [...bundle.records, ...bundle.conflicts].some(record => isSensitiveWorkspaceKey(record.key))) context.addIssue({ code: 'custom', message: '备份的个人资料标记不一致。' });
});
export type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>;
