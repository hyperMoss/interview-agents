import type { Session, Turn } from '../../../packages/contracts/src/index';
import { jobProfilesSchema, reviewListSchema, type JobProfile, type ReviewItem } from '../../../packages/contracts/src/workspace';
import { readSession, writeSession } from './storage';

export function readProfiles(): JobProfile[] {
  try { return jobProfilesSchema.parse(JSON.parse(readSession('job-profiles-v1') ?? '{"version":1,"profiles":[]}')).profiles; }
  catch { return []; }
}
export function saveProfiles(profiles: JobProfile[]) {
  return writeSession('job-profiles-v1', JSON.stringify(jobProfilesSchema.parse({ version: 1, profiles })));
}
export function readReviews(): ReviewItem[] {
  try { return reviewListSchema.parse(JSON.parse(readSession('review-list-v1') ?? '{"version":1,"items":[]}')).items; }
  catch { return []; }
}
export function saveReviews(items: ReviewItem[]) {
  return writeSession('review-list-v1', JSON.stringify(reviewListSchema.parse({ version: 1, items })));
}
export function removeInterviewReviews(interviewId: string) {
  const items = readReviews();
  const remaining = items.filter(item => item.interviewId !== interviewId);
  return remaining.length === items.length || saveReviews(remaining);
}
export function addReviewItem(session: Session, turn: Turn, index: number) {
  const items = readReviews();
  const questionId = turn.question.id ?? `turn-${index}`;
  if (items.length >= 1000 || items.some(item => item.interviewId === session.id && item.questionId === questionId && !item.completedAt)) return false;
  const due = new Date(); due.setDate(due.getDate() + 1);
  saveReviews([...items, {
    id: crypto.randomUUID(), interviewId: session.id, questionId, title: `${session.role} · ${turn.question.competency}`,
    questionText: turn.question.text, evidence: turn.assessment.evidence, notes: turn.assessment.improvements.join('\n'),
    dueAt: due.toISOString(), completedAt: null,
  }]);
  return true;
}
