import { useState } from 'react';
import { Alert, Button, Empty, Input, Popconfirm, Tag } from 'antd';
import type { InterviewHistoryPage } from '../../../packages/contracts/src/history';
import type { Route } from './navigation';
import { statusLabels } from './navigation';
import { readSession } from './storage';
import { readProfiles, readReviews, saveReviews } from './personal-data';
import { restoreHot100Draft } from './hot100-draft';
import { findHot100Question } from '../../../packages/interview/src/hot100';
import { isHot100ReviewDue } from '../../../packages/interview/src/hot100-review';

type HistoryItems = InterviewHistoryPage['items'];
export function HomePanel({ history, navigate, openUtility, modelReady }: { history: HistoryItems; navigate: (route: Route) => void; openUtility: (page: 'model' | 'data') => void; modelReady: boolean }) {
  const reviews = readReviews().filter(item => !item.completedAt);
  const algorithm = restoreHot100Draft().draft;
  const dueCount = algorithm.entries.filter(entry => isHot100ReviewDue(entry, new Date())).length;
  const active = history.find(item => !['completed', 'cancelled'].includes(item.status));
  const lastQuestion = findHot100Question(algorithm.selectedId);
  const profiles = readProfiles();
  const hasIntake = Boolean(readSession('interview-intake'));
  return <section className="home-panel" aria-labelledby="home-title">
    <div className="intro"><h1 id="home-title">今天，继续练好一道题。</h1><p>从上次停下的地方继续，或为新的目标岗位准备一场面试。</p></div>
    <div className="home-actions">
      <article><Tag color="blue">面试准备</Tag><h2>{active ? active.role : hasIntake ? '继续准备中的资料' : '准备下一场面试'}</h2><p>{active ? statusLabels[active.status] : '上传简历与 JD，先备题，再按计划作答。'}</p><Button type="primary" onClick={() => navigate({ page: 'practice', ...(active ? { sessionId: active.id } : {}) })}>{active ? '继续这场面试' : hasIntake ? '继续准备' : '新建面试'}</Button><Button type="link" onClick={() => navigate({ page: 'preparation' })}>只用 JD 先备题</Button></article>
      <article><Tag color="purple">算法练习</Tag><h2>{lastQuestion ? `${lastQuestion.id}. ${lastQuestion.title}` : '从 Hot 100 开始'}</h2><p>{dueCount ? `${dueCount} 道题已到复习时间。` : 'Python 独立作答、提示与套路跟打。'}代码自动保存在本机。</p><Button type="primary" onClick={() => navigate({ page: 'algorithm', view: 'hot100', questionId: algorithm.selectedId })}>继续算法练习</Button></article>
      <article><Tag color="gold">复盘与资料</Tag><h2>{reviews.length ? `${reviews.length} 项面试待复习` : '把反馈变成下一步'}</h2><p>{profiles.length ? `已保存 ${profiles.length} 份岗位资料档案。` : '面试报告可把具体 QA 加入复习清单。'}</p><Button onClick={() => navigate({ page: 'review' })}>查看复习清单</Button><Button type="link" onClick={() => openUtility('data')}>备份本机数据</Button></article>
    </div>
    {!modelReady ? <Alert type="info" showIcon message="先体验规则演示，或配置自己的模型开始真实 AI 面试。" action={<Button onClick={() => openUtility('model')}>配置模型</Button>} /> : null}
    <div className="section-heading"><h2>最近的面试</h2><Button onClick={() => navigate({ page: 'practice' })}>新建练习</Button></div>
    {history.length ? <div className="recent-grid">{history.slice(0, 4).map(item => <Button className="recent-card" key={item.id} onClick={() => navigate({ page: 'practice', sessionId: item.id })}><strong>{item.role}</strong><span>{statusLabels[item.status]} · {item.turnCount}/{item.questionCount} 题</span><small>{new Date(item.createdAt).toLocaleDateString('zh-CN')}{item.overallScore !== null ? ` · ${item.overallScore} 分${item.modelMode === 'demo' ? '（演示）' : ''}` : ''}</small></Button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成第一场练习后，这里可以继续或复盘。" />}
  </section>;
}

export function ReviewPanel({ navigate }: { navigate: (route: Route) => void }) {
  const [items, setItems] = useState(readReviews);
  const [showCompleted, setShowCompleted] = useState(false);
  const filtered = items.filter(item => showCompleted ? Boolean(item.completedAt) : !item.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  function update(next: typeof items) { saveReviews(next); setItems(next); }
  return <section className="review-panel" aria-labelledby="review-title"><div className="panel-heading"><div><h1 id="review-title">面试复习清单</h1><p>问题和原文依据来自你的面试，复习状态由你确认。</p></div><Button onClick={() => setShowCompleted(value => !value)}>{showCompleted ? '查看待复习' : '查看已复习'}</Button></div>
    {filtered.length ? filtered.map(item => <article className="review-card" key={item.id}><div className="section-heading"><h2>{item.title}</h2><Tag color={new Date(item.dueAt).getTime() <= Date.now() ? 'orange' : 'default'}>{item.completedAt ? '已复习' : new Date(item.dueAt).getTime() <= Date.now() ? '到期复习' : `${new Date(item.dueAt).toLocaleDateString('zh-CN')} 复习`}</Tag></div><p>{item.questionText}</p><details><summary>查看原作答依据</summary><blockquote>{item.evidence}</blockquote></details><label htmlFor={`review-note-${item.id}`}>复习笔记</label><Input.TextArea id={`review-note-${item.id}`} maxLength={3000} rows={3} value={item.notes} onChange={event => update(items.map(record => record.id === item.id ? { ...record, notes: event.target.value } : record))} />
      <div className="panel-actions"><Button onClick={() => navigate({ page: 'practice', sessionId: item.interviewId })}>回看原始 QA</Button><Button type="primary" onClick={() => update(items.map(record => record.id === item.id ? { ...record, completedAt: item.completedAt ? null : new Date().toISOString() } : record))}>{item.completedAt ? '重新加入待复习' : '标记已复习'}</Button><Popconfirm title="移除这条复习记录？" description="原面试记录保留。" okText="移除" cancelText="保留" onConfirm={() => update(items.filter(record => record.id !== item.id))}><Button danger type="text">移除</Button></Popconfirm></div>
    </article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={showCompleted ? '还没有已复习的记录。' : '没有待复习项目。在面试报告中把具体 QA 加入清单。'} />}
  </section>;
}
