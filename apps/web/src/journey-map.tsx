import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag } from 'antd';
import type { InterviewHistoryPage } from '../../../packages/contracts/src/history';
import { reviewListSchema } from '../../../packages/contracts/src/workspace';
import { api } from './api';
import type { Page, Route } from './navigation';
import { readSession } from './storage';
import { hot100DraftKey, restoreHot100Draft } from './hot100-draft';

/** First page size of the paged history endpoints; used to label counts as lower bounds. */
export const historyPageLimit = 20;

type ResumeSummary = Awaited<ReturnType<typeof api.resumeDrafts>>[number];
type PreparationPage = Awaited<ReturnType<typeof api.preparationHistory>>;
type ConversationSummary = Awaited<ReturnType<typeof api.bossConversations>>[number];

export type SourceState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; value: T };
export type LocalReviewState = { status: 'ready'; pending: number; total: number } | { status: 'failed' };
export type LocalAlgorithmState = { status: 'ready'; practiced: number } | { status: 'failed' };
export type StageStatus = 'done' | 'open' | 'loading' | 'unavailable';
export type JourneyStage = { id: 'resume' | 'conversation' | 'preparation' | 'interview' | 'review' | 'algorithm'; title: string; page: Page; status: StageStatus; detail: string };

export type JourneyInput = {
  interviews: SourceState<InterviewHistoryPage>;
  resumes: SourceState<ResumeSummary[]>;
  preparations: SourceState<PreparationPage>;
  conversations: SourceState<ConversationSummary[]>;
  reviews: LocalReviewState;
  algorithm: LocalAlgorithmState;
};

export const stageLabel: Record<StageStatus, string> = { done: '已完成', open: '未开始', loading: '加载中', unavailable: '不可用' };
export const stageTagColor: Record<StageStatus, string | undefined> = { done: 'green', open: undefined, loading: 'blue', unavailable: 'orange' };

export function sourceState<T>(query: { isPending: boolean; isError: boolean; data: T | undefined }): SourceState<T> {
  if (query.isPending) return { status: 'loading' };
  if (query.isError || query.data === undefined) return { status: 'failed' };
  return { status: 'ready', value: query.data };
}

/** A missing key is a real zero; unreadable content stays unavailable so it is never shown as zero. */
export function parseLocalReviews(raw: string | null): LocalReviewState {
  if (raw === null) return { status: 'ready', pending: 0, total: 0 };
  try {
    const parsed = reviewListSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'failed' };
    const items = parsed.data.items;
    return { status: 'ready', total: items.length, pending: items.filter(item => !item.completedAt).length };
  } catch { return { status: 'failed' }; }
}

export function parseLocalAlgorithm(raw: string | null): LocalAlgorithmState {
  if (raw === null) return { status: 'ready', practiced: 0 };
  try {
    const entries = (JSON.parse(raw) as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) return { status: 'failed' };
    return { status: 'ready', practiced: restoreHot100Draft().draft.entries.length };
  } catch { return { status: 'failed' }; }
}

function combine(states: SourceState<unknown>['status'][], settled: 'done' | 'open'): StageStatus {
  if (states.includes('loading')) return 'loading';
  if (states.includes('failed')) return 'unavailable';
  return settled;
}

function pagedDetail(count: number, more: boolean, noun: string, extra: string) {
  const bounded = more && count >= historyPageLimit;
  const head = bounded ? `至少 ${count} ${noun}（单页上限 ${historyPageLimit}）` : `${count} ${noun}`;
  return extra ? `${head}，${bounded ? '本页内' : '其中'} ${extra}` : head;
}

export function buildJourneyStages(input: JourneyInput): JourneyStage[] {
  const { interviews, resumes, preparations, conversations, reviews, algorithm } = input;

  const resumeStage: JourneyStage = {
    id: 'resume', title: '简历', page: 'resumeStudio',
    status: combine([resumes.status], resumes.status === 'ready' && resumes.value.length > 0 ? 'done' : 'open'),
    detail: resumes.status === 'loading' ? '正在读取简历记录…'
      : resumes.status === 'failed' ? '简历记录读取失败'
      : resumes.value.length ? `已保存 ${resumes.value.length} 份 JSON 简历副本` : '还没有保存 JSON 简历副本',
  };

  const conversationStage: JourneyStage = {
    id: 'conversation', title: '岗位会话', page: 'bossInbox',
    status: combine([conversations.status], conversations.status === 'ready' && conversations.value.length > 0 ? 'done' : 'open'),
    detail: conversations.status === 'loading' ? '正在读取已同步的会话…'
      : conversations.status === 'failed' ? '会话记录读取失败'
      : conversations.value.length ? `已同步 ${conversations.value.length} 个 BOSS 会话记录` : '还没有同步 BOSS 会话',
  };

  const preparationStage: JourneyStage = {
    id: 'preparation', title: 'JD 备题', page: 'preparation',
    status: combine([preparations.status], preparations.status === 'ready' && preparations.value.items.length > 0 ? 'done' : 'open'),
    detail: preparations.status === 'loading' ? '正在读取备题记录…'
      : preparations.status === 'failed' ? '备题记录读取失败'
      : preparations.value.items.length ? pagedDetail(preparations.value.items.length, preparations.value.nextBefore !== null, '条备题记录', '') : '还没有备题记录',
  };

  const interviewItems = interviews.status === 'ready' ? interviews.value.items : [];
  const activeInterviews = interviewItems.filter(item => !['completed', 'cancelled'].includes(item.status)).length;
  const completedInterviews = interviewItems.filter(item => item.status === 'completed').length;
  const interviewMore = interviews.status === 'ready' && interviews.value.nextCursor !== null;
  const interviewStage: JourneyStage = {
    id: 'interview', title: '模拟面试', page: 'practice',
    status: combine([interviews.status], interviewItems.length > 0 ? 'done' : 'open'),
    detail: interviews.status === 'loading' ? '正在读取面试记录…'
      : interviews.status === 'failed' ? '面试记录读取失败'
      : interviewItems.length ? pagedDetail(interviewItems.length, interviewMore, '场面试记录', `${activeInterviews} 场进行中、${completedInterviews} 场已完成`) : '还没有开始模拟面试',
  };

  const reviewStage: JourneyStage = {
    id: 'review', title: '复盘与复习', page: 'review',
    status: combine([reviews.status], reviews.status === 'ready' && reviews.total > 0 ? 'done' : 'open'),
    detail: reviews.status === 'failed' ? '本机复习记录读取失败'
      : reviews.total ? `${reviews.pending} 项待复习，共 ${reviews.total} 项` : '复习清单还是空的',
  };

  const algorithmStage: JourneyStage = {
    id: 'algorithm', title: '算法训练', page: 'algorithm',
    status: combine([algorithm.status], algorithm.status === 'ready' && algorithm.practiced > 0 ? 'done' : 'open'),
    detail: algorithm.status === 'failed' ? '本机算法草稿读取失败'
      : algorithm.practiced ? `已练 ${algorithm.practiced} 道 Hot 100 题` : '还没有开始算法练习',
  };

  return [resumeStage, conversationStage, preparationStage, interviewStage, reviewStage, algorithmStage];
}

function useRecentHistory() {
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const history = useQuery({ queryKey: ['recent-history'], queryFn: () => api.history({ limit: historyPageLimit }), enabled: identity.isSuccess });
  const source: SourceState<InterviewHistoryPage> = identity.isError ? { status: 'failed' } : sourceState(history);
  return {
    source, identity,
    retry: () => { if (identity.isError) void identity.refetch(); void history.refetch(); },
  };
}

function useLocalReviews() {
  const [initial] = useState(() => parseLocalReviews(readSession('review-list-v1')));
  const query = useQuery({ queryKey: ['local-reviews'], queryFn: () => parseLocalReviews(readSession('review-list-v1')), initialData: initial, staleTime: 0 });
  return { reviews: query.data ?? { status: 'failed' } as LocalReviewState, refresh: () => void query.refetch() };
}

function useLocalAlgorithm() {
  const [revision, setRevision] = useState(0);
  const algorithm = useMemo(() => parseLocalAlgorithm(readSession(hot100DraftKey)), [revision]);
  return { algorithm, refresh: () => setRevision(value => value + 1) };
}

/** Interview and review counts for the sidebar; shares the home page queries through the same cache keys. */
export function useJourneyCounts() {
  const recent = useRecentHistory();
  const local = useLocalReviews();
  return { interviews: recent.source, reviews: local.reviews };
}

/** Owner-scoped journey sources; every query key matches the panel that already owns that data. */
export function useJourneyData() {
  const recent = useRecentHistory();
  const identity = recent.identity;
  const resumes = useQuery({ queryKey: ['resume-drafts'], queryFn: api.resumeDrafts, enabled: identity.isSuccess });
  const preparations = useQuery({ queryKey: ['preparation-history', undefined], queryFn: () => api.preparationHistory(), enabled: identity.isSuccess });
  const conversations = useQuery({ queryKey: ['boss-inbox'], queryFn: api.bossConversations, enabled: identity.isSuccess });
  const local = useLocalReviews();
  const algorithm = useLocalAlgorithm();
  const failed = identity.isError;
  const input: JourneyInput = {
    interviews: recent.source,
    resumes: failed ? { status: 'failed' } : sourceState(resumes),
    preparations: failed ? { status: 'failed' } : sourceState(preparations),
    conversations: failed ? { status: 'failed' } : sourceState(conversations),
    reviews: local.reviews,
    algorithm: algorithm.algorithm,
  };
  function retry() {
    recent.retry();
    void resumes.refetch();
    void preparations.refetch();
    void conversations.refetch();
    local.refresh();
    algorithm.refresh();
  }
  return { input, retry };
}

export function JourneyMap({ data, navigate }: { data: { input: JourneyInput; retry: () => void }; navigate: (route: Route) => void }) {
  const stages = buildJourneyStages(data.input);
  const next = stages.find(stage => stage.status === 'open');
  const loading = stages.some(stage => stage.status === 'loading');
  const unavailable = stages.some(stage => stage.status === 'unavailable');
  return <section className="journey-map" aria-labelledby="journey-map-title">
    <div className="section-heading">
      <div><h2 id="journey-map-title">求职旅程地图</h2><p>各阶段状态来自你自己保存的简历、备题、会话、面试与本机复习记录。它不推断投递、送达或录用结果。</p></div>
      <Button onClick={data.retry}>刷新状态</Button>
    </div>
    <div className="journey-map-grid">
      {stages.map(stage => <article className={`journey-stage ${stage.status}`} key={stage.id}>
        <div className="journey-stage-head"><h3>{stage.title}</h3><Tag color={stageTagColor[stage.status]}>{stageLabel[stage.status]}</Tag></div>
        <p>{stage.detail}</p>
        <Button size="small" disabled={stage.status === 'loading'} onClick={() => navigate({ page: stage.page })}>{stage.status === 'done' ? '再次进入' : '进入'}</Button>
      </article>)}
    </div>
    <p className="journey-next" role="status">{next ? <>下一步建议：<Button type="link" onClick={() => navigate({ page: next.page })}>{next.title}</Button></> : loading ? '正在读取你的记录…' : unavailable ? '部分记录读取失败，可先刷新状态或直接进入对应模块。' : '这些阶段都已有记录，可以按当前目标继续。'}</p>
  </section>;
}
