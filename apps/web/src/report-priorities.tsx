import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import type { Session, Turn } from '../../../packages/contracts/src/index';
import type { ReviewItem } from '../../../packages/contracts/src/workspace';
import { addReviewItem, readReviews, saveReviews } from './personal-data';

export type ReportReview = {
  isJoined: (turn: Turn, index: number) => boolean;
  add: (turn: Turn, index: number) => void;
  toggle: (turn: Turn, index: number) => void;
  message: string;
};

/** What a click does with the current list. Insertion rules stay owned by `personal-data`. */
export type ReviewIntent =
  | { kind: 'add' }
  | { kind: 'remove'; remaining: ReviewItem[]; message: string };

/** Stable per-question identity. The review writer in `personal-data` uses the same rule. */
export function questionIdOf(turn: Turn, index: number) {
  return turn.question.id ?? `turn-${index}`;
}

const isOpenItem = (session: Session, questionId: string) => (item: ReviewItem) =>
  item.interviewId === session.id && item.questionId === questionId && !item.completedAt;

export function reviewIntent(items: ReviewItem[], session: Session, turn: Turn, index: number): ReviewIntent {
  const open = isOpenItem(session, questionIdOf(turn, index));
  if (!items.some(open)) return { kind: 'add' };
  return { kind: 'remove', remaining: items.filter(item => !open(item)), message: `第 ${index + 1} 题已移出面试复习清单。` };
}

/**
 * Report the effect of an attempted insert by comparing the list before and after: the writer's
 * boolean does not distinguish a stored record, a duplicate, a capacity refusal and a failed local
 * write, because `personal-data` ignores the save result.
 */
export function reviewAddMessage(before: ReviewItem[], after: ReviewItem[], session: Session, turn: Turn, index: number): string {
  const open = isOpenItem(session, questionIdOf(turn, index));
  if (after.some(open)) return before.some(open)
    ? `第 ${index + 1} 题已在待复习清单中，没有重复加入。`
    : `第 ${index + 1} 题已加入面试复习清单，可在复习清单回看原文依据。`;
  return `第 ${index + 1} 题的复习没有写入：复习清单已满或本机存储写入失败，请检查本机数据并在复习清单移除部分记录后重试。`;
}

/**
 * Shared review state for one report. Every write goes through the existing local review list, so
 * the report, the bulk entry and the review page read the same records.
 */
export function useReportReview(session: Session): ReportReview {
  const [items, setItems] = useState<ReviewItem[]>(readReviews);
  const [message, setMessage] = useState('');
  const isJoined = (turn: Turn, index: number) => items.some(isOpenItem(session, questionIdOf(turn, index)));
  function add(turn: Turn, index: number) {
    const before = readReviews();
    addReviewItem(session, turn, index);
    const after = readReviews();
    setItems(after);
    setMessage(reviewAddMessage(before, after, session, turn, index));
  }
  function toggle(turn: Turn, index: number) {
    const current = readReviews();
    const intent = reviewIntent(current, session, turn, index);
    if (intent.kind === 'add') { add(turn, index); return; }
    if (!saveReviews(intent.remaining)) {
      setItems(current);
      setMessage('本机写入失败，复习清单没有变化；请检查本机存储后重试。');
      return;
    }
    setItems(readReviews());
    setMessage(intent.message);
  }
  return { isJoined, add, toggle, message };
}

export function ReportPriorities({ session, review }: { session: Session; review: ReportReview }) {
  const priorities = session.turns.map((turn, index) => ({ turn, index })).sort((a, b) => a.turn.assessment.score - b.turn.assessment.score).slice(0, 3);
  function reveal(index: number) {
    const element = document.getElementById(`qa-${index}`);
    if (element instanceof HTMLDetailsElement) { const parent = element.parentElement; if (parent instanceof HTMLDetailsElement) parent.open = true; element.open = true; element.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  return <section className="report-priorities" aria-label="优先复习的 QA"><h3>先复习这几道题</h3><p>按本次评分从低到高选择，改进建议来自对应 QA。{session.modelMode === 'demo' ? '规则演示评分仅供体验流程。' : ''}</p>
    {priorities.map(({ turn, index }) => <article key={turn.question.id ?? index}><strong>第 {index + 1} 题 · {turn.question.competency}</strong><p>{turn.assessment.improvements.join('；')}</p><div className="panel-actions"><Button label={`查看第 ${index + 1} 题依据`} onClick={() => reveal(index)} /><Button label={`加入第 ${index + 1} 题复习`} onClick={() => review.add(turn, index)} /></div></article>)}
    {review.message ? <p role="status" className="review-message">{review.message}</p> : null}
  </section>;
}
