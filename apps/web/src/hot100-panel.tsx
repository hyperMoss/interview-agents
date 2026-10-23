import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Progress, Segmented, Select, Tag } from 'antd';
import { hot100StatusSchema } from '../../../packages/contracts/src/hot100';
import { algorithmPatterns, getAlgorithmPattern } from '../../../packages/interview/src/algorithm-patterns';
import { exportHot100Bank, findHot100Question, hot100Groups, hot100Metadata, hot100Questions, hot100StatusLabels, type Hot100Question } from '../../../packages/interview/src/hot100';
import { completeHot100Review, filterHot100Practice, getHot100PracticeEntry, hot100PracticeFilterSchema, hot100TopicProgress, isHot100ReviewDue, markHot100NeedsReview, nextHot100PracticeQuestion, type Hot100PracticeEntry } from '../../../packages/interview/src/hot100-review';
import { hot100DraftKey, restoreHot100Draft, updateHot100Entry } from './hot100-draft';
import { CodeEditor } from './code-editor';
import { writeSession } from './storage';
import './hot100.css';

const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' };
type RoutineHandoff = (question: Hot100Question, patternId: string) => void;

export function Hot100Panel({ onUseRoutine, questionId, onSelectQuestion }: { onUseRoutine: RoutineHandoff; questionId?: number; onSelectQuestion?: (questionId: number) => void }) {
  const [restored] = useState(restoreHot100Draft);
  const [draft, setDraft] = useState(() => questionId && findHot100Question(questionId) ? { ...restored.draft, selectedId: questionId } : restored.draft);
  const [warning, setWarning] = useState(restored.warning);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  const workspace = useRef<HTMLElement>(null);
  const filtered = filterHot100Practice(draft.filters, draft.entries, now);
  const selected = findHot100Question(draft.selectedId) ?? hot100Questions[0];
  const reviewed = draft.entries.filter(entry => entry.status === 'reviewed').length;
  const doing = draft.entries.filter(entry => entry.status === 'doing').length;
  const due = draft.entries.filter(entry => isHot100ReviewDue(entry, now)).length;
  const topics = hot100TopicProgress(draft.entries, now);

  useEffect(() => {
    if (!writeSession(hot100DraftKey, JSON.stringify(draft))) setWarning('浏览器无法保存 Hot 100 草稿，请及时导出作答；刷新可能丢失本次修改。');
  }, [draft]);
  useEffect(() => {
    if (questionId && findHot100Question(questionId)) setDraft(current => ({ ...current, selectedId: questionId }));
  }, [questionId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  function choose(question: Hot100Question) {
    setDraft(current => {
      const entry = getHot100PracticeEntry(current.entries, question.id);
      return updateHot100Entry({ ...current, selectedId: question.id }, { ...entry, status: entry.status === 'todo' ? 'doing' : entry.status });
    });
    onSelectQuestion?.(question.id);
    setNotice('');
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => workspace.current?.scrollIntoView({ block: 'start' }));
  }
  function next() {
    const question = nextHot100PracticeQuestion(filtered, draft.entries, draft.selectedId, new Date());
    if (question) choose(question);
    else setNotice('当前筛选下暂无其他到期复习或待练习题，可调整专题与练习状态。');
  }
  function downloadBank() {
    const payload = exportHot100Bank(filtered);
    downloadJson(payload, 'leetcode-hot100-bank.json');
    setNotice(`已导出 ${payload.questions.length} 道学习摘要，可在题库管理中导入。`);
  }

  return <section className="hot100-panel" aria-labelledby="hot100-title">
    <div className="hot100-heading"><div><span className="algorithm-eyebrow">LEETCODE HOT 100</span><h2 id="hot100-title">一题一练，把套路用起来。</h2><p>官方题单 · {hot100Groups.length} 个专题 · Python 独立作答与复习</p></div><a href={hot100Metadata.source.url} target="_blank" rel="noreferrer">查看官方题单 ↗</a></div>
    <div className="hot100-stats"><div><strong>100</strong><span>道题</span></div><div><strong>{doing}</strong><span>练习中</span></div><div><strong>{reviewed}</strong><span>已复习 · 自评</span></div><div><strong>{due}</strong><span>到期复习</span></div><Progress aria-label="Hot 100 自评复习进度" percent={reviewed} showInfo={false} /></div>
    <p className="algorithm-caption">官方元数据快照 {hot100Metadata.source.capturedAt}。摘要与提示由本项目编写；完整条件、示例和提交判题请查看原题。{algorithmPatterns.length} 套现有模式可用于关联题的跟打。</p>
    {warning ? <Alert type="warning" showIcon message={warning} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <details className="hot100-topic-progress"><summary>专题进度 · 已复习均为用户自评</summary><div>{topics.map(topic => <button key={topic.group} onClick={() => setDraft(current => ({ ...current, filters: { ...current.filters, group: topic.group } }))}><span><strong>{topic.group}</strong><small>{topic.reviewed} / {topic.total}{topic.due ? ` · 到期 ${topic.due}` : ''}</small></span><Progress aria-label={`${topic.group}自评复习进度`} percent={topic.percent} showInfo={false} /></button>)}</div></details>
    <div className="hot100-layout">
      <section className="hot100-catalog" aria-label="Hot 100 题单筛选">
        <label htmlFor="hot100-search">搜索题号、标题或关键词</label><Input id="hot100-search" placeholder="例如 1、子串、binary-search" value={draft.filters.query} maxLength={200} allowClear onChange={event => setDraft(current => ({ ...current, filters: { ...current.filters, query: event.target.value } }))} />
        <div className="hot100-filters"><Select aria-label="Hot 100 专题" value={draft.filters.group} options={[{ value: 'all', label: '全部专题' }, ...hot100Groups.map(group => ({ value: group, label: group }))]} onChange={group => setDraft(current => ({ ...current, filters: { ...current.filters, group } }))} />
          <Select aria-label="Hot 100 难度" value={draft.filters.difficulty} options={[{ value: 'all', label: '全部难度' }, ...Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, difficulty: hot100PracticeFilterSchema.shape.difficulty.parse(value) } }))} />
          <Select aria-label="Hot 100 练习状态" value={draft.filters.status} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(hot100StatusLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, status: hot100PracticeFilterSchema.shape.status.parse(value) } }))} />
        </div>
        <div className="hot100-review-filters"><Checkbox checked={Boolean(draft.filters.favoritesOnly)} onChange={event => setDraft(current => ({ ...current, filters: { ...current.filters, favoritesOnly: event.target.checked } }))}>只看收藏</Checkbox><Checkbox checked={Boolean(draft.filters.reviewOnly)} onChange={event => setDraft(current => ({ ...current, filters: { ...current.filters, reviewOnly: event.target.checked } }))}>只看待复习</Checkbox></div>
        <div className="hot100-list-heading"><strong>当前 {filtered.length} / 100 题</strong><Button type="link" onClick={() => setDraft(current => ({ ...current, filters: hot100PracticeFilterSchema.parse({}) }))}>清除筛选</Button></div>
        <div className="hot100-question-list" role="list" aria-label="Hot 100 题目列表" tabIndex={0}>{filtered.length ? filtered.map(question => {
          const entry = getHot100PracticeEntry(draft.entries, question.id);
          return <div role="listitem" key={question.id}><button className={`hot100-question ${draft.selectedId === question.id ? 'selected' : ''}`} aria-label={`练习 ${question.id} ${question.title}`} aria-pressed={draft.selectedId === question.id} onClick={() => choose(question)}><span><strong><i>{question.id}</i>{question.title}</strong><em className={`difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</em></span><span><small>{question.group}</small><small>{entry.favorite ? '★ 收藏 · ' : ''}{isHot100ReviewDue(entry, now) ? '到期复习' : entry.needsReview ? '待复习' : hot100StatusLabels[entry.status]}</small></span></button></div>;
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合筛选条件的题目" />}</div>
        <Button onClick={downloadBank} disabled={!filtered.length}>导出当前题单到题库 JSON</Button>
      </section>
      <section className="hot100-workspace" ref={workspace} aria-label="Hot 100 独立作答">
        {selected && !filtered.some(question => question.id === selected.id) ? <Alert type="info" showIcon message="当前题目不在筛选结果中。可继续作答，或从左侧选择符合条件的题目。" /> : null}
        {selected ? <Hot100Workspace key={selected.id} question={selected} entry={getHot100PracticeEntry(draft.entries, selected.id)} onChange={entry => { setDraft(current => updateHot100Entry(current, entry)); setNotice(''); }} onUseRoutine={onUseRoutine} onNext={next} now={now} /> : null}
      </section>
    </div>
  </section>;
}

function Hot100Workspace({ question, entry, onChange, onUseRoutine, onNext, now }: { question: Hot100Question; entry: Hot100PracticeEntry; onChange: (entry: Hot100PracticeEntry) => void; onUseRoutine: RoutineHandoff; onNext: () => void; now: Date }) {
  const [showHint, setShowHint] = useState(false);
  function edit(patch: Partial<Pick<Hot100PracticeEntry, 'code' | 'notes'>>) {
    onChange({ ...entry, ...patch, status: entry.status === 'todo' ? 'doing' : entry.status });
  }
  return <article className="hot100-practice-card">
    <div className="hot100-card-title"><div><Tag>{question.group}</Tag><Tag className={`difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</Tag><h3>{question.id}. {question.title}</h3></div><a href={question.url} target="_blank" rel="noreferrer">打开完整原题 ↗</a></div>
    <div className="hot100-favorite"><Button aria-pressed={Boolean(entry.favorite)} onClick={() => onChange({ ...entry, favorite: !entry.favorite })}>{entry.favorite ? '★ 已收藏' : '☆ 收藏本题'}</Button><span>收藏与复习安排仅用于你的练习记录。</span></div>
    <div className="hot100-goal"><strong>本题练习目标 · 原创学习摘要</strong><p>{question.goal}</p></div>
    <div className="hot100-routines"><span>相关套路</span>{question.patternIds.length ? question.patternIds.map(id => <Button key={id} onClick={() => onUseRoutine(question, id)}>练 {getAlgorithmPattern(id).title}</Button>) : <span className="algorithm-caption">当前还没有对应的跟打模板，可先独立作答并查看提示。</span>}</div>
    <div className="hot100-hint"><Button aria-expanded={showHint} onClick={() => setShowHint(current => !current)}>{showHint ? '收起本题提示' : '需要一点提示'}</Button>{showHint ? <p role="note">{question.hint}</p> : <span>先想输入、输出和边界，再决定用哪种方法。</span>}</div>
    <label htmlFor="hot100-notes">你的解题思路</label><Input.TextArea id="hot100-notes" value={entry.notes} rows={3} maxLength={3000} placeholder="为什么选这个方法？维护什么状态？时间与空间复杂度是多少？" onChange={event => edit({ notes: event.target.value })} />
    <label htmlFor="hot100-code">Python 独立作答</label><CodeEditor id="hot100-code" label="Python 独立作答" mode="python" value={entry.code} maxLength={12000} onChange={code => edit({ code })} placeholder="# 核对原题函数签名后，在这里编写你的 Python 解法。" />
    <p className="algorithm-caption">按题号自动保存在本机浏览器。支持缩进、撤销和搜索；本页不运行代码。“已复习”是你的自评，不代表通过判题。</p>
    <div className="hot100-review"><span>本题状态 · 用户自评</span><Segmented aria-label="本题复习状态" value={entry.status} options={Object.entries(hot100StatusLabels).map(([value, label]) => ({ value, label }))} onChange={value => {
      const status = hot100StatusSchema.parse(value);
      onChange(status === 'reviewed' ? completeHot100Review(entry, new Date()) : { ...entry, status, needsReview: false, nextReviewAt: null });
    }} /></div>
    <div className="hot100-review-plan"><div><strong>{isHot100ReviewDue(entry, now) ? '该复习这道题了' : entry.needsReview ? '已加入待复习' : '练完后安排下一次复习'}</strong><p>{entry.nextReviewAt ? `下次复习：${new Date(entry.nextReviewAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '完成自评复习后，按 1、3、7、14 天逐次安排。'}{entry.reviewCount ? ` · 已完成 ${entry.reviewCount} 次自评复习` : ''}</p></div><div><Button aria-pressed={Boolean(entry.needsReview)} onClick={() => onChange(entry.needsReview ? { ...entry, needsReview: false, nextReviewAt: null } : markHot100NeedsReview(entry, new Date()))}>{entry.needsReview ? '取消待复习' : '需要再练 · 明天复习'}</Button><Button onClick={() => onChange(completeHot100Review(entry, new Date()))}>完成本次复习（自评）</Button></div></div>
    <div className="hot100-actions"><Button type="primary" onClick={onNext}>下一道待练习</Button><Button onClick={() => downloadJson({ source: hot100Metadata.source.url, question: { id: question.id, title: question.title, url: question.url }, practice: entry }, `hot100-${question.id}-practice.json`)}>导出本题作答</Button></div>
  </article>;
}

function downloadJson(payload: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
