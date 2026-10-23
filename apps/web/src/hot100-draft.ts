import { z } from 'zod';
import { findHot100Question, hot100EntrySchema, hot100Groups } from '../../../packages/interview/src/hot100';
import { hot100PracticeEntrySchema, hot100PracticeFilterSchema, type Hot100PracticeEntry } from '../../../packages/interview/src/hot100-review';
import { readDraftValue } from './storage';

export const hot100DraftKey = 'hot100-practice-v1';
const draftSchema = z.object({
  version: z.literal(1),
  selectedId: z.number().int().refine(id => Boolean(findHot100Question(id))),
  filters: hot100PracticeFilterSchema,
  entries: z.array(hot100PracticeEntrySchema).max(100).refine(entries => new Set(entries.map(entry => entry.questionId)).size === entries.length),
});
export type Hot100Draft = z.infer<typeof draftSchema>;
const storedDraftSchema = z.object({ version: z.literal(1), selectedId: z.unknown(), filters: z.unknown(), entries: z.array(z.unknown()).max(1000) });
export function defaultHot100Draft(): Hot100Draft {
  return { version: 1, selectedId: 1, filters: hot100PracticeFilterSchema.parse({}), entries: [] };
}
export function restoreHot100Draft() {
  let raw: string | null;
  try { raw = readDraftValue(hot100DraftKey); }
  catch { return { draft: defaultHot100Draft(), warning: '无法读取 Hot 100 草稿，当前仍可练习。' }; }
  if (!raw) return { draft: defaultHot100Draft(), warning: '' };
  try {
    if (raw.length > 2_000_000) throw new Error('过大的练习草稿');
    const parsed = storedDraftSchema.parse(JSON.parse(raw));
    const entries = new Map<number, Hot100PracticeEntry>();
    let changed = false;
    for (const rawEntry of parsed.entries) {
      const entry = hot100PracticeEntrySchema.safeParse(rawEntry);
      if (entry.success) {
        if (entries.has(entry.data.questionId)) changed = true;
        entries.set(entry.data.questionId, entry.data);
      } else {
        const legacyEntry = hot100EntrySchema.safeParse(rawEntry);
        if (legacyEntry.success) entries.set(legacyEntry.data.questionId, legacyEntry.data);
        changed = true;
      }
    }
    const selectedId = draftSchema.shape.selectedId.safeParse(parsed.selectedId);
    const filters = hot100PracticeFilterSchema.safeParse(parsed.filters);
    const restoredFilters = filters.success ? filters.data : hot100PracticeFilterSchema.parse({});
    if (!selectedId.success || !filters.success) changed = true;
    if (restoredFilters.group !== 'all' && !hot100Groups.includes(restoredFilters.group)) { restoredFilters.group = 'all'; changed = true; }
    const draft: Hot100Draft = {
      version: 1, selectedId: selectedId.success ? selectedId.data : (entries.keys().next().value ?? 1),
      filters: restoredFilters, entries: [...entries.values()],
    };
    return { draft, warning: changed ? '部分旧题目或草稿格式已更新，已保留可恢复的作答。' : '' };
  } catch { return { draft: defaultHot100Draft(), warning: 'Hot 100 草稿无法解析，已恢复默认题单。' }; }
}
export function updateHot100Entry(draft: Hot100Draft, entry: Hot100PracticeEntry): Hot100Draft {
  return { ...draft, entries: [...draft.entries.filter(item => item.questionId !== entry.questionId), entry] };
}
