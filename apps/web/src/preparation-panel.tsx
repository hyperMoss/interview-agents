import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { preparationInputSchema, preparationResultSchema, savePreparationSchema, type PreparationInput } from '../../../packages/contracts/src/preparation';
import { bankDraftSchema, type BankDraft } from '../../../packages/contracts/src/bank';
import { preparationBankDraft, preparationMarkdown } from '../../../packages/interview/src/preparation';
import { defaultPlanning } from './planning-panel';
import { categoryLabels, difficultyLabels } from './labels';
import { readSession, writeSession } from './storage';
import { api } from './api';
import type {PreparationHistory} from '../../../packages/contracts/src/preparation-history';
import { MarkdownShare } from './ui/markdown-share';
import { PdfExport } from './ui/pdf-export';
import './preparation.css';

const storageKey = 'jd-preparation-v1';
const formSchema = preparationInputSchema.extend({ role: z.string().max(120), jobDescription: z.string().max(12000) });
const cardSchema = z.strictObject({ requestId: z.uuid(), draft: bankDraftSchema.extend({title:z.string().max(160),content:z.string().max(3000)}), selected: z.boolean(), savedId: z.uuid().nullable() });
const draftSchema = z.strictObject({ input: preparationInputSchema, result: preparationResultSchema, cards: z.array(cardSchema).min(3).max(12) })
  .refine(value => value.cards.length === value.result.questions.length);
const pageSchema = z.strictObject({ form: formSchema, draft: draftSchema.nullable() });
type PageState = z.infer<typeof pageSchema>;
export type PreparedPractice = { input: PreparationInput; bankIds: string[] };
export type PreparationSeed = Partial<Pick<PreparationInput, 'role' | 'jobDescription' | 'focus' | 'candidateLevel' | 'round' | 'roleType' | 'roleFamily' | 'questionCount'>>;

function initialState(seed?: PreparationSeed): PageState {
  try {
    const saved = pageSchema.parse(JSON.parse(readSession(storageKey) ?? 'null'));
    return seed ? { ...saved, form: { ...saved.form, ...seed } } : saved;
  } catch {}
  let intake = { role: '', jobDescription: '', focus: '' };
  try { intake = z.object({ role: z.string().max(120), jobDescription: z.string().max(12000), focus: z.string().max(1000).default('') }).parse(JSON.parse(readSession('interview-intake') ?? 'null')); } catch {}
  return { form: { ...intake, candidateLevel: defaultPlanning.candidateLevel, round: defaultPlanning.round, roleType: defaultPlanning.roleType, roleFamily: defaultPlanning.roleFamily, questionCount: 6, ...seed }, draft: null };
}

export function loadPreparationHistory(record:PreparationHistory){
  const page=initialState(record.input);
  if(record.outcome.status==='ready'){
    const result=record.outcome.result;
    page.draft={input:record.input,result,cards:result.questions.map(question=>({requestId:crypto.randomUUID(),draft:preparationBankDraft(record.input,question,result.requirements),selected:true,savedId:null}))};
  }
  return writeSession(storageKey,JSON.stringify(page));
}

export function PreparationPanel({ onUse, onModelSettings, onHistory, seed }: { onUse: (practice: PreparedPractice) => void; onModelSettings: () => void; onHistory:()=>void; seed?: PreparationSeed }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(() => initialState(seed));
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const [savedBatch, setSavedBatch] = useState<PreparedPractice | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const { form, draft } = page;
  const carried = (() => { try { return z.object({ role: z.string().max(120), resume: z.string().max(64000) }).parse(JSON.parse(readSession('interview-intake') ?? 'null')); } catch { return null; } })();
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const settings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings, enabled: identity.isSuccess });
  useEffect(() => { setStorageFailed(!writeSession(storageKey, JSON.stringify(page))); }, [page]);
  const generate = useMutation({
    mutationFn: api.prepare,
    onSettled:()=>{void cache.invalidateQueries({queryKey:['preparation-history']});},
    onSuccess: (result, request) => {
      setSavedBatch(null);
      setPage(current => ({ ...current, draft: { input: request.input, result, cards: result.questions.map(question => ({ requestId: crypto.randomUUID(), draft: preparationBankDraft(request.input, question, result.requirements), selected: true, savedId: null })) } }));
      setNotice(`已生成 ${result.questions.length} 道题。检查题面与参考回答后再保存。`);
    },
  });
  const save = useMutation({
    mutationFn: async (practice: boolean) => {
      if (!draft) throw new Error('先生成题单。');
      const selected = draft.cards.filter(card => card.selected);
      if (!selected.length) throw new Error('至少勾选一道题。');
      const unsaved = selected.filter(card => !card.savedId);
      const saved = unsaved.length ? await api.savePreparation(savePreparationSchema.parse({ questions: unsaved.map(card => {
        const question = draft.result.questions[draft.cards.indexOf(card)];
        return { requestId: card.requestId, draft: { ...card.draft, jdRequirement: question ? draft.result.requirements[question.requirementIndex] : undefined } };
      }) })) : [];
      return { practice, saved, selected, input: draft.input };
    },
    onSuccess: ({ practice, saved, selected, input }) => {
      const ids = new Set(saved.map(question => question.id));
      setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map(card => ids.has(card.requestId) ? { ...card, savedId: card.requestId } : card) } } : current);
      void cache.invalidateQueries({ queryKey: ['question-bank'] });
      void cache.invalidateQueries({ queryKey: ['plan-preview'] });
      setNotice(`所选 ${selected.length} 道题已保存到题库（本次新增 ${saved.length} 道）。`);
      setSavedBatch({ input, bankIds: selected.map(card => card.savedId ?? card.requestId) });
      if (practice) onUse({ input, bankIds: selected.map(card => card.savedId ?? card.requestId) });
    },
  });
  const busy = generate.isPending || save.isPending;
  const ready = identity.isSuccess && settings.data && (settings.data.active || settings.data.mode !== 'disabled');
  const selected = draft?.cards.filter(card => card.selected) ?? [];
  const currentInput = preparationInputSchema.safeParse(form);
  const changed = draft && (!currentInput.success || JSON.stringify(draft.input) !== JSON.stringify(currentInput.data));
  const markdown = draft ? preparationMarkdown(draft.input, draft.result, draft.cards.map(card => card.draft)) : '';
  function changeForm(patch: Partial<PageState['form']>) { setPage(current => ({ ...current, form: { ...current.form, ...patch } })); }
  function changeCard(index: number, patch: Partial<BankDraft>) {
    save.reset(); setNotice('');
    setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map((card, i) => i === index ? { ...card, draft: { ...card.draft, ...patch } } : card) } } : current);
  }
  function changePriority(index: number, value: unknown) {
    const priority = preparationResultSchema.shape.requirements.element.shape.priority.parse(value);
    save.reset(); setNotice('');
    setPage(current => {
      if (!current.draft) return current;
      const requirements = current.draft.result.requirements.map((requirement, i) => i === index ? { ...requirement, priority } : requirement);
      const cards = current.draft.cards.map((card, i) => {
        const requirement = requirements[current.draft?.result.questions[i]?.requirementIndex ?? -1];
        return requirement && !card.savedId ? { ...card, draft: { ...card.draft, jdRequirement: requirement } } : card;
      });
      return { ...current, draft: { ...current.draft, result: { ...current.draft.result, requirements }, cards } };
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const input = preparationInputSchema.safeParse(form);
    if (!input.success) { setValidation('填写 2 至 120 字岗位名、20 至 12000 字 JD，题量为 3 至 12 道。'); return; }
    setValidation(''); setNotice(''); save.reset();
    generate.mutate({ requestId:crypto.randomUUID(), input: input.data, modelConnectionId: settings.data?.active?.id ?? null });
  }
  function download() {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'jd-preparation.md'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="preparation" aria-labelledby="preparation-title">
    <div className="panel-actions"><Button label="备题历史" onClick={onHistory} /></div><div className="intro"><h1 id="preparation-title">先读懂 JD，再准备每一道题。</h1><p>提取岗位能力要求，提前查看问题、追问与参考回答。可以只填 JD，简历留到正式练习时补充。</p></div>
    <form onSubmit={submit} className="preparation-form">
      <TextInput id="prep-role" label="备题岗位" aria-label="备题岗位" isRequired value={form.role} isDisabled={busy} onChange={value => changeForm({ role: value.slice(0, 120) })} placeholder="例如：前端工程师" />
      <TextArea id="prep-jd" label="备题 JD" aria-label="备题 JD" isRequired maxLength={12000} rows={6} value={form.jobDescription} isDisabled={busy} onChange={value => changeForm({ jobDescription: value })} placeholder="粘贴完整岗位职责与任职要求，保留必备与优先条件。" />
      <div className="planning-grid">
        <Selector id="prep-level" label="备题级别" value={form.candidateLevel} isDisabled={busy} onChange={value => changeForm({ candidateLevel: preparationInputSchema.shape.candidateLevel.parse(value) })} options={[{ value: 'intern', label: '实习' }, { value: 'new_grad', label: '校招' }, { value: 'experienced', label: '社招' }]} />
        <Selector id="prep-round" label="备题轮次" value={form.round} isDisabled={busy} onChange={value => changeForm({ round: preparationInputSchema.shape.round.parse(value) })} options={[{ value: 'first', label: '一面' }, { value: 'second', label: '二面' }, { value: 'hr', label: 'HR 面' }]} />
        <Selector id="prep-type" label="备题岗位类型" value={form.roleType} isDisabled={busy} onChange={value => changeForm({ roleType: preparationInputSchema.shape.roleType.parse(value) })} options={[{ value: 'technical', label: '技术岗' }, { value: 'nontechnical', label: '非技术岗' }]} />
        <Selector id="prep-family" label="备题岗位方向" value={form.roleFamily} isDisabled={busy} onChange={value => changeForm({ roleFamily: preparationInputSchema.shape.roleFamily.parse(value) })} options={[{ value: 'frontend', label: '前端' }, { value: 'backend', label: '后端' }, { value: 'fullstack', label: '全栈' }, { value: 'data', label: '数据与算法' }, { value: 'embedded', label: '嵌入式' }, { value: 'qa', label: '测试' }, { value: 'general', label: '通用' }]} />
        <NumberInput id="prep-count" label="预生成题量" min={3} max={12} value={form.questionCount} isDisabled={busy} onChange={value => changeForm({ questionCount: value })} />
      </div>
      <TextInput id="prep-focus" label="备题重点" value={form.focus} isDisabled={busy} onChange={value => changeForm({ focus: value.slice(0, 1000) })} placeholder="选填，例如：接口设计、复杂状态、项目追问" />
      <p className="storage-note">仅向所选模型发送本页岗位、JD 与备题参数。当前模型 {settings.data?.active?.model ?? (settings.data?.mode === 'demo' ? '规则演示' : settings.data?.defaultModel || '未配置')}。生成不启用联网搜索。</p>
      {carried?.resume.trim() ? <p className="context-note">已带入简历「{carried.role.trim() || '未命名简历'}」{carried.resume.trim().length} 字，保存并带入练习时使用；备题生成不发送简历全文。</p> : null}
      <div className="panel-actions"><Button variant="primary" type="submit" label={generate.isPending ? '正在分析 JD 并生成题目…' : draft ? '重新生成题单' : '根据 JD 生成题单'} isLoading={generate.isPending} isDisabled={busy || !ready} /><Button type="button" label="配置备题模型" isDisabled={busy} onClick={onModelSettings} /></div>
      {generate.isPending ? <p role="status">正在生成详细参考回答，最多等待 3 分钟。输入已保留，成功后替换已有题单，也可在备题历史查看进度。</p> : null}
      {validation || generate.error || settings.error ? <p role="alert" className="error">{validation || generate.error?.message || settings.error?.message}</p> : null}
    </form>
    {storageFailed ? <p role="alert" className="error">当前无法保存到本机，请先导出题单并检查数据管理。</p> : null}
    {notice ? <p role="status">{notice}{savedBatch ? <Button variant="ghost" label="立即开始模拟面试" isDisabled={busy} onClick={() => onUse(savedBatch)} /> : null}</p> : null}
    {draft ? <div className="preparation-result">
      <div className="form-heading"><h2>{draft.input.role} · {draft.cards.length} 道备题</h2><Button label="导出备题单" isDisabled={busy} onClick={download} /></div>
      <div className="preparation-exports"><MarkdownShare content={markdown} isDisabled={busy} /><PdfExport isDisabled={busy} generate={() => api.preparationPdf({input:draft.input,result:draft.result,drafts:draft.cards.map(({draft:card})=>({title:card.title,content:card.content,expectedAnswer:card.expectedAnswer}))})} /></div>
      {draft.result.modelMode === 'demo' ? <p className="demo-banner" role="note">规则演示题单。按 JD 原文与固定模板演示流程，启用模型后可生成更具体的内容。</p> : <p className="session-model">题单生成模型 {draft.result.model}</p>}
      {changed ? <p role="note">输入已修改。下方仍是上次生成的题单，保存与练习使用下方题单的原始参数。</p> : null}
      <div className="requirement-list" aria-label="JD 能力要求">{draft.result.requirements.map((requirement, index) => <article key={index}><h3>{index + 1}. {requirement.competency} <Badge variant={requirement.priority === 'required' ? 'blue' : 'neutral'} label={requirement.priority === 'required' ? '必备项' : '加分项'} /></h3><Selector id={`prep-priority-${index}`} label={`要求 ${index + 1} 分类`} value={requirement.priority} isDisabled={busy || draft.cards.some((card, i) => Boolean(card.savedId) && draft.result.questions[i]?.requirementIndex === index)} options={[{ value: 'required', label: '必备项' }, { value: 'preferred', label: '加分项' }]} onChange={value => changePriority(index, value)} /><blockquote>{requirement.quote}</blockquote></article>)}</div>
      <div className="panel-actions"><Button label="全选题目" isDisabled={busy} onClick={() => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map(card => ({ ...card, selected: true })) } } : current)} /><Button label="清空选择" isDisabled={busy} onClick={() => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map(card => ({ ...card, selected: false })) } } : current)} /><span>已选 {selected.length} 道</span></div>
      {draft.cards.map((card, index) => <article className="preparation-card" key={card.requestId}>
        <div className="preparation-card-heading"><CheckboxInput label={`第 ${index + 1} 题`} aria-label={`选择备题 ${index + 1}`} value={card.selected} isDisabled={busy} onChange={checked => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map((item, i) => i === index ? { ...item, selected: checked } : item) } } : current)} /><span>{categoryLabels[card.draft.category]} · {difficultyLabels[card.draft.difficulty]} · 对应要求 {(draft.result.questions[index]?.requirementIndex ?? 0) + 1}{card.savedId ? ' · 已入库' : ''}</span></div>
        <TextInput id={`prep-title-${index}`} label={`题目 ${index + 1} 标题`} value={card.draft.title} isDisabled={busy} isReadOnly={Boolean(card.savedId)} onChange={value => changeCard(index, { title: value.slice(0, 160) })} />
        <TextArea id={`prep-content-${index}`} label={`题目 ${index + 1} 题面`} maxLength={3000} rows={3} value={card.draft.content} isDisabled={busy} isReadOnly={Boolean(card.savedId)} onChange={value => changeCard(index, { content: value })} />
        <details><summary>{card.savedId ? '参考回答与追问' : '参考回答与追问，可编辑'}</summary><TextArea id={`prep-answer-${index}`} label={`题目 ${index + 1} 参考回答`} maxLength={8000} rows={12} value={card.draft.expectedAnswer} isDisabled={busy} isReadOnly={Boolean(card.savedId)} onChange={value => changeCard(index, { expectedAnswer: value })} /></details>
      </article>)}
      <div className="preparation-actions"><p>勾选的题目将以严格模式出现在面试中，题面不会被改写。保存后可在题库继续编辑；带入练习会保留已有简历草稿，实际题量仍按时长与环节估算。</p><div className="panel-actions"><Button label="保存所选到题库" isLoading={save.isPending} isDisabled={busy || !selected.length || selected.some(card => !bankDraftSchema.safeParse(card.draft).success)} onClick={() => save.mutate(false)} /><Button variant="primary" label="保存并带入练习" isLoading={save.isPending} isDisabled={busy || !selected.length || selected.some(card => !bankDraftSchema.safeParse(card.draft).success)} onClick={() => save.mutate(true)} /></div>{save.error ? <p role="alert" className="error">{save.error.message}。未确认成功时可重试相同题目。</p> : null}</div>
    </div> : <p className="context-note">题单会自动保存在本机。题目保存后属于当前浏览器身份。</p>}
  </section>;
}
