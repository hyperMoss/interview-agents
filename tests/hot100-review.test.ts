import { describe, expect, it, vi } from 'vitest';
import { findHot100Question } from '../packages/interview/src/hot100';
import { completeHot100Review, filterHot100Practice, getHot100PracticeEntry, hot100PracticeEntrySchema, hot100PracticeFilterSchema, hot100TopicProgress, isHot100ReviewDue, markHot100NeedsReview, nextHot100PracticeQuestion, type Hot100PracticeEntry } from '../packages/interview/src/hot100-review';
import { defaultHot100Draft, restoreHot100Draft } from '../apps/web/src/hot100-draft';

const storage = vi.hoisted(() => ({ read: vi.fn<() => string | null>() }));
vi.mock('../apps/web/src/storage', () => ({ readDraftValue: storage.read }));
const now = new Date('2026-10-23T08:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
function question(id: number) {
  const found = findHot100Question(id);
  if (!found) throw new Error(`Unknown fixture question ${id}`);
  return found;
}

describe('Hot 100 spaced self review', () => {
  it('uses 1, 3, 7 and 14 days, caps later intervals and preserves the solution', () => {
    let entry: Hot100PracticeEntry = { questionId: 1, code: 'return [i, j]', notes: '先查询互补数', status: 'doing', favorite: true };
    for (const days of [1, 3, 7, 14, 14, 14]) {
      entry = completeHot100Review(entry, now);
      expect(entry.nextReviewAt).toBe(new Date(now.getTime() + days * day).toISOString());
      expect(entry).toMatchObject({ status: 'reviewed', favorite: true, needsReview: false, code: 'return [i, j]', notes: '先查询互补数', lastReviewedAt: now.toISOString() });
    }
    expect(entry.reviewCount).toBe(6);
  });

  it('manual retry schedules tomorrow without counting a completed review', () => {
    const reviewed = completeHot100Review(getHot100PracticeEntry([], 1), now);
    const retry = markHot100NeedsReview(reviewed, now);
    expect(retry).toMatchObject({ status: 'doing', needsReview: true, reviewCount: 1, lastReviewedAt: now.toISOString(), nextReviewAt: new Date(now.getTime() + day).toISOString() });
    expect(isHot100ReviewDue(retry, now)).toBe(false);
    expect(isHot100ReviewDue(retry, new Date(now.getTime() + day))).toBe(true);
    expect(completeHot100Review(retry, now)).toMatchObject({ needsReview: false, reviewCount: 2, status: 'reviewed' });
  });

  it('preserves legacy entries and does not invent a historical review date', () => {
    const legacy = hot100PracticeEntrySchema.parse({ questionId: 1, code: '# 我的解法', notes: '记录', status: 'reviewed' });
    expect(getHot100PracticeEntry([legacy], 1)).toMatchObject({ code: '# 我的解法', status: 'reviewed', favorite: false, needsReview: false, reviewCount: 0, nextReviewAt: null, lastReviewedAt: null });
    expect(isHot100ReviewDue(legacy, now)).toBe(false);
    expect(hot100PracticeEntrySchema.safeParse({ ...legacy, reviewCount: -1 }).success).toBe(false);
  });
});

describe('Hot 100 practice selection', () => {
  const questions = [1, 49, 128, 283].map(question);
  it('prioritizes the oldest due review, then todo, then doing, while skipping the current question', () => {
    const entries: Hot100PracticeEntry[] = [
      { ...getHot100PracticeEntry([], 1), status: 'doing' },
      { ...getHot100PracticeEntry([], 49), status: 'doing' },
      { ...getHot100PracticeEntry([], 128), status: 'reviewed', nextReviewAt: new Date(now.getTime() - day).toISOString() },
      { ...getHot100PracticeEntry([], 283), status: 'reviewed', nextReviewAt: new Date(now.getTime() - 2 * day).toISOString() },
    ];
    expect(nextHot100PracticeQuestion(questions, entries, 1, now)?.id).toBe(283);
    expect(nextHot100PracticeQuestion(questions, entries, 283, now)?.id).toBe(128);
    const completed = entries.map(entry => ({ ...entry, nextReviewAt: null }));
    expect(nextHot100PracticeQuestion(questions, completed.filter(entry => entry.questionId !== 283), 1, now)?.id).toBe(283);
    expect(nextHot100PracticeQuestion(questions, completed, 1, now)?.id).toBe(49);
    expect(nextHot100PracticeQuestion([question(1)], entries, 1, now)).toBeUndefined();
  });

  it('intersects favorite and review filters with topic, difficulty and query before picking next', () => {
    const entries: Hot100PracticeEntry[] = [
      { ...getHot100PracticeEntry([], 1), favorite: true, needsReview: true, nextReviewAt: new Date(now.getTime() + day).toISOString() },
      { ...getHot100PracticeEntry([], 49), favorite: true, status: 'reviewed', nextReviewAt: now.toISOString() },
      { ...getHot100PracticeEntry([], 128), favorite: false, needsReview: true },
    ];
    const filtered = filterHot100Practice(hot100PracticeFilterSchema.parse({ favoritesOnly: true, reviewOnly: true, group: '哈希', difficulty: 'easy' }), entries, now);
    expect(filtered.map(item => item.id)).toEqual([1]);
    expect(nextHot100PracticeQuestion(filtered, entries, 1, now)).toBeUndefined();
    expect(filterHot100Practice(hot100PracticeFilterSchema.parse({ reviewOnly: true, query: '49' }), entries, now).map(item => item.id)).toEqual([49]);
    expect(hot100TopicProgress(entries, now).find(topic => topic.group === '哈希')).toMatchObject({ total: 3, reviewed: 1, due: 1 });
  });
});

describe('Hot 100 draft compatibility', () => {
  it('retains legacy answers and new review metadata across restore', () => {
    const entry = completeHot100Review({ questionId: 1, code: '  # 不裁剪中文😀\n', notes: '边界', status: 'doing', favorite: true }, now);
    const legacy = { questionId: 49, code: '# 旧答案', notes: '', status: 'reviewed' };
    const draft = { ...defaultHot100Draft(), entries: [entry, legacy], filters: hot100PracticeFilterSchema.parse({ favoritesOnly: true }) };
    storage.read.mockReturnValue(JSON.stringify(draft));
    expect(restoreHot100Draft().draft).toEqual(draft);
  });

  it('recovers the original solution when only review metadata is damaged', () => {
    storage.read.mockReturnValue(JSON.stringify({ ...defaultHot100Draft(), entries: [
      { questionId: 1, code: '# 保留代码', notes: '保留思路', status: 'doing', reviewCount: -5 },
      { questionId: 49, code: '# 正常代码', notes: '', status: 'reviewed', favorite: true },
    ] }));
    const restored = restoreHot100Draft();
    expect(restored.draft.entries).toEqual([
      { questionId: 1, code: '# 保留代码', notes: '保留思路', status: 'doing' },
      { questionId: 49, code: '# 正常代码', notes: '', status: 'reviewed', favorite: true },
    ]);
    expect(restored.warning).toContain('已保留可恢复的作答');
  });
});
