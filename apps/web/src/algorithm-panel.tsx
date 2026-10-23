import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Popconfirm, Progress, Segmented, Select, Switch, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { BankQuestion } from '../../../packages/contracts/src/bank';
import { algorithmPatterns, getAlgorithmPattern, suggestPatterns } from '../../../packages/interview/src/algorithm-patterns';
import { compareTyping } from '../../../packages/interview/src/typing-practice';
import { algorithmDraftKey, drillKindSchema, recordTyping, restoreAlgorithmDraft, sameDrill, type AlgorithmDraft, type DrillTarget } from './algorithm-draft';
import { readSession, writeSession } from './storage';
import { Hot100Panel } from './hot100-panel';
import { findHot100Question, hot100Brief } from '../../../packages/interview/src/hot100';
import { CodeEditor } from './code-editor';
import { api } from './api';
import './algorithm.css';

export type AlgorithmSeed = Pick<BankQuestion, 'id' | 'title' | 'content'>;
export type AlgorithmRoute = { view: 'hot100' | 'patterns'; questionId?: number; patternId?: string };
type AlgorithmPanelProps = {
  seed?: AlgorithmSeed;
  initialView?: AlgorithmRoute['view'];
  questionId?: number;
  patternId?: string;
  onNavigate?: (route: AlgorithmRoute) => void;
};

function characterLabel(value: string | null) {
  if (value === null) return '文本结束';
  if (value === ' ') return '空格';
  if (value === '\n') return '换行';
  if (value === '\t') return 'Tab';
  return `「${value}」`;
}

function withSeed(draft: AlgorithmDraft, seed: AlgorithmSeed): AlgorithmDraft {
  const suggested = suggestPatterns(`${seed.title}\n${seed.content}`).candidates[0];
  return {
    ...draft, problem: seed.content, origin: { kind: 'bank', id: seed.id, title: seed.title },
    patternId: suggested?.pattern.id ?? draft.patternId,
  };
}

export function AlgorithmPanel({ seed, initialView, questionId, patternId, onNavigate }: AlgorithmPanelProps) {
  const [restored] = useState(restoreAlgorithmDraft);
  const [draft, setDraft] = useState(() => {
    const base = seed ? withSeed(restored.draft, seed) : restored.draft;
    const question = questionId && initialView === 'patterns' ? findHot100Question(questionId) : undefined;
    return {
      ...base,
      ...(question ? { problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` } } satisfies Partial<AlgorithmDraft> : {}),
      ...(patternId ? { patternId: getAlgorithmPattern(patternId).id } : {}),
    };
  });
  const [storageWarning, setStorageWarning] = useState(restored.warning);
  const [showReference, setShowReference] = useState(true);
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<AlgorithmRoute['view']>(() => seed ? 'patterns' : initialView ?? (readSession('algorithm-view') === 'hot100' ? 'hot100' : 'patterns'));
  const [returnQuestionId, setReturnQuestionId] = useState(questionId ?? (restored.draft.origin.kind === 'hot100' ? restored.draft.origin.id : undefined));
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const bank = useQuery({ queryKey: ['question-bank'], queryFn: api.bankList, enabled: identity.isSuccess });
  const pattern = getAlgorithmPattern(draft.patternId);
  const suggestions = suggestPatterns(`${draft.origin.kind === 'custom' ? '' : draft.origin.title}\n${draft.problem}`);
  const target: DrillTarget = draft.kind === 'code'
    ? { key: `python:${pattern.id}`, kind: 'code', reference: pattern.code }
    : { key: draft.origin.kind === 'bank' ? `bank:${draft.origin.id}` : draft.origin.kind === 'hot100' ? `hot100:${draft.origin.id}` : draft.origin.kind === 'example' ? `example:${draft.origin.patternId}` : 'custom', kind: 'statement', reference: draft.problem };
  const typed = draft.drills.find(drill => sameDrill(drill, target))?.typed ?? '';
  const comparison = compareTyping(target.reference, typed);
  const codingQuestions = bank.data?.filter(question => question.category === 'coding') ?? [];
  const bankId = draft.origin.kind === 'bank' ? draft.origin.id : undefined;

  useEffect(() => {
    if (!writeSession(algorithmDraftKey, JSON.stringify(draft))) setStorageWarning('浏览器无法保存草稿，请保持页面打开，并及时复制自己的练习。');
  }, [draft]);
  useEffect(() => { writeSession('algorithm-view', view); }, [view]);
  useEffect(() => {
    if (initialView) setView(initialView);
    if (patternId) setDraft(current => ({ ...current, patternId: getAlgorithmPattern(patternId).id }));
    if (questionId) {
      setReturnQuestionId(questionId);
      const question = initialView === 'patterns' ? findHot100Question(questionId) : undefined;
      if (question) setDraft(current => current.origin.kind === 'hot100' && current.origin.id === question.id ? current : {
        ...current, problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` }, kind: 'code',
      });
    }
    setChecked(false);
  }, [initialView, patternId, questionId]);

  function changeTyping(value: string) {
    setDraft(current => recordTyping(current, target, value));
    setChecked(false);
    setNotice('');
  }
  function choosePattern(id: string) {
    const nextPatternId = getAlgorithmPattern(id).id;
    setDraft(current => ({ ...current, patternId: nextPatternId }));
    onNavigate?.({ view: 'patterns', questionId: returnQuestionId, patternId: nextPatternId });
    setChecked(false);
    setNotice('');
  }
  function useExample() {
    setDraft(current => ({ ...current, problem: pattern.example.statement, origin: { kind: 'example', title: pattern.example.title, patternId: pattern.id } }));
    setChecked(false);
    setNotice('');
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(pattern.code); setNotice('Python 核心代码已复制。'); }
    catch { setNotice('复制失败，请在参考代码中选择并复制。'); }
  }

  return <section className="algorithm-panel" aria-labelledby="algorithm-title">
    <header className="algorithm-header">
      <div><span className="algorithm-eyebrow">ALGORITHM LAB · PYTHON</span><h1 id="algorithm-title">先认套路，再亲手打出来。</h1><p>从题目线索找到思路。照着题面或核心代码练一遍，再隐藏参考试着默写。</p></div>
      <div className="algorithm-count"><strong>{algorithmPatterns.length}</strong><span>个常见模式</span></div>
    </header>
    {storageWarning ? <Alert type="warning" message={storageWarning} showIcon /> : null}
    <Segmented className="algorithm-mode-picker" aria-label="算法练习模式" value={view} options={[{ value: 'hot100', label: 'Hot 100 题单' }, { value: 'patterns', label: '套路跟打' }]} onChange={value => {
      const nextView = value === 'hot100' ? 'hot100' : 'patterns';
      setView(nextView); setChecked(false); setNotice('');
      onNavigate?.({ view: nextView, questionId: returnQuestionId, ...(nextView === 'patterns' ? { patternId: draft.patternId } : {}) });
    }} />
    {view === 'hot100' ? <Hot100Panel questionId={questionId ?? returnQuestionId} onSelectQuestion={id => {
      setReturnQuestionId(id); onNavigate?.({ view: 'hot100', questionId: id });
    }} onUseRoutine={(question, patternId) => {
      setDraft(current => ({ ...current, problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` }, patternId, kind: 'code' }));
      setReturnQuestionId(question.id); setChecked(false); setNotice(''); setView('patterns');
      onNavigate?.({ view: 'patterns', questionId: question.id, patternId });
    }} /> : <>
    {returnQuestionId ? <div className="algorithm-return"><Button onClick={() => {
      setView('hot100'); setNotice(''); setChecked(false); onNavigate?.({ view: 'hot100', questionId: returnQuestionId });
    }}>← 返回 Hot 100 第 {returnQuestionId} 题</Button><span>原题的独立作答、思路与筛选已保留。</span></div> : null}
    <section className="algorithm-source" aria-labelledby="algorithm-source-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-source-title">01 / 给一道题</h2><Tag>关键词辅助识别 · 无需模型</Tag></div>
      <div className="algorithm-source-grid">
        <div>
          <label htmlFor="algorithm-problem">题面或关键词</label>
          <Input.TextArea id="algorithm-problem" value={draft.problem} maxLength={14000} rows={4} placeholder="例如：含负数的数组，求和为 k 的连续子数组个数" onChange={event => {
            setDraft(current => ({ ...current, problem: event.target.value, origin: { kind: 'custom', title: '自填题面' } }));
            setChecked(false);
            setNotice('');
          }} />
          <p className="algorithm-caption">当前题面 · {draft.origin.title}{draft.origin.kind === 'bank' ? '（题库快照）' : draft.origin.kind === 'hot100' ? '（Hot 100 学习摘要）' : ''}</p>
        </div>
        <div className="algorithm-bank-picker">
          <label htmlFor="algorithm-bank">从编程题库选择</label>
          <Select id="algorithm-bank" aria-label="从编程题库选择" placeholder="选择一道已有编程题" value={codingQuestions.some(q => q.id === bankId) ? bankId : undefined} showSearch optionFilterProp="label" loading={bank.isFetching} disabled={!identity.isSuccess || !bank.isSuccess} options={codingQuestions.map(question => ({ value: question.id, label: question.title }))} onChange={id => {
            const question = codingQuestions.find(item => item.id === id);
            if (question) setDraft(current => withSeed(current, question));
            setChecked(false);
            setNotice('');
          }} notFoundContent="暂无编程题，请到题库自建或导入" />
          <p className="algorithm-caption">自建题与导入题都可带入。编辑题面不会改动原题库。</p>
          {identity.isError || bank.isError ? <Alert type="warning" message="题库暂时不可用，仍可使用内置例题或自填题面。" action={<Button onClick={() => void (identity.isError ? identity.refetch() : bank.refetch())}>重读题库</Button>} /> : null}
        </div>
      </div>
      <div className="algorithm-matches" aria-label="关键词推荐模式">
        {suggestions.candidates.length ? suggestions.candidates.map(({ pattern: candidate, matched }) => <Button key={candidate.id} className="algorithm-match" type={pattern.id === candidate.id ? 'primary' : 'default'} onClick={() => choosePattern(candidate.id)}><strong>{candidate.title}</strong><span>命中 {matched.join(' / ')}</span></Button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有命中现有模式。补充题意，或在下方手动选择；仅凭关键词不能确定解法。" />}
      </div>
      {suggestions.warnings.map(warning => <Alert key={warning} type="warning" showIcon message={warning} />)}
    </section>

    <section className="algorithm-recipe" aria-labelledby="algorithm-recipe-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-recipe-title">02 / 拆开这个套路</h2><Select aria-label="选择算法模式" value={pattern.id} options={algorithmPatterns.map(item => ({ value: item.id, label: item.title }))} onChange={choosePattern} /></div>
      <h3>{pattern.title}<span>{pattern.summary}</span></h3>
      <div className="algorithm-keywords" aria-label="本模式识别关键词"><span>识别词</span>{pattern.keywords.map(keyword => <Tag key={keyword}>{keyword}</Tag>)}</div>
      <p className="algorithm-condition"><strong>什么时候用</strong>{pattern.conditions}</p>
      <div className="algorithm-recipe-grid">
        <div><h4>核心步骤</h4><ol>{pattern.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
        <div><h4>容易踩的坑</h4><ul>{pattern.pitfalls.map(pitfall => <li key={pitfall}>{pitfall}</li>)}</ul></div>
      </div>
      <p className="algorithm-complexity">{pattern.complexity}</p>
      <div className="algorithm-example"><div><strong>模板例题 · {pattern.example.title}</strong><p>{pattern.example.statement}</p><code>{pattern.example.invocation} → {pattern.example.result}</code></div><Button onClick={useExample}>用这道例题练题面</Button></div>
      <p className="algorithm-caption">下方核心代码解决的是这道模板例题。套到当前题目时，需要自行核对输入、条件和返回值。</p>
    </section>

    <section className="algorithm-drill" aria-labelledby="algorithm-drill-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-drill-title">03 / 动手跟打</h2><Segmented aria-label="跟打对象" value={draft.kind} options={[{ label: '核心代码跟打', value: 'code' }, { label: '题面跟打', value: 'statement' }]} onChange={value => {
        setDraft(current => ({ ...current, kind: drillKindSchema.parse(value) })); setChecked(false); setNotice('');
      }} /></div>
      <div className="algorithm-drill-heading"><strong>{draft.kind === 'code' ? `Python · ${pattern.example.title}` : draft.origin.title}</strong><label><Switch size="small" checked={showReference} onChange={setShowReference} aria-label="显示参考" /> 显示参考</label></div>
      <div className="algorithm-editors">
        <div className="algorithm-reference-column"><div className="algorithm-editor-label">参考{draft.kind === 'code' ? '代码' : '题面'}</div>
          {showReference ? <div className={`algorithm-reference ${draft.kind}`} aria-label="跟打参考文本">{target.reference.split('\n').map((line, index) => <div key={index} className={`algorithm-code-line ${typed && comparison.difference?.line === index + 1 ? 'current-line' : ''}`}><span className="algorithm-line-number" aria-hidden="true">{index + 1}</span><code>{line || '\u00a0'}</code></div>)}</div> : <div className="algorithm-reference-hidden">参考已隐藏。试着默写，完成后再核对。</div>}
        </div>
        <div className="algorithm-input-column"><label className="algorithm-editor-label" htmlFor="algorithm-typing">你的{draft.kind === 'code' ? '代码' : '题面'}</label>
          <CodeEditor key={`${target.key}:${target.kind}:${target.reference}`} id="algorithm-typing" label={`你的${draft.kind === 'code' ? '代码' : '题面'}`} describedBy="algorithm-typing-help" mode={draft.kind === 'code' ? 'drill-code' : 'text'} value={typed} disabled={!target.reference} maxLength={30000} placeholder={!target.reference ? '先填写题面，或使用一份模板例题。' : draft.kind === 'code' ? '看左侧参考，从第一行开始手打…' : '照着左侧题面逐字练习…'} onChange={changeTyping} />
        </div>
      </div>
      <p id="algorithm-typing-help" className="algorithm-caption">保留空格与缩进，统一换行格式。跟打模式关闭自动补全、自动缩进与括号补齐。草稿自动保存在本机浏览器，最多恢复最近 20 个跟打对象。</p>
      <div className="algorithm-progress"><Progress aria-label="跟打文本匹配进度" percent={comparison.progress} showInfo={false} status={comparison.complete ? 'success' : 'normal'} /><span>连续匹配 {comparison.prefix} / {comparison.total} 字符{typed.length ? ` · 已输入 ${comparison.entered} 字符` : ''}</span></div>
      <div className="algorithm-drill-actions"><Button type="primary" onClick={() => setChecked(true)} disabled={!target.reference}>核对跟打</Button><Popconfirm title="清空当前跟打内容？" description="只清空当前对象的输入，其他对象的草稿保留。" okText="确认清空" cancelText="保留内容" disabled={!typed} onConfirm={() => { changeTyping(''); setNotice('当前跟打已清空，其他对象的草稿保留。'); }}><Button disabled={!typed}>重置本次跟打</Button></Popconfirm>{draft.kind === 'code' ? <Button onClick={() => void copyCode()}>复制核心代码</Button> : null}<span>仅做文本对照，不执行代码或判题。</span></div>
      {notice ? <p role="status">{notice}</p> : null}
      {checked ? <div className="algorithm-check" role="status">
        {comparison.complete ? <Alert type="success" showIcon message="跟打一致。你可以隐藏参考，再试一次默写。" /> : comparison.difference ? <Alert type="warning" showIcon message={`首次差异在第 ${comparison.difference.line} 行、第 ${comparison.difference.column} 列。应为${characterLabel(comparison.difference.expected)}，实际为${characterLabel(comparison.difference.actual)}。`} /> : null}
        <details open={!comparison.complete}><summary>逐行对照</summary><div className="algorithm-line-review">{comparison.lines.map(line => <div key={line.number} className={line.matches ? 'matched' : 'different'}><strong>第 {line.number} 行 · {line.matches ? '一致' : '待核对'}</strong><div>参考 <code>{line.expected === null ? '（无此行）' : line.expected || '（空行）'}</code></div><div>输入 <code>{line.actual === null ? '（尚未输入）' : line.actual || '（空行）'}</code></div></div>)}</div></details>
      </div> : null}
    </section>
    </>}
  </section>;
}
