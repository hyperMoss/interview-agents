import { useEffect, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { hot100StatusSchema } from '../../../packages/contracts/src/hot100';
import { getAlgorithmPattern } from '../../../packages/interview/src/algorithm-patterns';
import { exportHot100Bank, findHot100Question, hot100Groups, hot100Metadata, hot100Questions, hot100StatusLabels, type Hot100Question } from '../../../packages/interview/src/hot100';
import { completeHot100Review, filterHot100Practice, getHot100PracticeEntry, hot100PracticeFilterSchema, hot100TopicProgress, isHot100ReviewDue, markHot100NeedsReview, nextHot100PracticeQuestion, type Hot100PracticeEntry } from '../../../packages/interview/src/hot100-review';
import { hot100DraftKey, restoreHot100Draft, updateHot100Entry } from './hot100-draft';
import { CodeEditor } from './code-editor';
import { writeSession } from './storage';
import { validateHot100, type ValidationResult } from './hot100-validation';
import './hot100.css';

const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' };
type RoutineHandoff = (question: Hot100Question, patternId?: string) => void;

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
    <div className="hot100-stats"><div><strong>100</strong><span>道题</span></div><div><strong>{doing}</strong><span>练习中</span></div><div><strong>{reviewed}</strong><span>已复习 · 自评</span></div><div><strong>{due}</strong><span>到期复习</span></div><ProgressBar label="Hot 100 自评复习进度" isLabelHidden value={reviewed} /></div>
    <p className="algorithm-caption">官方元数据快照 {hot100Metadata.source.capturedAt}。摘要与提示由本项目编写；完整条件、示例和提交判题请查看原题。全部 100 题均可跟打本题 Python 参考解法，也可选择关联的通用套路。</p>
    {warning ? <Banner role="alert" status="warning" title={warning} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <details className="hot100-topic-progress"><summary>专题进度 · 已复习均为用户自评</summary><div>{topics.map(topic => <button key={topic.group} onClick={() => setDraft(current => ({ ...current, filters: { ...current.filters, group: topic.group } }))}><span><strong>{topic.group}</strong><small>{topic.reviewed} / {topic.total}{topic.due ? ` · 到期 ${topic.due}` : ''}</small></span><ProgressBar label={`${topic.group}自评复习进度`} isLabelHidden value={topic.percent} /></button>)}</div></details>
    <div className="hot100-layout">
      <section className="hot100-catalog" aria-label="Hot 100 题单筛选">
        <TextInput id="hot100-search" label="搜索题号、标题或关键词" placeholder="例如 1、子串、binary-search" value={draft.filters.query} hasClear onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, query: value.slice(0, 200) } }))} />
        <div className="hot100-filters"><Selector label="Hot 100 专题" isLabelHidden value={draft.filters.group} options={[{ value: 'all', label: '全部专题' }, ...hot100Groups.map(group => ({ value: group, label: group }))]} onChange={group => setDraft(current => ({ ...current, filters: { ...current.filters, group } }))} />
          <Selector label="Hot 100 难度" isLabelHidden value={draft.filters.difficulty} options={[{ value: 'all', label: '全部难度' }, ...Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, difficulty: hot100PracticeFilterSchema.shape.difficulty.parse(value) } }))} />
          <Selector label="Hot 100 练习状态" isLabelHidden value={draft.filters.status} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(hot100StatusLabels).map(([value, label]) => ({ value, label }))]} onChange={value => setDraft(current => ({ ...current, filters: { ...current.filters, status: hot100PracticeFilterSchema.shape.status.parse(value) } }))} />
        </div>
        <div className="hot100-review-filters"><CheckboxInput label="只看收藏" value={Boolean(draft.filters.favoritesOnly)} onChange={checked => setDraft(current => ({ ...current, filters: { ...current.filters, favoritesOnly: checked } }))} /><CheckboxInput label="只看待复习" value={Boolean(draft.filters.reviewOnly)} onChange={checked => setDraft(current => ({ ...current, filters: { ...current.filters, reviewOnly: checked } }))} /></div>
        <div className="hot100-list-heading"><strong>当前 {filtered.length} / 100 题</strong><Button variant="ghost" label="清除筛选" onClick={() => setDraft(current => ({ ...current, filters: hot100PracticeFilterSchema.parse({}) }))} /></div>
        <div className="hot100-question-list" role="list" aria-label="Hot 100 题目列表" tabIndex={0}>{filtered.length ? filtered.map(question => {
          const entry = getHot100PracticeEntry(draft.entries, question.id);
          return <div role="listitem" key={question.id}><button className={`hot100-question ${draft.selectedId === question.id ? 'selected' : ''}`} aria-label={`练习 ${question.id} ${question.title}`} aria-pressed={draft.selectedId === question.id} onClick={() => choose(question)}><span><strong><i>{question.id}</i>{question.title}</strong><em className={`difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</em></span><span><small>{question.group}</small><small>{entry.favorite ? '★ 收藏 · ' : ''}{isHot100ReviewDue(entry, now) ? '到期复习' : entry.needsReview ? '待复习' : hot100StatusLabels[entry.status]}</small></span></button></div>;
        }) : <EmptyState title="没有符合筛选条件的题目" />}</div>
        <Button label="导出当前题单到题库 JSON" onClick={downloadBank} isDisabled={!filtered.length} />
      </section>
      <section className="hot100-workspace" ref={workspace} aria-label="Hot 100 独立作答">
        {selected && !filtered.some(question => question.id === selected.id) ? <Banner role="alert" status="info" title="当前题目不在筛选结果中。可继续作答，或从左侧选择符合条件的题目。" /> : null}
        {selected ? <Hot100Workspace key={selected.id} question={selected} entry={getHot100PracticeEntry(draft.entries, selected.id)} onChange={entry => { setDraft(current => updateHot100Entry(current, entry)); setNotice(''); }} onUseRoutine={onUseRoutine} onNext={next} now={now} /> : null}
      </section>
    </div>
  </section>;
}

function Hot100Workspace({ question, entry, onChange, onUseRoutine, onNext, now }: { question: Hot100Question; entry: Hot100PracticeEntry; onChange: (entry: Hot100PracticeEntry) => void; onUseRoutine: RoutineHandoff; onNext: () => void; now: Date }) {
  const [showHint, setShowHint] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [phase, setPhase] = useState<'loading' | 'running' | null>(null);
  const activeRun = useRef<ReturnType<typeof validateHot100> | null>(null);
  useEffect(() => {
    activeRun.current?.cancel();
    activeRun.current = null;
    setPhase(null);
    setValidation(null);
    return () => { activeRun.current?.cancel(); activeRun.current = null; };
  }, [entry.code]);
  async function runValidation() {
    activeRun.current?.cancel();
    setValidation(null);
    const run = validateHot100(question.id, entry.code, setPhase);
    activeRun.current = run;
    const result = await run.result;
    if (activeRun.current !== run) return;
    activeRun.current = null;
    setPhase(null);
    setValidation(result);
  }
  function edit(patch: Partial<Pick<Hot100PracticeEntry, 'code' | 'notes'>>) {
    onChange({ ...entry, ...patch, status: entry.status === 'todo' ? 'doing' : entry.status });
  }
  return <article className="hot100-practice-card">
    <div className="hot100-card-title"><div><Badge label={question.group} /><Badge className={`difficulty-${question.difficulty}`} label={difficultyLabels[question.difficulty]} /><h3>{question.id}. {question.title}</h3></div><a href={question.url} target="_blank" rel="noreferrer">打开完整原题 ↗</a></div>
    <div className="hot100-favorite"><Button aria-pressed={Boolean(entry.favorite)} label={entry.favorite ? '★ 已收藏' : '☆ 收藏本题'} onClick={() => onChange({ ...entry, favorite: !entry.favorite })} /><span>收藏与复习安排仅用于你的练习记录。</span></div>
    <div className="hot100-goal"><strong>本题练习目标 · 原创学习摘要</strong><p>{question.goal}</p></div>
    <div className="hot100-routines"><Button label="本题代码跟打" onClick={() => onUseRoutine(question)} /><p className="algorithm-caption">逐题参考解法 · Python</p><span>相关套路</span>{question.patternIds.length ? question.patternIds.map(id => <Button key={id} label={`练 ${getAlgorithmPattern(id).title}`} onClick={() => onUseRoutine(question, id)} />) : <span className="algorithm-caption">暂无关联通用套路，可直接练本题代码。</span>}</div>
    <div className="hot100-hint"><Button aria-expanded={showHint} label={showHint ? '收起本题提示' : '需要一点提示'} onClick={() => setShowHint(current => !current)} />{showHint ? <p role="note">{question.hint}</p> : <span>先想输入、输出和边界，再决定用哪种方法。</span>}</div>
    <TextArea id="hot100-notes" label="你的解题思路" value={entry.notes} rows={3} maxLength={3000} placeholder="为什么选这个方法？维护什么状态？时间与空间复杂度是多少？" onChange={value => edit({ notes: value })} />
    <label htmlFor="hot100-code">Python 独立作答</label><CodeEditor id="hot100-code" label="Python 独立作答" mode="python" value={entry.code} maxLength={12000} onChange={code => edit({ code })} placeholder="# 核对原题函数签名后，在这里编写你的 Python 解法。" />
    <p className="algorithm-caption">按题号自动保存在本机浏览器。使用原题的 class Solution 与方法签名；设计类题使用原题类名。预置 ListNode、TreeNode、Node 和常用 typing 类型。“已复习”是自评，不代表通过判题。</p>
    <section aria-label="固定用例验证">
      <Button label={phase === 'loading' ? '正在加载 Python…' : phase === 'running' ? '正在验证…' : '运行固定用例验证'} isDisabled={Boolean(phase) || !entry.code.trim()} onClick={() => { void runValidation(); }} />
      {phase ? <Button label="取消验证" onClick={() => { activeRun.current?.cancel(); }} /> : null}
      <p className="algorithm-caption">首次运行需联网从 jsDelivr 下载 Python WebAssembly 运行时；代码仅在无同源权限的浏览器沙箱 Worker 内执行，不提交给 API 或模型。加载最多 60 秒，执行最多 5 秒。固定用例不覆盖官方全部测试，也不是防作弊判题器。</p>
      {phase ? <p role="status">{phase === 'loading' ? '正在准备隔离 Python 环境…' : '正在运行本题固定用例…'}</p> : null}
      {validation ? <div role="status"><strong>{validation.status === 'passed' ? '固定用例通过' : validation.status === 'failed' ? '固定用例未通过' : '验证未完成'}</strong><pre>{validation.message}</pre>{validation.check ? <pre>失败检查：{validation.check}</pre> : null}</div> : null}
    </section>
    <div className="hot100-review"><span>本题状态 · 用户自评</span><SegmentedControl label="本题复习状态" value={entry.status} onChange={value => {
      const status = hot100StatusSchema.parse(value);
      onChange(status === 'reviewed' ? completeHot100Review(entry, new Date()) : { ...entry, status, needsReview: false, nextReviewAt: null });
    }}>{Object.entries(hot100StatusLabels).map(([value, label]) => <SegmentedControlItem key={value} value={value} label={label} />)}</SegmentedControl></div>
    <div className="hot100-review-plan"><div><strong>{isHot100ReviewDue(entry, now) ? '该复习这道题了' : entry.needsReview ? '已加入待复习' : '练完后安排下一次复习'}</strong><p>{entry.nextReviewAt ? `下次复习：${new Date(entry.nextReviewAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '完成自评复习后，按 1、3、7、14 天逐次安排。'}{entry.reviewCount ? ` · 已完成 ${entry.reviewCount} 次自评复习` : ''}</p></div><div><Button aria-pressed={Boolean(entry.needsReview)} label={entry.needsReview ? '取消待复习' : '需要再练 · 明天复习'} onClick={() => onChange(entry.needsReview ? { ...entry, needsReview: false, nextReviewAt: null } : markHot100NeedsReview(entry, new Date()))} /><Button label="完成本次复习（自评）" onClick={() => onChange(completeHot100Review(entry, new Date()))} /></div></div>
    <div className="hot100-actions"><Button variant="primary" label="下一道待练习" onClick={onNext} /><Button label="导出本题作答" onClick={() => downloadJson({ source: hot100Metadata.source.url, question: { id: question.id, title: question.title, url: question.url }, practice: entry }, `hot100-${question.id}-practice.json`)} /></div>
  </article>;
}

function downloadJson(payload: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
