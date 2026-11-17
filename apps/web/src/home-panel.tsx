import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { TextArea } from '@astryxdesign/core/TextArea';
import type { InterviewHistoryPage } from '../../../packages/contracts/src/history';
import type { Route } from './navigation';
import { statusLabels } from './navigation';
import { readSession } from './storage';
import { readProfiles, readReviews, saveReviews } from './personal-data';
import { restoreHot100Draft } from './hot100-draft';
import { findHot100Question } from '../../../packages/interview/src/hot100';
import { isHot100ReviewDue } from '../../../packages/interview/src/hot100-review';
import { buildJourneyStages, JourneyMap, stageLabel, useJourneyData } from './journey-map';
import { OnboardingPanel } from './onboarding-panel';
import { ConfirmAction } from './ui/confirm-action';

type HistoryItems = InterviewHistoryPage['items'];
export function HomePanel({ history, navigate, openUtility, modelReady }: { history: HistoryItems; navigate: (route: Route) => void; openUtility: (page: 'model' | 'data') => void; modelReady: boolean }) {
  const reviews = readReviews().filter(item => !item.completedAt);
  const algorithm = restoreHot100Draft().draft;
  const dueCount = algorithm.entries.filter(entry => isHot100ReviewDue(entry, new Date())).length;
  const active = history.find(item => !['completed', 'cancelled'].includes(item.status));
  const lastQuestion = findHot100Question(algorithm.selectedId);
  const profiles = readProfiles();
  const hasIntake = Boolean(readSession('interview-intake'));
  const journey = useJourneyData();
  const journeyStages = buildJourneyStages(journey.input);
  const journeyRail = journeyStages.filter(stage => stage.id !== 'algorithm');
  return <section className="home-panel" aria-labelledby="home-title">
    <div className="intro"><h1 id="home-title">工作台</h1><p>简历 → 岗位与 JD 备题 → 模拟面试 → 复盘复习 → 算法训练，按你自己保存的记录标出下一步。</p></div>
    <OnboardingPanel interviews={journey.input.interviews} resumes={journey.input.resumes} navigate={navigate} />
    <nav className="journey-rail" aria-label="求职旅程">
      <ol>{journeyRail.map(stage => <li className={`journey-step ${stage.status}`} key={stage.id}><Button variant="ghost" label={stage.title} isDisabled={stage.status === 'loading'} onClick={() => navigate({ page: stage.page })} /><small>{stageLabel[stage.status]} · {stage.detail}</small></li>)}</ol>
      {journeyStages.some(stage => stage.status === 'unavailable') ? <Button size="sm" label="重试读取旅程状态" onClick={journey.retry} /> : null}
    </nav>
    <div className="workflow-steps"><article><small>01 / 简历管理</small><h2>把经历整理好</h2><p>导入文件或 JSON 整理简历副本；投递附件也在这个简历库里管理。</p><Button variant="primary" label="进入简历库" onClick={() => navigate({ page: 'resumeStudio' })} /></article><article><small>02 / 求职管理</small><h2>找到目标岗位</h2><p>搜索岗位、核对筛选依据，再批准站内沟通。</p><Button label="进入求职工作台" onClick={() => navigate({ page: 'career' })} /></article><article><small>03 / 面试中心</small><h2>有针对性地准备</h2><p>选择简历与 JD，备题、模拟面试并查看报告。</p><Button label="准备面试" onClick={() => navigate({ page: 'practice' })} /><Button variant="ghost" label="面试历史" onClick={() => navigate({ page: 'history' })} /></article></div>
    <div className="home-actions">
      <article><Badge variant="info" label="面试准备" /><h2>{active ? active.role : hasIntake ? '继续准备中的资料' : '准备下一场面试'}</h2><p>{active ? statusLabels[active.status] : '上传简历与 JD，先备题，再按计划作答。'}</p><Button variant="primary" label={active ? '继续这场面试' : hasIntake ? '继续准备' : '新建面试'} onClick={() => navigate({ page: 'practice', ...(active ? { sessionId: active.id } : {}) })} /><Button variant="ghost" label="只用 JD 先备题" onClick={() => navigate({ page: 'preparation' })} /></article>
      <article><Badge variant="purple" label="算法练习" /><h2>{lastQuestion ? `${lastQuestion.id}. ${lastQuestion.title}` : '从 Hot 100 开始'}</h2><p>{dueCount ? `${dueCount} 道题已到复习时间。` : 'Python 独立作答、提示与套路跟打。'}代码自动保存在本机。</p><Button variant="primary" label="继续算法练习" onClick={() => navigate({ page: 'algorithm', view: 'hot100', questionId: algorithm.selectedId })} /></article>
      <article><Badge variant="yellow" label="复盘与资料" /><h2>{reviews.length ? `${reviews.length} 项面试待复习` : '把反馈变成下一步'}</h2><p>{profiles.length ? `已保存 ${profiles.length} 份岗位资料档案。` : '面试报告可把具体 QA 加入复习清单。'}</p><Button label="查看复习清单" onClick={() => navigate({ page: 'review' })} /><Button variant="ghost" label="备份本机数据" onClick={() => openUtility('data')} /></article>
    </div>
    <JourneyMap data={journey} navigate={navigate} />
    {!modelReady ? <Banner role="alert" status="info" title="先体验规则演示，或配置自己的模型开始真实 AI 面试。" endContent={<Button label="配置模型" onClick={() => openUtility('model')} />} /> : null}
    <div className="section-heading"><h2>最近的面试</h2><Button label="新建练习" onClick={() => navigate({ page: 'practice' })} /></div>
    {history.length ? <div className="recent-grid">{history.slice(0, 4).map(item => <Button className="recent-card" key={item.id} label={`${item.role} · ${statusLabels[item.status]}`} onClick={() => navigate({ page: 'practice', sessionId: item.id })}><strong>{item.role}</strong><span>{statusLabels[item.status]} · {item.turnCount}/{item.questionCount} 题</span><small>{new Date(item.createdAt).toLocaleDateString('zh-CN')}{item.overallScore !== null ? ` · ${item.overallScore} 分${item.modelMode === 'demo' ? '（演示）' : ''}` : ''}</small></Button>)}</div> : <EmptyState isCompact title="还没有面试记录" description="完成第一场练习后，这里可以继续或复盘。" />}
  </section>;
}

export function ReviewPanel({ navigate }: { navigate: (route: Route) => void }) {
  const cache = useQueryClient();
  const [items, setItems] = useState(readReviews);
  const [showCompleted, setShowCompleted] = useState(false);
  const filtered = items.filter(item => showCompleted ? Boolean(item.completedAt) : !item.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  function update(next: typeof items, affectsCount = false) { saveReviews(next); setItems(next); if (affectsCount) void cache.invalidateQueries({ queryKey: ['local-reviews'] }); }
  return <section className="review-panel" aria-labelledby="review-title"><div className="panel-heading"><div><h1 id="review-title">面试复习清单</h1><p>问题和原文依据来自你的面试，复习状态由你确认。</p></div><Button label={showCompleted ? '查看待复习' : '查看已复习'} onClick={() => setShowCompleted(value => !value)} /></div>
    {filtered.length ? filtered.map(item => <article className="review-card" key={item.id}><div className="section-heading"><h2>{item.title}</h2><Badge variant={new Date(item.dueAt).getTime() <= Date.now() ? 'orange' : 'neutral'} label={item.completedAt ? '已复习' : new Date(item.dueAt).getTime() <= Date.now() ? '到期复习' : `${new Date(item.dueAt).toLocaleDateString('zh-CN')} 复习`} /></div><p>{item.questionText}</p><details><summary>查看原作答依据</summary><blockquote>{item.evidence}</blockquote></details><TextArea id={`review-note-${item.id}`} label="复习笔记" maxLength={3000} rows={3} value={item.notes} onChange={value => update(items.map(record => record.id === item.id ? { ...record, notes: value } : record))} />
      <div className="panel-actions"><Button label="回看原始 QA" onClick={() => navigate({ page: 'practice', sessionId: item.interviewId })} /><Button variant="primary" label={item.completedAt ? '重新加入待复习' : '标记已复习'} onClick={() => update(items.map(record => record.id === item.id ? { ...record, completedAt: item.completedAt ? null : new Date().toISOString() } : record), true)} /><ConfirmAction title="移除这条复习记录？" description="原面试记录保留。" okText="移除" cancelText="保留" onConfirm={() => update(items.filter(record => record.id !== item.id), true)}><Button variant="destructive" label="移除" /></ConfirmAction></div>
    </article>) : <EmptyState isCompact title={showCompleted ? '还没有已复习的记录' : '没有待复习项目'} description={showCompleted ? '标记已复习的面试问题会显示在这里。' : '在面试报告中把具体 QA 加入清单。'} />}
  </section>;
}
