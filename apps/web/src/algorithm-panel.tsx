import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ConfirmAction } from './ui/confirm-action';
import { useQuery } from '@tanstack/react-query';
import type { BankQuestion } from '../../../packages/contracts/src/bank';
import { algorithmPatterns, getAlgorithmPattern, suggestPatterns } from '../../../packages/interview/src/algorithm-patterns';
import { compareTyping } from '../../../packages/interview/src/typing-practice';
import { algorithmDraftKey, drillKindSchema, getAlgorithmDrillTarget, recordTyping, restoreAlgorithmDraft, sameDrill, type AlgorithmDraft } from './algorithm-draft';
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
    patternId: suggested?.pattern.id ?? draft.patternId, codeSource: 'pattern',
  };
}

export function AlgorithmPanel({ seed, initialView, questionId, patternId, onNavigate }: AlgorithmPanelProps) {
  const [restored] = useState(restoreAlgorithmDraft);
  const [draft, setDraft] = useState(() => {
    const base = seed ? withSeed(restored.draft, seed) : restored.draft;
    const question = questionId && initialView === 'patterns' ? findHot100Question(questionId) : undefined;
    return {
      ...base,
      ...(question ? { codeSource: patternId ? 'pattern' : 'question', kind: base.origin.kind === 'hot100' && base.origin.id === question.id && base.codeSource === (patternId ? 'pattern' : 'question') ? base.kind : 'code', problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` } } satisfies Partial<AlgorithmDraft> : {}),
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
  const target = getAlgorithmDrillTarget(draft);
  const referenceQuestion = draft.origin.kind === 'hot100' && draft.codeSource === 'question' ? findHot100Question(draft.origin.id) : undefined;
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
    if (patternId) setDraft(current => ({ ...current, patternId: getAlgorithmPattern(patternId).id, codeSource: 'pattern' }));
    if (questionId) {
      setReturnQuestionId(questionId);
      const question = initialView === 'patterns' ? findHot100Question(questionId) : undefined;
      if (question) setDraft(current => current.origin.kind === 'hot100' && current.origin.id === question.id && current.codeSource === (patternId ? 'pattern' : 'question') ? current : {
        ...current, problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` }, codeSource: patternId ? 'pattern' : 'question', kind: 'code',
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
    setDraft(current => ({ ...current, patternId: nextPatternId, codeSource: 'pattern' }));
    onNavigate?.({ view: 'patterns', questionId: returnQuestionId, patternId: nextPatternId });
    setChecked(false);
    setNotice('');
  }
  function useExample() {
    setDraft(current => ({ ...current, codeSource: 'pattern', problem: pattern.example.statement, origin: { kind: 'example', title: pattern.example.title, patternId: pattern.id } }));
    setChecked(false);
    setNotice('');
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(target.reference); setNotice('Python 核心代码已复制。'); }
    catch { setNotice('复制失败，请在参考代码中选择并复制。'); }
  }

  return <section className="algorithm-panel" aria-labelledby="algorithm-title">
    <header className="algorithm-header">
      <div><span className="algorithm-eyebrow">ALGORITHM LAB · PYTHON</span><h1 id="algorithm-title">先认套路，再亲手打出来。</h1><p>从题目线索找到思路。照着题面或核心代码练一遍，再隐藏参考试着默写。</p></div>
      <div className="algorithm-count"><strong>{algorithmPatterns.length}</strong><span>个常见模式</span></div>
    </header>
    {storageWarning ? <Banner role="alert" status="warning" title={storageWarning} /> : null}
    <SegmentedControl className="algorithm-mode-picker" label="算法练习模式" value={view} onChange={value => {
      const nextView = value === 'hot100' ? 'hot100' : 'patterns';
      setView(nextView); setChecked(false); setNotice('');
      onNavigate?.({ view: nextView, questionId: returnQuestionId, ...(nextView === 'patterns' && draft.codeSource === 'pattern' ? { patternId: draft.patternId } : {}) });
    }}><SegmentedControlItem value="hot100" label="Hot 100 题单" /><SegmentedControlItem value="patterns" label="代码与题面跟打" /></SegmentedControl>
    {view === 'hot100' ? <Hot100Panel questionId={questionId ?? returnQuestionId} onSelectQuestion={id => {
      setReturnQuestionId(id); onNavigate?.({ view: 'hot100', questionId: id });
    }} onUseRoutine={(question, patternId) => {
      setDraft(current => ({ ...current, problem: hot100Brief(question), origin: { kind: 'hot100', id: question.id, title: `${question.id}. ${question.title}` }, patternId: patternId ?? current.patternId, codeSource: patternId ? 'pattern' : 'question', questionCodeStyle: 'annotated', kind: 'code' }));
      setReturnQuestionId(question.id); setChecked(false); setNotice(''); setView('patterns');
      onNavigate?.({ view: 'patterns', questionId: question.id, patternId });
    }} /> : <>
    {returnQuestionId ? <div className="algorithm-return"><Button label={`← 返回 Hot 100 第 ${returnQuestionId} 题`} onClick={() => {
      setView('hot100'); setNotice(''); setChecked(false); onNavigate?.({ view: 'hot100', questionId: returnQuestionId });
    }} /><span>原题的独立作答、思路与筛选已保留。</span></div> : null}
    <section className="algorithm-source" aria-labelledby="algorithm-source-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-source-title">01 / 给一道题</h2><Badge label="关键词辅助识别 · 无需模型" /></div>
      <div className="algorithm-source-grid">
        <div>
          <TextArea id="algorithm-problem" label="题面或关键词" value={draft.problem} maxLength={14000} rows={4} placeholder="例如：含负数的数组，求和为 k 的连续子数组个数" onChange={value => {
            setDraft(current => ({ ...current, problem: value, codeSource: 'pattern', origin: { kind: 'custom', title: '自填题面' } }));
            setChecked(false);
            setNotice('');
          }} />
          <p className="algorithm-caption">当前题面 · {draft.origin.title}{draft.origin.kind === 'bank' ? '（题库快照）' : draft.origin.kind === 'hot100' ? '（Hot 100 学习摘要）' : ''}</p>
        </div>
        <div className="algorithm-bank-picker">
          <Selector id="algorithm-bank" label="从编程题库选择" placeholder="选择一道已有编程题" value={codingQuestions.some(q => q.id === bankId) ? bankId : undefined} hasSearch isLoading={bank.isFetching} isDisabled={!identity.isSuccess || !bank.isSuccess} options={codingQuestions.map(question => ({ value: question.id, label: question.title }))} onChange={id => {
            const question = codingQuestions.find(item => item.id === id);
            if (question) setDraft(current => withSeed(current, question));
            setChecked(false);
            setNotice('');
          }} emptyText="暂无编程题，请到题库自建或导入" />
          <p className="algorithm-caption">自建题与导入题都可带入。编辑题面不会改动原题库。</p>
          {identity.isError || bank.isError ? <Banner role="alert" status="warning" title="题库暂时不可用，仍可使用内置例题或自填题面。" endContent={<Button label="重读题库" onClick={() => void (identity.isError ? identity.refetch() : bank.refetch())} />} /> : null}
        </div>
      </div>
      <div className="algorithm-matches" aria-label="关键词推荐模式">
        {suggestions.candidates.length ? suggestions.candidates.map(({ pattern: candidate, matched }) => <Button key={candidate.id} className="algorithm-match" variant={pattern.id === candidate.id ? 'primary' : 'secondary'} label={`${candidate.title} 命中 ${matched.join(' / ')}`} onClick={() => choosePattern(candidate.id)}><strong>{candidate.title}</strong><span>命中 {matched.join(' / ')}</span></Button>) : referenceQuestion ? null : <EmptyState title="没有命中现有模式。补充题意，或在下方手动选择；仅凭关键词不能确定解法。" />}
      </div>
      {suggestions.warnings.map(warning => <Banner role="alert" key={warning} status="warning" title={warning} />)}
    </section>

    {referenceQuestion ? <section className="algorithm-recipe" aria-labelledby="algorithm-question-title"><h2 id="algorithm-question-title">02 / 本题参考解法 · {referenceQuestion.id}. {referenceQuestion.title}</h2><p>{referenceQuestion.hint}</p><h3>解题步骤</h3><ol>{referenceQuestion.explanation.steps.map(step => <li key={step}>{step}</li>)}</ol><h3>边界与易错点</h3><ul>{referenceQuestion.explanation.pitfalls.map(pitfall => <li key={pitfall}>{pitfall}</li>)}</ul><p className="algorithm-complexity">{referenceQuestion.explanation.complexity}</p><p className="algorithm-caption">本项目编写的 Python 参考实现；ListNode、TreeNode 与 Node 由原题环境提供。请核对原题输入、输出与限制；跟打一致不代表通过原站判题。</p><a href={referenceQuestion.url} target="_blank" rel="noreferrer">打开完整原题 ↗</a></section> : <section className="algorithm-recipe" aria-labelledby="algorithm-recipe-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-recipe-title">02 / 拆开这个套路</h2><Selector label="选择算法模式" isLabelHidden value={pattern.id} options={algorithmPatterns.map(item => ({ value: item.id, label: item.title }))} onChange={choosePattern} /></div>
      <h3>{pattern.title}<span>{pattern.summary}</span></h3>
      <div className="algorithm-keywords" aria-label="本模式识别关键词"><span>识别词</span>{pattern.keywords.map(keyword => <Badge key={keyword} label={keyword} />)}</div>
      <p className="algorithm-condition"><strong>什么时候用</strong>{pattern.conditions}</p>
      <div className="algorithm-recipe-grid">
        <div><h4>核心步骤</h4><ol>{pattern.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
        <div><h4>容易踩的坑</h4><ul>{pattern.pitfalls.map(pitfall => <li key={pitfall}>{pitfall}</li>)}</ul></div>
      </div>
      <p className="algorithm-complexity">{pattern.complexity}</p>
      <div className="algorithm-example"><div><strong>模板例题 · {pattern.example.title}</strong><p>{pattern.example.statement}</p><code>{pattern.example.invocation} → {pattern.example.result}</code></div><Button label="用这道例题练题面" onClick={useExample} /></div>
      <p className="algorithm-caption">下方核心代码解决的是这道模板例题。套到当前题目时，需要自行核对输入、条件和返回值。</p>
    </section>}

    <section className="algorithm-drill" aria-labelledby="algorithm-drill-title">
      <div className="algorithm-section-heading"><h2 id="algorithm-drill-title">03 / 动手跟打</h2><SegmentedControl label="跟打对象" value={draft.kind} onChange={value => {
        setDraft(current => ({ ...current, kind: drillKindSchema.parse(value) })); setChecked(false); setNotice('');
      }}><SegmentedControlItem value="code" label="核心代码跟打" /><SegmentedControlItem value="statement" label="题面跟打" /></SegmentedControl></div>
      {referenceQuestion && draft.kind === 'code' ? <SegmentedControl label="本题代码版本" value={draft.questionCodeStyle} onChange={value => {
        setDraft(current => ({ ...current, questionCodeStyle: value === 'annotated' ? 'annotated' : 'concise' })); setChecked(false); setNotice('');
      }}><SegmentedControlItem value="annotated" label="讲解注释版" /><SegmentedControlItem value="concise" label="精简版" /></SegmentedControl> : null}
      <div className="algorithm-drill-heading"><strong>{draft.kind === 'code' ? `Python · ${referenceQuestion ? `${referenceQuestion.id}. ${referenceQuestion.title}` : pattern.example.title}` : draft.origin.title}</strong><Switch size="sm" label="显示参考" value={showReference} onChange={setShowReference} /></div>
      <div className="algorithm-editors">
        <div className="algorithm-reference-column"><div className="algorithm-editor-label">参考{draft.kind === 'code' ? '代码' : '题面'}</div>
          {showReference ? <div className={`algorithm-reference ${draft.kind}`} aria-label="跟打参考文本">{target.reference.split('\n').map((line, index) => <div key={index} className={`algorithm-code-line ${typed && comparison.difference?.line === index + 1 ? 'current-line' : ''}`}><span className="algorithm-line-number" aria-hidden="true">{index + 1}</span><code>{line || '\u00a0'}</code></div>)}</div> : <div className="algorithm-reference-hidden">参考已隐藏。试着默写，完成后再核对。</div>}
        </div>
        <div className="algorithm-input-column"><label className="algorithm-editor-label" htmlFor="algorithm-typing">你的{draft.kind === 'code' ? '代码' : '题面'}</label>
          <CodeEditor key={`${target.key}:${target.kind}:${target.reference}`} id="algorithm-typing" label={`你的${draft.kind === 'code' ? '代码' : '题面'}`} describedBy="algorithm-typing-help" mode={draft.kind === 'code' ? 'drill-code' : 'text'} value={typed} disabled={!target.reference} maxLength={30000} placeholder={!target.reference ? '先填写题面，或使用一份模板例题。' : draft.kind === 'code' ? '看左侧参考，从第一行开始手打…' : '照着左侧题面逐字练习…'} onChange={changeTyping} />
        </div>
      </div>
      <p id="algorithm-typing-help" className="algorithm-caption">保留空格与缩进，统一换行格式。跟打模式关闭自动补全、自动缩进与括号补齐。草稿自动保存在本机浏览器，最多恢复最近 20 个跟打对象；注释版与精简版独立保存，旧精简版草稿可切换查看。</p>
      <div className="algorithm-progress"><ProgressBar label="跟打文本匹配进度" isLabelHidden value={comparison.progress} variant={comparison.complete ? 'success' : 'accent'} /><span>连续匹配 {comparison.prefix} / {comparison.total} 字符{typed.length ? ` · 已输入 ${comparison.entered} 字符` : ''}</span></div>
      <div className="algorithm-drill-actions"><Button variant="primary" label="核对跟打" onClick={() => setChecked(true)} isDisabled={!target.reference} /><ConfirmAction title="清空当前跟打内容？" description="只清空当前对象的输入，其他对象的草稿保留。" okText="确认清空" cancelText="保留内容" disabled={!typed} onConfirm={() => { changeTyping(''); setNotice('当前跟打已清空，其他对象的草稿保留。'); }}><Button label="重置本次跟打" isDisabled={!typed} /></ConfirmAction>{draft.kind === 'code' ? <Button label="复制核心代码" onClick={() => void copyCode()} /> : null}<span>仅做文本对照，不执行代码或判题。</span></div>
      {notice ? <p role="status">{notice}</p> : null}
      {checked ? <div className="algorithm-check" role="status">
        {comparison.complete ? <Banner role="alert" status="success" title="跟打一致。你可以隐藏参考，再试一次默写。" /> : comparison.difference ? <Banner role="alert" status="warning" title={`首次差异在第 ${comparison.difference.line} 行、第 ${comparison.difference.column} 列。应为${characterLabel(comparison.difference.expected)}，实际为${characterLabel(comparison.difference.actual)}。`} /> : null}
        <details open={!comparison.complete}><summary>逐行对照</summary><div className="algorithm-line-review">{comparison.lines.map(line => <div key={line.number} className={line.matches ? 'matched' : 'different'}><strong>第 {line.number} 行 · {line.matches ? '一致' : '待核对'}</strong><div>参考 <code>{line.expected === null ? '（无此行）' : line.expected || '（空行）'}</code></div><div>输入 <code>{line.actual === null ? '（尚未输入）' : line.actual || '（空行）'}</code></div></div>)}</div></details>
      </div> : null}
    </section>
    </>}
  </section>;
}
