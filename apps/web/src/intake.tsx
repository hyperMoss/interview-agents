import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Step, Stepper } from '@astryxdesign/core/Stepper';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useQuery } from '@tanstack/react-query';
import { createInterviewSchema, type InterviewInput } from '../../../packages/contracts/src/index';
import { workspaceIntakeSchema } from '../../../packages/contracts/src/workspace';
import { searchChoiceSchema } from '../../../packages/contracts/src/search';
import { api } from './api';
import { readSession, writeSession } from './storage';
import { readProfiles, saveProfiles } from './personal-data';
import { resumeText } from '../../../packages/resume/src/import';
import { ResumeUpload } from './resume-upload';
import { defaultPlanning, PlanningFields, PlanSummary } from './planning-panel';
import { associateSelectedBank, preparationFingerprint, preparationOffer, rememberPreparationDecision, type PreparationDecision } from './preparation-handoff';
import { categoryLabels, difficultyLabels } from './labels';
import { ModelModeTag, describeRuntimeMode } from './model-mode-tag';
import type { PreparationSeed } from './preparation-panel';
import { ConfirmAction } from './ui/confirm-action';
import { Stack } from '@astryxdesign/core/Stack';

function intakeLevel(planning: typeof defaultPlanning | undefined) {
  const candidate = (planning ?? defaultPlanning).candidateLevel;
  return candidate === 'intern' ? 'junior' as const : candidate === 'experienced' ? 'senior' as const : 'mid' as const;
}
function handoffMaterial(value: { role: string; jobDescription: string; planning?: typeof defaultPlanning }) {
  const planning = value.planning ?? defaultPlanning;
  return { role: value.role, jobDescription: value.jobDescription, level: intakeLevel(planning), round: planning.round, roleFamily: planning.roleFamily, roleType: planning.roleType };
}
function restoreIntake() {
  try {
    const parsed = workspaceIntakeSchema.parse(JSON.parse(readSession('interview-intake') ?? 'null'));
    const handoff = associateSelectedBank({ ...handoffMaterial(parsed), bankIds: parsed.planning?.bankIds ?? [], handoff: parsed.preparationHandoff });
    return handoff === parsed.preparationHandoff ? parsed : { ...parsed, preparationHandoff: handoff };
  } catch { return { role: '', resume: '', jobDescription: '', level: 'mid' as const, questionCount: 6, focus: '', planning: defaultPlanning }; }
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
  const [handoffOpen, setHandoffOpen] = useState(false);
  const step = form.step ?? 0;
  const planning = form.planning ?? defaultPlanning;
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const resumes = useQuery({ queryKey: ['resume-drafts'], queryFn: api.resumeDrafts, enabled: identity.isSuccess });
  const [resumeLoading, setResumeLoading] = useState(false);
  const bank = useQuery({ queryKey: ['question-bank'], queryFn: api.bankList, enabled: identity.isSuccess });
  const search = useQuery({ queryKey: ['search-settings'], queryFn: api.searchSettings, enabled: identity.isSuccess });
  const modelSettings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings, enabled: identity.isSuccess });
  const preview = useQuery({ queryKey: ['plan-preview', planning], queryFn: () => api.previewPlan(planning), enabled: identity.isSuccess });
  const count = Math.max(1, preview.data?.totalQuestions ?? form.questionCount);
  const level: InterviewInput['level'] = intakeLevel(planning);
  const material = handoffMaterial(form);
  const preparationSeed: PreparationSeed = { role: form.role, jobDescription: form.jobDescription, focus: form.focus, candidateLevel: planning.candidateLevel, round: planning.round, roleType: planning.roleType, roleFamily: planning.roleFamily, questionCount: Math.max(3, Math.min(12, count)) };
  function handoffDecision() {
    return preparationOffer({ ...material, detailsValid: true, bankIds: planning.bankIds, handoff: form.preparationHandoff });
  }
  function rememberHandoff(decision: PreparationDecision) {
    const next = { ...form, preparationHandoff: rememberPreparationDecision(form.preparationHandoff, { fingerprint: preparationFingerprint(material), decision }) };
    writeSession('interview-intake', JSON.stringify({ ...next, level, questionCount: count }));
    setForm(next);
  }
  function continueWithoutPreparation() {
    rememberHandoff('skipped'); setHandoffOpen(false); edit({ step: 1 }); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function startPreparation() {
    rememberHandoff('opened'); setHandoffOpen(false); onPreparation(preparationSeed);
  }
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
    if (step === 0 && handoffDecision() === 'offer') { setHandoffOpen(true); return; }
    if (step === 1 && (!preview.data || preview.isFetching || preview.error)) { showFieldError('请等待面试计划就绪，或按提示调整安排。'); return; }
    edit({ step: step === 0 ? 1 : 2 });
    window.scrollTo({ top: 0, behavior: 'instant' });
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
    <div className="intro"><div className="intro-heading"><h1>准备好资料，再开始这一场。</h1><ModelModeTag badge={describeRuntimeMode({ data: modelSettings.data, pending: modelSettings.isPending, failed: modelSettings.isError })} /></div><p>先选岗位和经历，再确认面试安排。资料会自动保存在本机。</p></div>
    <details className="profile-manager"><summary>复用岗位资料档案 · {profiles.length} 份</summary>
      <Selector id="profile-picker" label="选择已存档案" value={profileId} placeholder="选择岗位资料" options={profiles.map(profile => ({ value: profile.id, label: profile.name }))} onChange={id => {
        const profile = profiles.find(item => item.id === id);
        if (profile) {
          const handoff = associateSelectedBank({ ...handoffMaterial(profile.input), bankIds: profile.input.planning?.bankIds ?? [], handoff: undefined });
          setProfileId(id); setProfileName(profile.name); setForm({ ...profile.input, step: 0, ...(handoff ? { preparationHandoff: handoff } : {}) }); setNotice('已带入档案。修改不会影响历史面试。');
        }
      }} />
      <TextInput id="profile-name" label="档案名称" value={profileName} onChange={value => setProfileName(value.slice(0, 120))} placeholder="例如：后端校招 · 目标公司" />
      <div className="panel-actions"><Button label="保存当前资料" onClick={() => saveProfile(false)} /><Button label="另存一份" onClick={() => saveProfile(true)} /><ConfirmAction title="删除这份资料档案？" description="只删除本机档案，当前表单和历史面试保留。" okText="删除档案" cancelText="保留" disabled={!profileId} onConfirm={() => {
        const remaining = profiles.filter(profile => profile.id !== profileId); saveProfiles(remaining); setProfiles(remaining); setProfileId(undefined); setProfileName(''); setNotice('档案已删除，当前表单保留。');
      }}><Button label="删除档案" variant="destructive" isDisabled={!profileId} /></ConfirmAction></div>
    </details>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="resume-library-choice"><Selector id="interview-library-resume" label="从简历库选择" placeholder="选择已保存的 JSON 简历" isLoading={resumes.isPending || resumeLoading} isDisabled={pending || resumeLoading} options={resumes.data?.map(item => ({ value: item.id, label: item.label })) ?? []} onChange={async id => { setResumeLoading(true); try { const draft = await api.resumeDraft(id); const text = resumeText(draft.document); if (text.length < 20 || text.length > 16000) { setNotice('这份简历文本需 20–16000 字，请先到简历库整理；当前输入已保留。'); return; } edit({ resume: text, role: form.role || draft.document.title }); setNotice('已带入简历快照，修改不会影响简历库。'); } catch (error) { setNotice(error instanceof Error ? error.message : '简历读取失败，请重试。'); } finally { setResumeLoading(false); } }} /><p>在简历模块管理副本，这里选择一份简历并填写本次面试的岗位与 JD。</p>{resumes.error ? <Button label="重试读取简历库" onClick={() => void resumes.refetch()} /> : null}</div>
    <Stepper className="intake-steps" activeStep={step} label="准备练习步骤"><Step step={0} label="填写资料" /><Step step={1} label="面试安排" /><Step step={2} label="确认开始" /></Stepper>
    <form onSubmit={submit} noValidate>
      {step === 0 ? <>
        <div className="form-heading"><h2>准备练习资料</h2><ConfirmAction title="填入演示资料？" description="会替换当前岗位、简历与 JD，已保存档案不变。" disabled={!form.resume && !form.jobDescription} okText="填入示例" confirmVariant="primary" cancelText="保留资料" onConfirm={() => edit({ role: 'Web 全栈工程师', resume: '示例经历：负责一个 React 与 NestJS 项目，设计接口和数据库，完成任务队列、权限校验与自动化测试。', jobDescription: '示例岗位：熟悉 TypeScript、React、Node.js 和 PostgreSQL，能解释技术方案与性能优化，重视跨团队协作。' })}><Button variant="ghost" type="button" label="填入示例" onClick={() => { if (!form.resume && !form.jobDescription) edit({ role: 'Web 全栈工程师', resume: '示例经历：负责一个 React 与 NestJS 项目，设计接口和数据库，完成任务队列、权限校验与自动化测试。', jobDescription: '示例岗位：熟悉 TypeScript、React、Node.js 和 PostgreSQL，能解释技术方案与性能优化，重视跨团队协作。' }); }} /></ConfirmAction></div>
        <TextInput id="intake-role" label="目标岗位" aria-label="目标岗位" isRequired value={form.role} onChange={value => edit({ role: value.slice(0, 120) })} placeholder="例如：Web 全栈工程师" />
        <ResumeUpload onUse={resume => edit({ resume })} />
        <TextArea id="intake-resume" label="简历与项目经历" aria-label="简历与项目经历" isRequired maxLength={16000} value={form.resume} onChange={value => edit({ resume: value })} rows={5} placeholder="你实际负责的项目、行动与结果" /><small>{form.resume.length} / 16000 字</small>
        <TextArea id="intake-jd" label="岗位描述 / JD" aria-label="岗位描述 / JD" isRequired maxLength={12000} value={form.jobDescription} onChange={value => edit({ jobDescription: value })} rows={4} placeholder="岗位职责和任职要求" />
        <Button type="button" label="根据 JD 提前备题" onClick={startPreparation} />
        <TextInput id="intake-focus" label="本次练习重点（选填）" value={form.focus} onChange={value => edit({ focus: value.slice(0, 1000) })} placeholder="例如：系统设计、项目细节或表达结构" />
      </> : null}
      {step === 1 ? <>
        <h2>确认面试安排</h2><PlanningFields options={planning} onChange={value => edit({ planning: value })} />
        <details className="bank-selection"><summary>高级选项 · 选择题库与联网资料</summary><p>不勾选题目时使用全部可用题目。岗位、难度与时长仍会筛选题量。</p><Button label="管理或导入题目" onClick={onBankSettings} /><Button label="使用全部可用题目" onClick={() => edit({ planning: { ...planning, bankIds: [] } })} />
          <div className="bank-options">{bank.data?.filter(question => question.category !== 'intro' && question.category !== 'reverse').map(question => <CheckboxInput key={question.id} label={question.title} description={`${categoryLabels[question.category]} · ${difficultyLabels[question.difficulty]}`} value={planning.bankIds.includes(question.id)} onChange={checked => edit({ planning: { ...planning, bankIds: checked ? [...planning.bankIds, question.id] : planning.bankIds.filter(id => id !== question.id) } })} />)}</div>
          {bank.error ? <p role="alert">{bank.error.message}</p> : null}
          <CheckboxInput label="本场启用联网搜索" value={form.searchEnabled ?? false} isDisabled={!search.data?.active} onChange={checked => edit({ searchEnabled: checked })} /><Button label="配置搜索连接" onClick={onSearchSettings} />
          {form.searchEnabled ? <TextInput id="intake-search-query" label="确认搜索关键词" value={form.searchQuery || `${form.role} 岗位公开资料`} onChange={value => edit({ searchQuery: value.slice(0, 200) })} /> : null}
          <p className="storage-note">只发送确认的关键词，不自动发送简历、JD 或答案。</p>
        </details>
      </> : null}
      {step === 2 ? <><h2>确认这场练习</h2><div className="confirmation-summary"><h3>{form.role}</h3><p>简历 {form.resume.length} 字 · JD {form.jobDescription.length} 字</p><p>{form.searchEnabled ? `联网关键词：${form.searchQuery || `${form.role} 岗位公开资料`}` : '本场不使用联网搜索'}</p><p>提交后使用当前启用的模型与题库快照。模型失败时保留回答，可检查连接后重试。</p></div></> : null}
      {step > 0 && preview.data ? <PlanSummary plan={preview.data} /> : null}
      {preview.error && step > 0 ? <p role="alert" className="error">{preview.error.message}<Button label="重试读取计划" onClick={() => void preview.refetch()} /></p> : null}
      <div className="form-footer">{step > 0 ? <Button label="上一步" onClick={() => edit({ step: step === 2 ? 1 : 0 })} /> : <span>保存到本机，不自动发送资料。</span>}
        <Button variant="primary" type="submit" label={pending ? '正在创建…' : step === 2 ? '开始练习' : '下一步'} isDisabled={pending || (step === 2 && (!ready || preview.isFetching || !preview.data?.remainingQuestions))} />
      </div>
      {validation || error ? <p role="alert" className="error">{validation || error}</p> : null}
    </form>
    <Dialog isOpen={handoffOpen} onOpenChange={open => { if (!open) setHandoffOpen(false); }} purpose="form" width={460}>
      <Layout
        header={<DialogHeader title="先根据 JD 备题？" onOpenChange={() => setHandoffOpen(false)} />}
        content={<LayoutContent>
          <p>资料已填写完成，还没有选择题库题目。可以先根据这份 JD 备题，再带入练习；也可以直接继续安排面试。</p>
          <p className="storage-note">备题只在备题页确认后生成，不会自动调用模型；简历、JD、规划与草稿都会保留。</p>
        </LayoutContent>}
        footer={<LayoutFooter hasDivider>
          <Stack direction="horizontal" gap={2} wrap="wrap" justify="end">
            <Button type="button" label="取消" onClick={() => setHandoffOpen(false)} />
            <Button type="button" label="直接继续" onClick={continueWithoutPreparation} />
            <Button type="button" variant="primary" label="先备题" onClick={startPreparation} />
          </Stack>
        </LayoutFooter>}
      />
    </Dialog>
  </section>;
}
