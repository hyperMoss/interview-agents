import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Progress, Segmented, Select, Tag } from 'antd';
import { hot100StatusSchema } from '../../../packages/contracts/src/hot100';
import { algorithmPatterns, getAlgorithmPattern } from '../../../packages/interview/src/algorithm-patterns';
import { exportHot100Bank, filterHot100, findHot100Question, getHot100Entry, hot100FilterSchema, hot100Groups, hot100Metadata, hot100Questions, hot100StatusLabels, nextHot100Question, type Hot100Entry, type Hot100Question } from '../../../packages/interview/src/hot100';
import { hot100DraftKey, restoreHot100Draft, updateHot100Entry } from './hot100-draft';
import { writeSession } from './storage';
import './hot100.css';

const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' };
type RoutineHandoff = (question: Hot100Question, patternId: string) => void;

export function Hot100Panel({ onUseRoutine }: { onUseRoutine: RoutineHandoff }) {
  const [restored] = useState(restoreHot100Draft);
  const [draft, setDraft] = useState(restored.draft);
  const [warning, setWarning] = useState(restored.warning);
  const [notice, setNotice] = useState('');
  const workspace = useRef<HTMLElement>(null);
  const filtered = filterHot100(draft.filters, draft.entries);
  const selected = findHot100Question(draft.selectedId) ?? hot100Questions[0];
  const reviewed = draft.entries.filter(entry => entry.status === 'reviewed').length;
  const doing = draft.entries.filter(entry => entry.status === 'doing').length;

  useEffect(() => {
    if (!writeSession(hot100DraftKey, JSON.stringify(draft))) setWarning('浏览器无法保存 Hot 100 草稿，请及时导出作答；刷新可能丢失本次修改。');
  }, [draft]);

  function choose(question: Hot100Question) {
    setDraft(current => {
      const entry = getHot100Entry(current.entries, question.id);
      return updateHot100Entry({ ...current, selectedId: question.id }, { ...entry, status: entry.status === 'todo' ? 'doing' : entry.status });
    });
    setNotice('');
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => workspace.current?.scrollIntoView({ block: 'start' }));
  }
  function next() {
    const question = nextHot100Question(filtered, draft.entries, draft.selectedId);
    if (question) choose(question);
    else setNotice('当前筛选下暂无其他待练习题，可调整专题或复习状态。');
  }
  function downloadBank() {
    const payload = exportHot100Bank(filtered);
    downloadJson(payload, 'leetcode-hot100-bank.json');
    setNotice(`已导出 ${payload.questions.length} 道学习摘要，可在题库管理中导入。`);
  }

  return <section className="hot100-panel" aria-labelledby="hot100-title">
    <div className="hot100-heading"><div><span className="algorithm-eyebrow">LEETCODE HOT 100</span><h2 id="hot100-title">一题一练，把套路用起来。</h2><p>官方题单 · {hot100Groups.length} 个专题 · Python 独立作答与复习</p></div><a href={hot100Metadata.source.url} target="_blank" rel="noreferrer">查看官方题单 ↗</a></div>
    <div className="hot100-stats"><div><strong>100</strong><span>道题</span></div><div><strong>{doing}</strong><span>练习中</span></div><div><strong>{reviewed}</strong><span>已复习 · 自评</span></div><Progress percent={reviewed} showInfo={false} /></div>
    <p className="algorithm-caption">官方元数据快照 {hot100Metadata.source.capturedAt}。摘要与提示由本项目编写；完整条件、示例和提交判题请查看原题。{algorithmPatterns.length} 套现有模式可用于关联题的跟打。</p>
    {warning ? <Alert type="warning" showIcon message={warning} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="hot100-layout">
      <section className="hot100-catalog" aria-label="Hot 100 题单筛选">
        <label htmlFor="hot100-search">搜索题号、标题或关键词</label><Input id="hot100-search" placeholder="例如 1、子串、binary-search" value={draft.filters.query} maxLength={200} allowClear onChange={event => setDraft(current => ({ ...current, filters: { ...current.filters, query: event.target.value } }))} />
        <div className="hot100-filters"><Select aria-label="Hot 100 专题" value={draft.filters.group} options={[{ value: 'all', label: '全部专题' }, ...hot100Groups.map(group => ({ value: group, label: group }))]} onChange={group => setDraft(current => ({ ...current, filters: { ...current.filters, group } }))} />
          <Select aria-label="Hot 100 难度" value={draft.filters.difficulty} options={[{ value: 'all', label: '全部难度' }, ...Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, difficulty: hot100FilterSchema.shape.difficulty.parse(value) } }))} />
          <Select aria-label="Hot 100 练习状态" value={draft.filters.status} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(hot100StatusLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, status: hot100FilterSchema.shape.status.parse(value) } }))} />
        </div>
        <div className="hot100-list-heading"><strong>当前 {filtered.length} / 100 题</strong><Button type="link" onClick={() => setDraft(current => ({ ...current, filters: hot100FilterSchema.parse({}) }))}>清除筛选</Button></div>
        <div className="hot100-question-list" role="list" aria-label="Hot 100 题目列表" tabIndex={0}>{filtered.length ? filtered.map(question => <div role="listitem" key={question.id}><button className={`hot100-question ${draft.selectedId === question.id ? 'selected' : ''}`} aria-label={`练习 ${question.id} ${question.title}`} aria-pressed={draft.selectedId === question.id} onClick={() => choose(question)}><span><strong><i>{question.id}</i>{question.title}</strong><em className={`difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</em></span><span><small>{question.group}</small><small>{hot100StatusLabels[getHot100Entry(draft.entries, question.id).status]}</small></span></button></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合筛选条件的题目" />}</div>
        <Button onClick={downloadBank} disabled={!filtered.length}>导出当前题单到题库 JSON</Button>
      </section>
      <section className="hot100-workspace" ref={workspace} aria-label="Hot 100 独立作答">
        {selected ? <Hot100Workspace key={selected.id} question={selected} entry={getHot100Entry(draft.entries, selected.id)} onChange={entry => { setDraft(current => updateHot100Entry(current, entry)); setNotice(''); }} onUseRoutine={onUseRoutine} onNext={next} /> : null}
      </section>
    </div>
  </section>;
}

function Hot100Workspace({ question, entry, onChange, onUseRoutine, onNext }: { question: Hot100Question; entry: Hot100Entry; onChange: (entry: Hot100Entry) => void; onUseRoutine: RoutineHandoff; onNext: () => void }) {
  const [showHint, setShowHint] = useState(false);
  function edit(patch: Partial<Pick<Hot100Entry, 'code' | 'notes'>>) {
    onChange({ ...entry, ...patch, status: entry.status === 'todo' ? 'doing' : entry.status });
  }
  return <article className="hot100-practice-card">
    <div className="hot100-card-title"><div><Tag>{question.group}</Tag><Tag className={`difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</Tag><h3>{question.id}. {question.title}</h3></div><a href={question.url} target="_blank" rel="noreferrer">打开完整原题 ↗</a></div>
    <div className="hot100-goal"><strong>本题练习目标 · 原创学习摘要</strong><p>{question.goal}</p></div>
    <div className="hot100-routines"><span>相关套路</span>{question.patternIds.length ? question.patternIds.map(id => <Button key={id} onClick={() => onUseRoutine(question, id)}>练 {getAlgorithmPattern(id).title}</Button>) : <span className="algorithm-caption">当前还没有对应的跟打模板，可先独立作答并查看提示。</span>}</div>
    <div className="hot100-hint"><Button aria-expanded={showHint} onClick={() => setShowHint(current => !current)}>{showHint ? '收起本题提示' : '需要一点提示'}</Button>{showHint ? <p role="note">{question.hint}</p> : <span>先想输入、输出和边界，再决定用哪种方法。</span>}</div>
    <label htmlFor="hot100-notes">你的解题思路</label><Input.TextArea id="hot100-notes" value={entry.notes} rows={3} maxLength={3000} placeholder="为什么选这个方法？维护什么状态？时间与空间复杂度是多少？" onChange={event => edit({ notes: event.target.value })} />
    <label htmlFor="hot100-code">Python 独立作答</label><textarea id="hot100-code" className="hot100-code" value={entry.code} rows={15} maxLength={12000} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="# 核对原题函数签名后，在这里编写你的 Python 解法。" onChange={event => edit({ code: event.target.value })} onKeyDown={event => {
      if (event.key !== 'Tab' || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      const element = event.currentTarget;
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const code = `${entry.code.slice(0, start)}    ${entry.code.slice(end)}`;
      if (code.length > 12000) return;
      edit({ code });
      requestAnimationFrame(() => element.setSelectionRange(start + 4, start + 4));
    }} />
    <p className="algorithm-caption">按题号保存当前标签页草稿。Tab 输入四个空格，Shift + Tab 移出输入框。本页不运行代码；“已复习”是你的自评，不代表通过判题。</p>
    <div className="hot100-review"><span>本题状态</span><Segmented aria-label="本题复习状态" value={entry.status} options={Object.entries(hot100StatusLabels).map(([value, label]) => ({ value, label }))} onChange={value => onChange({ ...entry, status: hot100StatusSchema.parse(value) })} /></div>
    <div className="hot100-actions"><Button type="primary" onClick={onNext}>下一道待练习</Button><Button onClick={() => downloadJson({ source: hot100Metadata.source.url, question: { id: question.id, title: question.title, url: question.url }, practice: entry }, `hot100-${question.id}-practice.json`)}>导出本题作答</Button></div>
  </article>;
}

function downloadJson(payload: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
