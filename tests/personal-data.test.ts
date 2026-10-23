import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newSession } from '../packages/interview/src/domain';
import { turnSchema } from '../packages/contracts/src/index';
import { reviewListSchema } from '../packages/contracts/src/workspace';
import { addReviewItem, readReviews, removeInterviewReviews } from '../apps/web/src/personal-data';
import { input } from './fixtures';

const stored = vi.hoisted(() => new Map<string, string>());
vi.mock('../apps/web/src/storage', () => ({
  readSession: (key: string) => stored.get(key) ?? null,
  writeSession: (key: string, value: string | null) => { if (value === null) stored.delete(key); else stored.set(key, value); return true; },
}));
beforeEach(() => stored.clear());
describe('report actions into the personal review list', () => {
  it('deletes only the selected interview reviews and preserves separate profiles', () => {
    const session = newSession(input, 'demo');
    const other = newSession(input, 'demo');
    const turn = turnSchema.parse({ question: { text: '如何验证修改有效？', competency: '工程能力', kind: 'technical' }, answer: '补充用例并观察实际执行结果。', assessment: { score: 70, evidence: '观察实际执行结果', feedback: '增加失败路径验证。', strengths: [], improvements: ['增加失败路径验证。'] } });
    stored.set('job-profiles-v1', 'separate saved profile');
    addReviewItem(session, turn, 0);
    addReviewItem(other, turn, 0);
    expect(removeInterviewReviews(session.id)).toBe(true);
    expect(readReviews().map(item => item.interviewId)).toEqual([other.id]);
    expect(stored.get('job-profiles-v1')).toBe('separate saved profile');
    expect(removeInterviewReviews(session.id)).toBe(true);
    expect(readReviews()).toHaveLength(1);
  });
  it('accepts valid maximum role and competency lengths without losing original evidence', () => {
    const session = newSession({ ...input, role: '岗'.repeat(120) }, 'demo');
    const turn = turnSchema.parse({ question: { id: crypto.randomUUID(), text: '题'.repeat(16000), competency: '能'.repeat(100), kind: 'technical' }, answer: '实际回答内容，保留原始依据。', assessment: { score: 60, evidence: '实际回答内容', feedback: '说明验证的过程。', strengths: [], improvements: ['补充边界案例。'] } });
    expect(() => addReviewItem(session, turn, 0)).not.toThrow();
    const list = reviewListSchema.parse(JSON.parse(stored.get('review-list-v1') ?? 'null'));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe(`${session.role} · ${turn.question.competency}`);
    expect(list.items[0]?.questionText).toBe(turn.question.text);
    expect(list.items[0]?.evidence).toBe(turn.assessment.evidence);
    expect(addReviewItem(session, turn, 0)).toBe(false);
    expect(reviewListSchema.parse(JSON.parse(stored.get('review-list-v1') ?? 'null')).items).toHaveLength(1);
  });
});
