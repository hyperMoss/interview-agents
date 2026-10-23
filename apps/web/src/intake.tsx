import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Checkbox, Input, Popconfirm, Select, Steps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { createInterviewSchema, type InterviewInput } from '../../../packages/contracts/src/index';
import { workspaceIntakeSchema } from '../../../packages/contracts/src/workspace';
import { searchChoiceSchema } from '../../../packages/contracts/src/search';
import { api } from './api';
import { readSession, writeSession } from './storage';
import { readProfiles, saveProfiles } from './personal-data';
import { ResumeUpload } from './resume-upload';
import { defaultPlanning, PlanningFields, PlanSummary } from './planning-panel';
import { categoryLabels, difficultyLabels } from './labels';
import type { PreparationSeed } from './preparation-panel';

function restoreIntake() {
  try { return workspaceIntakeSchema.parse(JSON.parse(readSession('interview-intake') ?? 'null')); }
  catch { return { role: '', resume: '', jobDescription: '', level: 'mid' as const, questionCount: 6, focus: '', planning: defaultPlanning }; }
}
export function Intake({ pending, ready, error, onCreate, onSearchSettings, onBankSettings, onPreparation }: {
  pending: boolean; ready: boolean; error?: string;
  onCreate: (input: InterviewInput, search: ReturnType<typeof searchChoiceSchema.parse>) => void;
  onSearchSettings: () => void; onBankSettings: () => void; onPreparation: (seed: PreparationSeed) => void;
}) {
  const [form, setForm] = useState(restoreIntake);
  const [profiles, setProfiles] = useState(readProfiles);
  const [profileId, setProfileId] = useState<string>();
  const [profileName, setProfileName] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const step = form.step ?? 0;
  const planning = form.planning ?? defaultPlanning;
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const bank = useQuery({ queryKey: ['question-bank'], queryFn: api.bankList, enabled: identity.isSuccess });
  const search = useQuery({ queryKey: ['search-settings'], queryFn: api.searchSettings, enabled: identity.isSuccess });
  const preview = useQuery({ queryKey: ['plan-preview', planning], queryFn: () => api.previewPlan(planning), enabled: identity.isSuccess });
  const count = Math.max(1, preview.data?.totalQuestions ?? form.questionCount);
  const level: InterviewInput['level'] = planning.candidateLevel === 'intern' ? 'junior' : planning.candidateLevel === 'experienced' ? 'senior' : 'mid';
  useEffect(() => { writeSession('interview-intake', JSON.stringify({ ...form, level, questionCount: count })); }, [form, level, count]);
  function edit(patch: Partial<typeof form>) { setForm(current => ({ ...current, ...patch })); setValidation(''); }
  function showFieldError(message: string, id?: string) {
    setValidation(message);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  function validateDetails() {
    const fields = [{ key: 'role', id: 'intake-role', min: 2, max: 120, name: '岗位' }, { key: 'resume', id: 'intake-resume', min: 20, max: 16000, name: '简历' }, { key: 'jobDescription', id: 'intake-jd', min: 20, max: 12000, name: 'JD' }] as const;
    for (const field of fields) if (form[field.key].trim().length < field.min || form[field.key].length > field.max) {
      showFieldError(`${field.name}需 ${field.min} 至 ${field.max} 字。`, field.id); return false;
    }
    return true;
  }
  function next() {
    if (step === 0 && !validateDetails()) return;
    if (step === 1 && (!preview.data || preview.isFetching || preview.error)) { showFieldError('请等待面试计划就绪，或按提示调整安排。'); return; }
    edit({ step: step === 0 ? 1 : 2 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 2) { next(); return; }
    const input = createInterviewSchema.safeParse({ role: form.role, resume: form.resume, jobDescription: form.jobDescription, focus: form.focus, planning, questionCount: count, level });
    if (!input.success) { edit({ step: 0 }); showFieldError('请检查资料中的必填项。'); return; }
    const choice = searchChoiceSchema.safeParse(form.searchEnabled ? { kind: 'on', connectionId: search.data?.active?.id, query: form.searchQuery || `${form.role} 岗位公开资料` } : { kind: 'off' });
    if (!choice.success) { edit({ step: 1 }); showFieldError('先配置搜索连接，并确认 2 至 200 字的查询。'); return; }
    onCreate(input.data, choice.data);
  }
  function saveProfile(copy: boolean) {
    const name = profileName.trim() || form.role.trim();
    if (!name) { setNotice('先填写档案名称或岗位。'); return; }
    const id = !copy && profileId ? profileId : crypto.randomUUID();
    if (!profiles.some(profile => profile.id === id) && profiles.length >= 50) { setNotice('最多保存 50 份资料档案，请先删除不需要的档案。'); return; }
    const input = { role: form.role, resume: form.resume, jobDescription: form.jobDescription, level, questionCount: count, focus: form.focus, planning };
    const updated = [...profiles.filter(profile => profile.id !== id), { id, name: name.slice(0, 120), input, updatedAt: new Date().toISOString() }];
    saveProfiles(updated); setProfiles(updated); setProfileId(id); setProfileName(name); setNotice('岗位资料已保存到本机，可在下次练习中复用。');
  }
  return <section className="intake">
    <div className="intro"><h1>准备好资料，再开始这一场。</h1><p>先选岗位和经历，再确认面试安排。资料会自动保存在本机。</p></div>
    <details className="profile-manager"><summary>复用岗位资料档案 · {profiles.length} 份</summary>
      <label htmlFor="profile-picker">选择已存档案</label><Select id="profile-picker" value={profileId} placeholder="选择岗位资料" options={profiles.map(profile => ({ value: profile.id, label: profile.name }))} onChange={id => {
        const profile = profiles.find(item => item.id === id);
        if (profile) { setProfileId(id); setProfileName(profile.name); setForm({ ...profile.input, step: 0 }); setNotice('已带入档案。修改不会影响历史面试。'); }
      }} />
      <label htmlFor="profile-name">档案名称</label><Input id="profile-name" maxLength={120} value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="例如：后端校招 · 目标公司" />
      <div className="panel-actions"><Button onClick={() => saveProfile(false)}>保存当前资料</Button><Button onClick={() => saveProfile(true)}>另存一份</Button><Popconfirm title="删除这份资料档案？" description="只删除本机档案，当前表单和历史面试保留。" okText="删除档案" cancelText="保留" onConfirm={() => {
        const remaining = profiles.filter(profile => profile.id !== profileId); saveProfiles(remaining); setProfiles(remaining); setProfileId(undefined); setProfileName(''); setNotice('档案已删除，当前表单保留。');
      }}><Button danger disabled={!profileId}>删除档案</Button></Popconfirm></div>
    </details>
    {notice ? <p role="status">{notice}</p> : null}
    <Steps className="intake-steps" current={step} size="small" items={[{ title: '填写资料' }, { title: '面试安排' }, { title: '确认开始' }]} />
    <form onSubmit={submit} noValidate>
      {step === 0 ? <>
        <div className="form-heading"><h2>准备练习资料</h2><Popconfirm title="填入演示资料？" description="会替换当前岗位、简历与 JD，已保存档案不变。" disabled={!form.resume && !form.jobDescription} okText="填入示例" cancelText="保留资料" onConfirm={() => edit({ role: 'Web 全栈工程师', resume: '示例经历：负责一个 React 与 NestJS 项目，设计接口和数据库，完成任务队列、权限校验与自动化测试。', jobDescription: '示例岗位：熟悉 TypeScript、React、Node.js 和 PostgreSQL，能解释技术方案与性能优化，重视跨团队协作。' })}><Button htmlType="button" type="text" onClick={() => { if (!form.resume && !form.jobDescription) edit({ role: 'Web 全栈工程师', resume: '示例经历：负责一个 React 与 NestJS 项目，设计接口和数据库，完成任务队列、权限校验与自动化测试。', jobDescription: '示例岗位：熟悉 TypeScript、React、Node.js 和 PostgreSQL，能解释技术方案与性能优化，重视跨团队协作。' }); }}>填入示例</Button></Popconfirm></div>
        <label htmlFor="intake-role">目标岗位<Input id="intake-role" maxLength={120} value={form.role} onChange={event => edit({ role: event.target.value })} placeholder="例如：Web 全栈工程师" /></label>
        <ResumeUpload onUse={resume => edit({ resume })} />
        <label htmlFor="intake-resume">简历与项目经历<Input.TextArea id="intake-resume" maxLength={16000} value={form.resume} onChange={event => edit({ resume: event.target.value })} rows={5} placeholder="你实际负责的项目、行动与结果" /></label><small>{form.resume.length} / 16000 字</small>
        <label htmlFor="intake-jd">岗位描述 / JD<Input.TextArea id="intake-jd" maxLength={12000} value={form.jobDescription} onChange={event => edit({ jobDescription: event.target.value })} rows={4} placeholder="岗位职责和任职要求" /></label>
        <Button htmlType="button" onClick={() => onPreparation({ role: form.role, jobDescription: form.jobDescription, focus: form.focus, candidateLevel: planning.candidateLevel, round: planning.round, roleType: planning.roleType, roleFamily: planning.roleFamily, questionCount: Math.max(3, Math.min(12, count)) })}>根据 JD 提前备题</Button>
        <label htmlFor="intake-focus">本次练习重点（选填）<Input id="intake-focus" maxLength={1000} value={form.focus} onChange={event => edit({ focus: event.target.value })} placeholder="例如：系统设计、项目细节或表达结构" /></label>
      </> : null}
      {step === 1 ? <>
        <h2>确认面试安排</h2><PlanningFields options={planning} onChange={value => edit({ planning: value })} />
        <details className="bank-selection"><summary>高级选项 · 选择题库与联网资料</summary><p>不勾选题目时使用全部可用题目。岗位、难度与时长仍会筛选题量。</p><Button onClick={onBankSettings}>管理或导入题目</Button><Button onClick={() => edit({ planning: { ...planning, bankIds: [] } })}>使用全部可用题目</Button>
          <div className="bank-options">{bank.data?.filter(question => question.category !== 'intro' && question.category !== 'reverse').map(question => <Checkbox key={question.id} checked={planning.bankIds.includes(question.id)} onChange={event => edit({ planning: { ...planning, bankIds: event.target.checked ? [...planning.bankIds, question.id] : planning.bankIds.filter(id => id !== question.id) } })}>{question.title}<small>{categoryLabels[question.category]} · {difficultyLabels[question.difficulty]}</small></Checkbox>)}</div>
          {bank.error ? <p role="alert">{bank.error.message}</p> : null}
          <Checkbox checked={form.searchEnabled ?? false} disabled={!search.data?.active} onChange={event => edit({ searchEnabled: event.target.checked })}>本场启用联网搜索</Checkbox><Button onClick={onSearchSettings}>配置搜索连接</Button>
          {form.searchEnabled ? <label htmlFor="intake-search-query">确认搜索关键词<Input id="intake-search-query" maxLength={200} value={form.searchQuery || `${form.role} 岗位公开资料`} onChange={event => edit({ searchQuery: event.target.value })} /></label> : null}
          <p className="storage-note">只发送确认的关键词，不自动发送简历、JD 或答案。</p>
        </details>
      </> : null}
      {step === 2 ? <><h2>确认这场练习</h2><div className="confirmation-summary"><h3>{form.role}</h3><p>简历 {form.resume.length} 字 · JD {form.jobDescription.length} 字</p><p>{form.searchEnabled ? `联网关键词：${form.searchQuery || `${form.role} 岗位公开资料`}` : '本场不使用联网搜索'}</p><p>提交后使用当前启用的模型与题库快照。模型失败时保留回答，可检查连接后重试。</p></div></> : null}
      {step > 0 && preview.data ? <PlanSummary plan={preview.data} /> : null}
      {preview.error && step > 0 ? <p role="alert" className="error">{preview.error.message}<Button onClick={() => void preview.refetch()}>重试读取计划</Button></p> : null}
      <div className="form-footer">{step > 0 ? <Button onClick={() => edit({ step: step === 2 ? 1 : 0 })}>上一步</Button> : <span>保存到本机，不自动发送资料。</span>}
        <Button type="primary" htmlType="submit" disabled={pending || (step === 2 && (!ready || preview.isFetching || !preview.data?.remainingQuestions))}>{pending ? '正在创建…' : step === 2 ? '开始练习' : '下一步'}</Button>
      </div>
      {validation || error ? <p role="alert" className="error">{validation || error}</p> : null}
    </form>
  </section>;
}
