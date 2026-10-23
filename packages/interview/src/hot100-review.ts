import { z } from 'zod';
import { filterHot100, hot100EntrySchema, hot100FilterSchema, hot100Groups, hot100Questions, type Hot100Question } from './hot100';

// Optional additions let older drafts retain their original code, notes and self evaluation.
export const hot100PracticeEntrySchema = hot100EntrySchema.extend({
  favorite: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  reviewCount: z.number().int().min(0).max(100000).optional(),
  lastReviewedAt: z.iso.datetime().nullable().optional(),
  nextReviewAt: z.iso.datetime().nullable().optional(),
});
export type Hot100PracticeEntry = z.infer<typeof hot100PracticeEntrySchema>;
export const hot100PracticeFilterSchema = hot100FilterSchema.extend({
  favoritesOnly: z.boolean().optional(),
  reviewOnly: z.boolean().optional(),
});
export type Hot100PracticeFilter = z.infer<typeof hot100PracticeFilterSchema>;

export function getHot100PracticeEntry(entries: Hot100PracticeEntry[], questionId: number) {
  const entry = entries.find(item => item.questionId === questionId);
  const defaults: Required<Hot100PracticeEntry> = {
    questionId, code: '', notes: '', status: 'todo', favorite: false,
    needsReview: false, reviewCount: 0, lastReviewedAt: null, nextReviewAt: null,
  };
  return {
    ...defaults, ...entry,
  };
}

const reviewIntervals = [1, 3, 7, 14];
const dayMilliseconds = 24 * 60 * 60 * 1000;

export function completeHot100Review(entry: Hot100PracticeEntry, now: Date): Hot100PracticeEntry {
  const reviewCount = Math.min(100000, (entry.reviewCount ?? 0) + 1);
  const interval = reviewIntervals[Math.min(reviewCount - 1, reviewIntervals.length - 1)] ?? 14;
  return {
    ...entry, status: 'reviewed', needsReview: false, reviewCount,
    lastReviewedAt: now.toISOString(), nextReviewAt: new Date(now.getTime() + interval * dayMilliseconds).toISOString(),
  };
}

export function markHot100NeedsReview(entry: Hot100PracticeEntry, now: Date): Hot100PracticeEntry {
  return { ...entry, status: 'doing', needsReview: true, nextReviewAt: new Date(now.getTime() + dayMilliseconds).toISOString() };
}

export function isHot100ReviewDue(entry: Hot100PracticeEntry, now: Date) {
  return Boolean(entry.nextReviewAt && Date.parse(entry.nextReviewAt) <= now.getTime());
}

export function filterHot100Practice(filters: Hot100PracticeFilter, entries: Hot100PracticeEntry[], now: Date) {
  return filterHot100(filters, entries).filter(question => {
    const entry = getHot100PracticeEntry(entries, question.id);
    return (!filters.favoritesOnly || entry.favorite)
      && (!filters.reviewOnly || entry.needsReview || isHot100ReviewDue(entry, now));
  });
}

export function nextHot100PracticeQuestion(questions: Hot100Question[], entries: Hot100PracticeEntry[], afterId: number, now: Date) {
  const index = questions.findIndex(question => question.id === afterId);
  const ordered = [...questions.slice(index + 1), ...questions.slice(0, Math.max(0, index))].filter(question => question.id !== afterId);
  const due = ordered.filter(question => isHot100ReviewDue(getHot100PracticeEntry(entries, question.id), now));
  due.sort((left, right) => Date.parse(getHot100PracticeEntry(entries, left.id).nextReviewAt ?? '') - Date.parse(getHot100PracticeEntry(entries, right.id).nextReviewAt ?? ''));
  return due[0]
    ?? ordered.find(question => getHot100PracticeEntry(entries, question.id).status === 'todo')
    ?? ordered.find(question => getHot100PracticeEntry(entries, question.id).status === 'doing');
}

export function hot100TopicProgress(entries: Hot100PracticeEntry[], now: Date) {
  return hot100Groups.map(group => {
    const questions = hot100Questions.filter(question => question.group === group);
    const reviewed = questions.filter(question => getHot100PracticeEntry(entries, question.id).status === 'reviewed').length;
    const due = questions.filter(question => isHot100ReviewDue(getHot100PracticeEntry(entries, question.id), now)).length;
    return { group, total: questions.length, reviewed, due, percent: Math.round(reviewed / questions.length * 100) };
  });
}
