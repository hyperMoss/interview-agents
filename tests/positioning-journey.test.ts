import { describe, expect, it } from 'vitest';
import type { InterviewHistoryItem, InterviewHistoryPage } from '../packages/contracts/src/history';
import { buildJourneyStages, parseLocalAlgorithm, parseLocalReviews, sourceState, type JourneyInput, type SourceState } from '../apps/web/src/journey-map';
import { interviewCountText } from '../apps/web/src/module-navigation';
import { hasUnsubmittedPreparationDraft, shouldShowOnboarding } from '../apps/web/src/onboarding-panel';

const ready = <T>(value: T): SourceState<T> => ({ status: 'ready', value });
const emptyHistory: InterviewHistoryPage = { items: [], nextCursor: null };
const noReviews = { status: 'ready', pending: 0, total: 0 } as const;

function interviewItem(status: InterviewHistoryItem['status']): InterviewHistoryItem {
  return { id: crypto.randomUUID(), role: '全栈工程师', status, createdAt: new Date().toISOString(), turnCount: 3, questionCount: 3, modelMode: 'demo', overallScore: null };
}

function preparationItem() {
  return { id: crypto.randomUUID(), parentId: null, role: '全栈工程师', questionCount: 6, createdAt: new Date().toISOString(), status: 'ready' as const };
}

function journey(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    interviews: ready(emptyHistory), resumes: ready([]), preparations: ready({ items: [], nextBefore: null }),
    conversations: ready([]), reviews: noReviews, algorithm: { status: 'ready', practiced: 0 },
    ...overrides,
  };
}

describe('journey stages', () => {
  const stageOf = (input: JourneyInput, id: 'resume' | 'conversation' | 'preparation' | 'interview' | 'review' | 'algorithm') => {
    const found = buildJourneyStages(input).find(stage => stage.id === id);
    if (!found) throw new Error(`missing stage ${id}`);
    return found;
  };

  it('reports empty owner records as not started', () => {
    const stages = buildJourneyStages(journey());
    expect(stages.map(stage => stage.status)).toEqual(['open', 'open', 'open', 'open', 'open', 'open']);
    expect(stageOf(journey(), 'resume').detail).toContain('还没有保存 JSON 简历副本');
    expect(stageOf(journey(), 'interview').detail).toContain('还没有开始模拟面试');
    expect(stageOf(journey(), 'review').detail).toContain('复习清单还是空的');
  });

  it('keeps loading and unavailable apart from a real zero', () => {
    expect(stageOf(journey({ interviews: { status: 'loading' } }), 'interview').status).toBe('loading');
    expect(stageOf(journey({ interviews: { status: 'loading' } }), 'interview').detail).toContain('正在读取');
    expect(stageOf(journey({ resumes: { status: 'failed' } }), 'resume').status).toBe('unavailable');
    expect(stageOf(journey({ reviews: { status: 'failed' } }), 'review').status).toBe('unavailable');
    expect(sourceState({ isPending: true, isError: false, data: undefined })).toEqual({ status: 'loading' });
    expect(sourceState({ isPending: false, isError: true, data: undefined })).toEqual({ status: 'failed' });
    expect(sourceState({ isPending: false, isError: false, data: 3 })).toEqual({ status: 'ready', value: 3 });
  });

  it('labels a full page as a lower bound instead of a total', () => {
    const items = Array.from({ length: 20 }, () => interviewItem('completed'));
    const filled = journey({
      interviews: ready({ items, nextCursor: 'next-page' }),
      preparations: ready({ items: Array.from({ length: 20 }, preparationItem), nextBefore: 'more' }),
    });
    expect(stageOf(filled, 'interview').detail).toContain('至少 20 场面试记录（单页上限 20）');
    expect(stageOf(filled, 'preparation').detail).toContain('至少 20 条备题记录（单页上限 20）');
    const counts = interviewCountText(
      { status: 'ready', value: { items: items.map(() => interviewItem('awaiting_answer')), nextCursor: 'next-page' } },
      noReviews,
    );
    expect(counts).toContain('进行中 ≥20');
    const zeroActivePage = interviewCountText({ status: 'ready', value: { items, nextCursor: 'next-page' } }, noReviews);
    expect(zeroActivePage).toContain('进行中 0（本页）');
  });
});

describe('local journey records', () => {
  it('separates unreadable local content from empty content', () => {
    expect(parseLocalReviews(null)).toEqual({ status: 'ready', pending: 0, total: 0 });
    expect(parseLocalReviews('{not json').status).toBe('failed');
    expect(parseLocalReviews(JSON.stringify({ version: 1, items: [{
      id: crypto.randomUUID(), interviewId: crypto.randomUUID(), questionId: 'turn-1', title: '示例岗位 · 技术能力',
      questionText: '问题原文', evidence: '', notes: '', dueAt: new Date().toISOString(), completedAt: null,
    }] }))).toEqual({ status: 'ready', pending: 1, total: 1 });
    expect(parseLocalAlgorithm(null)).toEqual({ status: 'ready', practiced: 0 });
    expect(parseLocalAlgorithm('{"entries":"not-an-array"}').status).toBe('failed');
  });
});

describe('first-use guidance', () => {
  it('appears only when both sources loaded empty and no preparation draft exists', () => {
    const empty = { interviews: ready(emptyHistory), resumes: ready([]), preparationDraft: false, intakeDraft: false };
    expect(shouldShowOnboarding(empty)).toBe(true);
    expect(shouldShowOnboarding({ ...empty, preparationDraft: true })).toBe(false);
    expect(shouldShowOnboarding({ ...empty, intakeDraft: true })).toBe(false);
    expect(shouldShowOnboarding({ ...empty, interviews: { status: 'loading' } })).toBe(false);
    expect(shouldShowOnboarding({ ...empty, resumes: { status: 'failed' } })).toBe(false);
    expect(shouldShowOnboarding({ ...empty, resumes: ready([{}]) })).toBe(false);
    expect(shouldShowOnboarding({ ...empty, interviews: ready({ items: [interviewItem('completed')], nextCursor: null }) })).toBe(false);
  });

  it('treats unsaved draft cards as active work and unreadable drafts as present', () => {
    expect(hasUnsubmittedPreparationDraft(null)).toBe(false);
    expect(hasUnsubmittedPreparationDraft(JSON.stringify({ form: {}, draft: null }))).toBe(false);
    expect(hasUnsubmittedPreparationDraft(JSON.stringify({ form: {}, draft: { cards: [{ savedId: null }] } }))).toBe(true);
    expect(hasUnsubmittedPreparationDraft(JSON.stringify({ form: {}, draft: { cards: [{ savedId: crypto.randomUUID() }] } }))).toBe(false);
    expect(hasUnsubmittedPreparationDraft('{broken')).toBe(true);
  });
});

describe('sidebar interview counts', () => {
  it('shows loading, unavailable, empty and counted states distinctly', () => {
    expect(interviewCountText({ status: 'loading' }, noReviews)).toBe('暂无待复习 · 进行中 读取中');
    expect(interviewCountText({ status: 'failed' }, { status: 'failed' })).toBe('待复习 不可用 · 进行中 不可用');
    expect(interviewCountText({ status: 'ready', value: emptyHistory }, noReviews)).toBe('暂无待复习 · 暂无进行中');
    expect(interviewCountText(
      { status: 'ready', value: { items: [interviewItem('awaiting_answer'), interviewItem('completed')], nextCursor: null } },
      { status: 'ready', pending: 2, total: 5 },
    )).toBe('待复习 2 · 进行中 1');
  });
});
