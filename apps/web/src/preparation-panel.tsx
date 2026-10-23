import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Checkbox, Input, InputNumber, Select, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { preparationInputSchema, preparationResultSchema, savePreparationSchema, type PreparationInput } from '../../../packages/contracts/src/preparation';
import { bankDraftSchema, type BankDraft } from '../../../packages/contracts/src/bank';
import { preparationBankDraft, preparationMarkdown } from '../../../packages/interview/src/preparation';
import { defaultPlanning } from './planning-panel';
import { categoryLabels, difficultyLabels } from './labels';
import { readSession, writeSession } from './storage';
import { api } from './api';
import './preparation.css';

const storageKey = 'jd-preparation-v1';
const formSchema = preparationInputSchema.extend({ role: z.string().max(120), jobDescription: z.string().max(12000) });
const cardSchema = z.strictObject({ requestId: z.uuid(), draft: bankDraftSchema.extend({title:z.string().max(160),content:z.string().max(3000)}), selected: z.boolean(), savedId: z.uuid().nullable() });
const draftSchema = z.strictObject({ input: preparationInputSchema, result: preparationResultSchema, cards: z.array(cardSchema).min(3).max(12) })
  .refine(value => value.cards.length === value.result.questions.length);
const pageSchema = z.strictObject({ form: formSchema, draft: draftSchema.nullable() });
type PageState = z.infer<typeof pageSchema>;
export type PreparedPractice = { input: PreparationInput; bankIds: string[] };
export type PreparationSeed = Pick<PreparationInput, 'role' | 'jobDescription' | 'focus' | 'candidateLevel' | 'round' | 'roleType' | 'roleFamily' | 'questionCount'>;

function initialState(seed?: PreparationSeed): PageState {
  try {
    const saved = pageSchema.parse(JSON.parse(readSession(storageKey) ?? 'null'));
    return seed ? { ...saved, form: { ...saved.form, ...seed } } : saved;
  } catch {}
  let intake = { role: '', jobDescription: '', focus: '' };
  try { intake = z.object({ role: z.string().max(120), jobDescription: z.string().max(12000), focus: z.string().max(1000).default('') }).parse(JSON.parse(readSession('interview-intake') ?? 'null')); } catch {}
  return { form: { ...intake, candidateLevel: defaultPlanning.candidateLevel, round: defaultPlanning.round, roleType: defaultPlanning.roleType, roleFamily: defaultPlanning.roleFamily, questionCount: 6, ...seed }, draft: null };
}

export function PreparationPanel({ onUse, onModelSettings, seed }: { onUse: (practice: PreparedPractice) => void; onModelSettings: () => void; seed?: PreparationSeed }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(() => initialState(seed));
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const { form, draft } = page;
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const settings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings, enabled: identity.isSuccess });
  useEffect(() => { setStorageFailed(!writeSession(storageKey, JSON.stringify(page))); }, [page]);
  const generate = useMutation({
    mutationFn: api.prepare,
    onSuccess: (result, request) => {
      setPage(current => ({ ...current, draft: { input: request.input, result, cards: result.questions.map(question => ({ requestId: crypto.randomUUID(), draft: preparationBankDraft(request.input, question, result.requirements), selected: true, savedId: null })) } }));
      setNotice(`已生成 ${result.questions.length} 道题。检查题面与回答要点后再保存。`);
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
      setNotice(`所选 ${selected.length} 道题已保存到题库。`);
      if (practice) onUse({ input, bankIds: selected.map(card => card.savedId ?? card.requestId) });
    },
  });
  const busy = generate.isPending || save.isPending;
  const ready = identity.isSuccess && settings.data && (settings.data.active || settings.data.mode !== 'disabled');
  const selected = draft?.cards.filter(card => card.selected) ?? [];
  const currentInput = preparationInputSchema.safeParse(form);
  const changed = draft && (!currentInput.success || JSON.stringify(draft.input) !== JSON.stringify(currentInput.data));
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
    generate.mutate({ input: input.data, modelConnectionId: settings.data?.active?.id ?? null });
  }
  function download() {
    if (!draft) return;
    const content = preparationMarkdown(draft.input, draft.result, draft.cards.map(card => card.draft));
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'jd-preparation.md'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="preparation" aria-labelledby="preparation-title">
    <div className="intro"><h1 id="preparation-title">先读懂 JD，再准备每一道题。</h1><p>提取岗位能力要求，提前查看问题、追问与回答要点。可以只填 JD，简历留到正式练习时补充。</p></div>
    <form onSubmit={submit} className="preparation-form">
      <label htmlFor="prep-role">备题岗位<Input id="prep-role" required minLength={2} maxLength={120} value={form.role} disabled={busy} onChange={event => changeForm({ role: event.target.value })} placeholder="例如：前端工程师" /></label>
      <label htmlFor="prep-jd">备题 JD<Input.TextArea id="prep-jd" required minLength={20} maxLength={12000} rows={6} value={form.jobDescription} disabled={busy} onChange={event => changeForm({ jobDescription: event.target.value })} placeholder="粘贴完整岗位职责与任职要求，保留必备与优先条件。" /></label>
      <div className="planning-grid">
        <label htmlFor="prep-level">备题级别<Select id="prep-level" value={form.candidateLevel} disabled={busy} onChange={value => changeForm({ candidateLevel: preparationInputSchema.shape.candidateLevel.parse(value) })} options={[{ value: 'intern', label: '实习' }, { value: 'new_grad', label: '校招' }, { value: 'experienced', label: '社招' }]} /></label>
        <label htmlFor="prep-round">备题轮次<Select id="prep-round" value={form.round} disabled={busy} onChange={value => changeForm({ round: preparationInputSchema.shape.round.parse(value) })} options={[{ value: 'first', label: '一面' }, { value: 'second', label: '二面' }, { value: 'hr', label: 'HR 面' }]} /></label>
        <label htmlFor="prep-type">备题岗位类型<Select id="prep-type" value={form.roleType} disabled={busy} onChange={value => changeForm({ roleType: preparationInputSchema.shape.roleType.parse(value) })} options={[{ value: 'technical', label: '技术岗' }, { value: 'nontechnical', label: '非技术岗' }]} /></label>
        <label htmlFor="prep-family">备题岗位方向<Select id="prep-family" value={form.roleFamily} disabled={busy} onChange={value => changeForm({ roleFamily: preparationInputSchema.shape.roleFamily.parse(value) })} options={[{ value: 'frontend', label: '前端' }, { value: 'backend', label: '后端' }, { value: 'fullstack', label: '全栈' }, { value: 'data', label: '数据与算法' }, { value: 'embedded', label: '嵌入式' }, { value: 'qa', label: '测试' }, { value: 'general', label: '通用' }]} /></label>
        <label htmlFor="prep-count">预生成题量<InputNumber<number> id="prep-count" min={3} max={12} value={form.questionCount} disabled={busy} onChange={value => { if (value !== null) changeForm({ questionCount: value }); }} /></label>
      </div>
      <label htmlFor="prep-focus">备题重点<Input id="prep-focus" maxLength={1000} value={form.focus} disabled={busy} onChange={event => changeForm({ focus: event.target.value })} placeholder="选填，例如：接口设计、复杂状态、项目追问" /></label>
      <p className="storage-note">仅向所选模型发送本页岗位、JD 与备题参数。当前模型 {settings.data?.active?.model ?? (settings.data?.mode === 'demo' ? '规则演示' : settings.data?.defaultModel || '未配置')}。生成不启用联网搜索。</p>
      <div className="panel-actions"><Button type="primary" htmlType="submit" aria-label={draft ? '重新生成题单' : '根据 JD 生成题单'} loading={generate.isPending} disabled={busy || !ready}>{generate.isPending ? '正在分析 JD 并生成题目…' : draft ? '重新生成题单' : '根据 JD 生成题单'}</Button><Button htmlType="button" disabled={busy} onClick={onModelSettings}>配置备题模型</Button></div>
      {generate.isPending ? <p role="status">正在生成。输入已保留，成功后替换已有题单。</p> : null}
      {validation || generate.error || settings.error ? <p role="alert" className="error">{validation || generate.error?.message || settings.error?.message}</p> : null}
    </form>
    {storageFailed ? <p role="alert" className="error">当前无法保存到本机，请先导出题单并检查数据管理。</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {draft ? <div className="preparation-result">
      <div className="form-heading"><h2>{draft.input.role} · {draft.cards.length} 道备题</h2><Button disabled={busy} onClick={download}>导出备题单</Button></div>
      {draft.result.modelMode === 'demo' ? <p className="demo-banner" role="note">规则演示题单。按 JD 原文与固定模板演示流程，启用模型后可生成更具体的内容。</p> : <p className="session-model">题单生成模型 {draft.result.model}</p>}
      {changed ? <p role="note">输入已修改。下方仍是上次生成的题单，保存与练习使用下方题单的原始参数。</p> : null}
      <div className="requirement-list" aria-label="JD 能力要求">{draft.result.requirements.map((requirement, index) => <article key={index}><h3>{index + 1}. {requirement.competency} <Tag color={requirement.priority === 'required' ? 'blue' : 'default'}>{requirement.priority === 'required' ? '必备项' : '加分项'}</Tag></h3><label htmlFor={`prep-priority-${index}`}>要求 {index + 1} 分类<Select id={`prep-priority-${index}`} aria-label={`要求 ${index + 1} 分类`} value={requirement.priority} disabled={busy || draft.cards.some((card, i) => Boolean(card.savedId) && draft.result.questions[i]?.requirementIndex === index)} options={[{ value: 'required', label: '必备项' }, { value: 'preferred', label: '加分项' }]} onChange={value => changePriority(index, value)} /></label><blockquote>{requirement.quote}</blockquote></article>)}</div>
      <div className="panel-actions"><Button disabled={busy} onClick={() => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map(card => ({ ...card, selected: true })) } } : current)}>全选题目</Button><Button disabled={busy} onClick={() => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map(card => ({ ...card, selected: false })) } } : current)}>清空选择</Button><span>已选 {selected.length} 道</span></div>
      {draft.cards.map((card, index) => <article className="preparation-card" key={card.requestId}>
        <div className="preparation-card-heading"><Checkbox checked={card.selected} disabled={busy} aria-label={`选择备题 ${index + 1}`} onChange={event => setPage(current => current.draft ? { ...current, draft: { ...current.draft, cards: current.draft.cards.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item) } } : current)}>第 {index + 1} 题</Checkbox><span>{categoryLabels[card.draft.category]} · {difficultyLabels[card.draft.difficulty]} · 对应要求 {(draft.result.questions[index]?.requirementIndex ?? 0) + 1}{card.savedId ? ' · 已入库' : ''}</span></div>
        <label htmlFor={`prep-title-${index}`}>题目 {index + 1} 标题<Input id={`prep-title-${index}`} minLength={2} maxLength={160} value={card.draft.title} disabled={busy} readOnly={Boolean(card.savedId)} onChange={event => changeCard(index, { title: event.target.value })} /></label>
        <label htmlFor={`prep-content-${index}`}>题目 {index + 1} 题面<Input.TextArea id={`prep-content-${index}`} minLength={10} maxLength={3000} rows={3} value={card.draft.content} disabled={busy} readOnly={Boolean(card.savedId)} onChange={event => changeCard(index, { content: event.target.value })} /></label>
        <details><summary>{card.savedId ? '回答要点与追问' : '回答要点与追问，可编辑'}</summary><label htmlFor={`prep-answer-${index}`}>题目 {index + 1} 回答要点<Input.TextArea id={`prep-answer-${index}`} maxLength={8000} rows={6} value={card.draft.expectedAnswer} disabled={busy} readOnly={Boolean(card.savedId)} onChange={event => changeCard(index, { expectedAnswer: event.target.value })} /></label></details>
      </article>)}
      <div className="preparation-actions"><p>保存后可在题库继续编辑。带入练习会选用严格模式，并保留已有简历草稿。实际题量仍按时长与环节估算。</p><div className="panel-actions"><Button aria-label="保存所选到题库" loading={save.isPending} disabled={busy || !selected.length || selected.some(card => !bankDraftSchema.safeParse(card.draft).success)} onClick={() => save.mutate(false)}>保存所选到题库</Button><Button type="primary" aria-label="保存并带入练习" loading={save.isPending} disabled={busy || !selected.length || selected.some(card => !bankDraftSchema.safeParse(card.draft).success)} onClick={() => save.mutate(true)}>保存并带入练习</Button></div>{save.error ? <p role="alert" className="error">{save.error.message}。未确认成功时可重试相同题目。</p> : null}</div>
    </div> : <p className="context-note">题单会自动保存在本机。题目保存后属于当前浏览器身份。</p>}
  </section>;
}
