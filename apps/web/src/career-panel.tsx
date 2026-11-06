import { continueApprovedContacts } from './contact-continuation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, InputNumber, Popconfirm, Select, Spin, Switch, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAREER_MAX_BATCH_ITEMS, CAREER_MAX_POSTINGS, careerApprovalSchema, careerPostingPatchSchema, careerTaskCreateSchema,
  type BossSessionView, type CareerBatchItemView, type CareerTaskPostingView, type CareerTaskState, type CareerTaskView,
} from '../../../packages/contracts/src/career';
import { personalizedPreparationPatchSchema, type PersonalizedQuestion } from '../../../packages/contracts/src/preparation';
import type { z } from 'zod';
import type { roleFamilySchema } from '../../../packages/contracts/src/bank';
import { api, ApiError, type CareerPreparationView } from './api';
import {
  actionLabels, approvalBlockers, approvalItems, approvalWarnings, attachmentStateLabels, batchItemActions, batchOutcome, batchStateLabels,
  conversationStateLabels, dispositionLabels, engineLabels, fieldLabels, formatSalary, gapBasisLabel, greetingProblem, groupPostings,
  matchCoverage, pauseLabels, phaseLabels, postingGroup, preparationStatusLabels, preparationSummary, purposeLabels, reasonLabels, sessionGuidance,
  sessionStateLabels, shortHash, taskWarning, type BatchItemAction, type CareerDisposition,
} from './career-view';
import { openResumeOriginal, saveBlob } from './resume-library';
import type { Route } from './navigation';
import './career.css';

export type CareerPracticeSeed = { role: string; resume: string; jobDescription: string; roleFamily: z.infer<typeof roleFamilySchema>; bankIds: string[] };

const STAGE_TEXT_LIMITS = { resume: 16000, jobDescription: 12000 } as const;
const ACCOUNT_NOTE = '手机可以查看状态、审批与恢复，但登录、扫码与人机验证必须在本机电脑的浏览器窗口完成。';
const SEND_NOTE = '本应用不会自动回复招聘方，也不会绕过验证码或站点限制。';

function requestId() {
  return crypto.randomUUID();
}
function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚未记录';
}
function toggle<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

// Tag colours are the only place a disposition becomes visual; the label text carries the meaning.
const dispositionColors: Record<CareerDisposition, string> = { eligible: 'green', needs_review: 'orange', excluded: 'default' };
function TaskStateTag({ state }: { state: CareerTaskState }) {
  if (state.status === 'active') return <Tag color="processing">{phaseLabels[state.phase]}</Tag>;
  if (state.status === 'paused') return <Tag color="orange">已暂停 · {pauseLabels[state.reason]}</Tag>;
  if (state.status === 'failed') return <Tag color="red">生成或读取失败</Tag>;
  return <Tag>已取消</Tag>;
}

function useSession() {
  return useQuery({
    queryKey: ['career-session'], queryFn: api.bossSession,
    refetchInterval: query => query.state.data && ['starting', 'clearing'].includes(query.state.data.state) ? 2000 : false,
  });
}
function useCareerTask(taskId: string) {
  return useQuery({
    queryKey: ['career-task', taskId], queryFn: () => api.careerTask(taskId),
    refetchInterval: query => query.state.data?.state.status === 'active' && query.state.data.state.phase !== 'review' ? 2000 : false,
  });
}

function SessionActions({ session, busy }: { session: BossSessionView | undefined; busy: boolean }) {
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['career-session'] });
    void cache.invalidateQueries({ queryKey: ['career-tasks'] });
    void cache.invalidateQueries({ queryKey: ['career-task'] });
    void cache.invalidateQueries({ queryKey: ['career-batch'] });
  };
  const open = useMutation({ mutationFn: () => api.openBossSession({ requestId: requestId() }), onSuccess: refresh, onError: (failure: Error) => setError(failure.message) });
  const check = useMutation({ mutationFn: () => api.checkBossSession({ requestId: requestId() }), onSuccess: refresh, onError: (failure: Error) => setError(failure.message) });
  const clear = useMutation({ mutationFn: () => api.clearBossSession({ requestId: requestId(), confirmed: true }), onSuccess: refresh, onError: (failure: Error) => setError(failure.message) });
  const pending = busy || open.isPending || check.isPending || clear.isPending;
  const affected = session?.affectedTaskIds.length ?? 0;
  return <div className="career-actions">
    <Button type="primary" loading={open.isPending} disabled={pending} onClick={() => { setError(''); open.mutate(); }}>
      {session?.state === 'ready' ? '重新打开并聚焦本机浏览器' : '打开 BOSS 登录/验证'}
    </Button>
    <Button loading={check.isPending} disabled={pending} onClick={() => { setError(''); check.mutate(); }}>我已完成，检查会话</Button>
    <Popconfirm
      title="清除本机 BOSS 会话？"
      description={<span>会停止并关闭本应用拥有的浏览器、删除私有会话目录，并暂停{affected ? ` ${affected} 个` : '相关'}进行中的求职任务。下次需要重新登录。已发出的沟通或附件无法撤回。</span>}
      okText="确认清除会话" cancelText="保留会话"
      onConfirm={() => { setError(''); return clear.mutateAsync(); }}
    ><Button danger disabled={pending}>清除 BOSS 会话</Button></Popconfirm>
    {error ? <p role="alert" className="error">{error}</p> : null}
  </div>;
}

function BossSessionCard({ busy = false }: { busy?: boolean }) {
  const session = useSession();
  const current = session.data;
  const guidance = current ? sessionGuidance(current) : null;
  return <div className="career-card career-session" aria-labelledby="career-session-title">
    <div className="form-heading">
      <h2 id="career-session-title">本机 BOSS 会话</h2>
      {current?.automationMode === 'contact' ? <Tag color="blue">允许搜索与仅立即沟通，不追加消息或附件</Tag> : null}
      {current?.automationMode === 'search' ? <Tag color="blue">允许自动搜索，投递已关闭</Tag> : null}
      {current?.automationMode === 'manual' ? <Tag color="blue">仅手动登录与检查，搜索和投递已关闭</Tag> : null}
      <span className="career-status-row">
        {current ? <Tag color={current.state === 'ready' ? 'green' : current.state === 'absent' ? 'default' : 'orange'}>{sessionStateLabels[current.state]}</Tag> : null}
        {current ? <Tag>{engineLabels[current.engine]}</Tag> : null}
        {current?.humanWindow === 'open' ? <Tag color="blue">本机窗口已打开</Tag> : current ? <Tag>无人工窗口</Tag> : null}
      </span>
    </div>
    {session.isPending ? <div role="status" className="career-muted"><Spin size="small" /> 正在读取会话状态…</div> : null}
    {session.isError ? <Alert type="error" showIcon message={`会话状态读取失败：${session.error.message}`} action={<Button onClick={() => void session.refetch()}>重新读取</Button>} /> : null}
    {guidance ? <p className={guidance.tone === 'blocked' ? 'error' : 'career-guidance'} role={guidance.tone === 'blocked' ? 'alert' : 'status'}>{guidance.text}</p> : null}
    {current?.reason ? <p className="career-muted">站点/引擎说明：{current.reason}</p> : null}
    {current?.limitation ? <p className="career-muted">引擎限制：{current.limitation}</p> : null}
    {current ? <dl className="career-facts">
      <div><dt>账号标记</dt><dd>{current.accountMarker ? shortHash(current.accountMarker) : '未识别（需要登录后重新检查）'}</dd></div>
      <div><dt>会话代号</dt><dd>{current.generation}</dd></div>
      <div><dt>最近观测</dt><dd>{dateTime(current.updatedAt)}</dd></div>
    </dl> : null}
    <SessionActions session={current} busy={busy} />
    <p className="storage-note">{ACCOUNT_NOTE} {SEND_NOTE}</p>
  </div>;
}

function ResumePreviewButton({ versionId }: { versionId: string }) {
  const [error, setError] = useState('');
  return <span>
    <Button onClick={() => void openResumeOriginal(versionId).catch((failure: Error) => setError(failure.message))}>预览该版本原始文件</Button>
    {error ? <span role="alert" className="error">{error}</span> : null}
  </span>;
}

// The landing page creates one manually started task and never sends anything by itself.
function CareerLanding({ navigate, openModelSettings, openResumeLibrary }: {
  navigate: (route: Route) => void; openModelSettings: () => void; openResumeLibrary: () => void;
}) {
  const cache = useQueryClient();
  const settings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings });
  const versions = useQuery({ queryKey: ['resume-versions'], queryFn: api.resumeVersions });
  const tasks = useQuery({ queryKey: ['career-tasks'], queryFn: api.careerTasks, refetchInterval:5000 });
  const session = useSession();
  const [resumeVersionId, setResumeVersionId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Array<'fullstack' | 'agent_development'>>(['fullstack', 'agent_development']);
  const [customRoles, setCustomRoles] = useState<string[]>([]);
  const [cities, setCities] = useState<Array<'广州' | '深圳'>>(['广州', '深圳']);
  const [salary, setSalary] = useState(18000);
  const [preferAi, setPreferAi] = useState(true);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [useAi, setUseAi] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  const active = settings.data?.active ?? null;
  const version = versions.data?.find(item => item.id === resumeVersionId) ?? null;
  const create = useMutation({
    mutationFn: (payload: Parameters<typeof api.createCareerTask>[0]) => api.createCareerTask(payload),
    onSuccess: task => {
      void cache.invalidateQueries({ queryKey: ['career-tasks'] });
      navigate({ page: 'career', taskId: task.id });
    },
    onError: (failure: Error) => setError(failure.message),
  });

  function start() {
    setError('');
    const policy = { roleTargets: roles, customRoleKeywords: customRoles, cities, salaryUpperMinCnyMonthly: salary, preferAiApplication: preferAi, companyBlacklistKeywords: blacklist };
    const parsed = careerTaskCreateSchema.safeParse(useAi
      ? { requestId: requestId(), resumeVersionId, modelConnectionId: active?.id ?? null, dataProcessingAcknowledged: acknowledged, policy }
      : { mode: 'preview', requestId: requestId(), policy });
    if (!parsed.success) {
      setError('请选择简历版本与已启用的模型连接，勾选至少一个岗位方向和一个城市，并确认数据处理说明。');
      return;
    }
    create.mutate(parsed.data);
  }
  const blockers = [
    session.data?.automationMode && !['enabled','contact','search'].includes(session.data.automationMode) ? '自动搜索和投递已关闭；当前只允许手动登录与检查。' : '',
    useAi && !active ? '还没有启用自带模型连接。BOSS 求职不使用演示模式。' : '',
    useAi && !versions.data?.length ? '简历库还没有版本，请先上传原始简历。' : useAi && !resumeVersionId ? '请选择本任务固定的简历版本。' : '',
    !roles.length && !customRoles.length ? '至少选择或添加一个岗位方向。' : '',
    !cities.length ? '至少选择一个城市。' : '',
    useAi && !acknowledged ? '请确认已了解数据处理说明。' : '',
  ].filter(Boolean);

  return <section className="career" aria-labelledby="career-title">
    <div className="intro"><h1 id="career-title">本机 BOSS 求职</h1><p>用本机浏览器读取岗位、按硬条件筛选、逐条核对后由你手动批准。读取上限 {CAREER_MAX_POSTINGS} 个不同岗位，一批最多批准 {CAREER_MAX_BATCH_ITEMS} 个。</p></div>
    <BossSessionCard />
    <div className="career-card">
      <div className="form-heading"><h2>AI 个性化（可选）</h2><Button onClick={openResumeLibrary}>打开简历库</Button></div>
      <div className="career-fields"><span>启用 AI 匹配、招呼语与备题</span><Switch checked={useAi} onChange={setUseAi} aria-label="启用 AI 个性化" /></div>
      {!useAi ? <p className="career-muted">先按城市、岗位、薪资和黑名单预览结果，无需简历或模型。开启 AI 后再选择简历与模型连接。</p> : null}
      {useAi ? <>
      {settings.isError ? <Alert type="error" showIcon message={`模型状态读取失败：${settings.error.message}`} action={<Button onClick={() => void settings.refetch()}>重试</Button>} /> : null}
      {settings.data && !active ? <Alert type="warning" showIcon message="需要先在模型设置里启用一个自带模型连接。匹配、招呼语与备题都绑定这个连接，不会回退到演示模式。" action={<Button onClick={openModelSettings}>配置模型</Button>} /> : null}
      {active ? <p className="career-muted">当前模型连接：<strong>{active.model}</strong>（{active.remember ? '长期连接' : '临时连接'}，有效至 {dateTime(active.expiresAt)}）</p> : null}
      {versions.isError ? <Alert type="error" showIcon message={`简历库读取失败：${versions.error.message}`} action={<Button onClick={() => void versions.refetch()}>重试</Button>} /> : null}
      {versions.data && !versions.data.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="简历库还没有版本。上传原始文件后才会出现在这里。" /> : null}
      {versions.data?.length ? <>
        <label htmlFor="career-resume">本任务固定的简历版本（匹配、备题与外发附件都用它）</label>
        <Select
          id="career-resume" placeholder="选择一个已保存版本" value={resumeVersionId} onChange={setResumeVersionId}
          options={versions.data.map(item => ({ value: item.id, label: `${item.label} · ${item.originalName} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}` }))}
        />
        {version ? <div className="resume-pair">
          <div className="resume-pair-head"><strong>{version.label}</strong><span>{version.originalName} · {version.byteSize} 字节 · 原始摘要 {shortHash(version.attachmentSha256)}</span></div>
          <p className="career-muted">提取文本摘要 {shortHash(version.textSha256)}。文本预览：{version.textPreview || '（空）'}</p>
          <div className="panel-actions"><ResumePreviewButton versionId={version.id} /><Button onClick={openResumeLibrary}>在简历库查看完整文本</Button></div>
        </div> : null}
      </> : null}
      </> : null}
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>搜索条件</h2><span className="career-muted">冻结后不会因站点改版而变化；改动条件请新建任务</span></div>
      <fieldset className="career-fields">
        <legend>岗位方向（或）</legend>
        <Checkbox checked={roles.includes('fullstack')} onChange={() => setRoles(toggle(roles, 'fullstack'))}>全栈开发</Checkbox>
        <Checkbox checked={roles.includes('agent_development')} onChange={() => setRoles(toggle(roles, 'agent_development'))}>Agent / AI 应用开发</Checkbox>
      </fieldset>
      <label htmlFor="career-custom-roles">添加自定义方向</label>
      <Select id="career-custom-roles" mode="tags" aria-label="添加自定义岗位方向" value={customRoles} maxCount={6} tokenSeparators={['，',';','；']} placeholder="输入方向后按回车，例如：前端、Python、产品经理" style={{width:'100%'}} onChange={(values:string[])=>setCustomRoles([...new Map(values.map(value=>[value.trim().normalize('NFKC').toLowerCase(),value.trim()])).values()].filter(Boolean))} />
      <p className="career-muted">最多添加 6 个方向，每项 1–40 个字符；按回车添加，点标签上的 × 删除。与上方预设按“或”搜索，标题或 JD 包含任一自定义词即匹配方向，其余条件仍逐条核对。可取消全部预设，只用自定义方向。</p>
      <fieldset className="career-fields">
        <legend>城市（或）</legend>
        <Checkbox checked={cities.includes('广州')} onChange={() => setCities(toggle(cities, '广州'))}>广州</Checkbox>
        <Checkbox checked={cities.includes('深圳')} onChange={() => setCities(toggle(cities, '深圳'))}>深圳</Checkbox>
      </fieldset>
      <label htmlFor="career-salary">月薪区间上限至少（CNY/月，读到岗位后逐条核对）</label>
      <InputNumber<number> id="career-salary" min={1000} max={100000} step={1000} value={salary} onChange={value => { if (value !== null) setSalary(value); }} />
      <p className="storage-note">15–25K 与 18–18K 视为达标，10–15K 不达标；面议、年薪、日薪与“20K 以上”等口径会进入需人工复核，不会自动换算。</p>
      <div className="career-fields"><span>AI 应用方向加分（只在匹配质量相同时作为并列排序依据）</span><Switch checked={preferAi} onChange={setPreferAi} aria-label="AI 应用方向加分" /></div>
      <label htmlFor="career-blacklist">公司黑名单关键词（字面匹配，忽略大小写与全半角；命中即排除并显示原文）</label>
      <Select id="career-blacklist" mode="tags" value={blacklist} onChange={setBlacklist} tokenSeparators={[',', '，', ' ']} maxCount={50}
        placeholder="例如：人才服务、劳务派遣" options={[]} />
      <p className="storage-note">明确外包、驻场或劳务派遣会被排除；雇佣关系未知会进入需复核，不会默认视为直招。</p>
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>开始本机搜索</h2><span className="career-muted">不会自动投递</span></div>
      {session.data && session.data.state !== 'ready' ? <Alert type="info" showIcon message="本机会话尚未就绪。任务会先暂停，完成登录并在会话卡片里检查通过后再手动恢复。" /> : null}
      {useAi ? <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>
        我了解：所选简历的提取文本、读取到的岗位 JD 会发送给当前模型连接 {active?.model ?? '（未启用）'}；原始简历文件只在本机与本机浏览器之间使用。
      </Checkbox> : <p className="storage-note">纯规则预览仅保存岗位信息和筛选依据，不调用模型、不发起沟通或发送简历。</p>}
      <div className="panel-actions"><Button type="primary" loading={create.isPending} disabled={create.isPending || blockers.length > 0} onClick={start}>{create.isPending ? '正在创建任务…' : '开始本机搜索'}</Button></div>
      {blockers.length ? <ul className="career-blockers" aria-label="开始前还需要的条件">{blockers.map(item => <li key={item}>{item}</li>)}</ul> : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>求职任务历史</h2><Button onClick={() => void tasks.refetch()} disabled={tasks.isFetching}>重新读取</Button></div>
      {tasks.isPending ? <p role="status">正在读取任务…</p> : null}
      {tasks.isError ? <Alert type="error" showIcon message={`任务读取失败：${tasks.error.message}`} action={<Button onClick={() => void tasks.refetch()}>重试</Button>} /> : null}
      {tasks.data && !tasks.data.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有求职任务。设置条件后手动开始第一个任务。" /> : null}
      {tasks.data?.length ? <ul className="career-task-list" aria-label="求职任务列表">
        {tasks.data.map(task => <li key={task.id}>
          <button type="button" className="career-task-row" onClick={() => navigate({ page: 'career', taskId: task.id })}>
            <strong>{[...task.policy.roleTargets.map(role => role === 'fullstack' ? '全栈' : 'Agent 开发'), ...(task.policy.customRoleKeywords ?? [])].join(' / ')} · {task.policy.cities.join(' / ')} · ≥{task.policy.salaryUpperMinCnyMonthly} 元/月</strong>
            <span><TaskStateTag state={task.state} /> 读取 {task.readCount}/{CAREER_MAX_POSTINGS} · 可投递 {task.shortlistCount} · 需复核 {task.reviewCount} · 排除 {task.excludedCount} · 已联系 {task.duplicateCount}</span>
            <small>{dateTime(task.createdAt)} · 模型 {task.model?.label ?? '未启用 AI'}{task.batches.length ? ` · ${task.batches.length} 个批次` : ''}</small>
          </button>
        </li>)}
      </ul> : null}
    </div>
    <p className="context-note">这是本机单用户工具：不会导入日常浏览器的登录状态，也不会把岗位数据发到公开经验库。</p>
  </section>;
}

function PostingRow({ posting, selected, onToggle, onOpen }: {
  posting: CareerTaskPostingView; selected: boolean; onToggle: (checked: boolean) => void; onOpen: () => void;
}) {
  const group = postingGroup(posting);
  return <li className="career-posting-row">
    {posting.decision.disposition === 'eligible' && group === 'eligible'
      ? <Checkbox checked={selected} onChange={event => onToggle(event.target.checked)} aria-label={`选择 ${posting.observed.company} ${posting.observed.title}`} />
      : <span className="career-row-spacer" aria-hidden="true" />}
    <button type="button" className="career-posting-open" onClick={onOpen}>
      <strong>{posting.observed.title}</strong>
      <span>{posting.observed.company} · {posting.observed.location || '地点未识别'}</span>
      <small>{posting.observed.salaryRaw} · {dispositionLabels[posting.decision.disposition]}{group === 'contacted' ? '（已联系）' : ''}</small>
      {posting.ownerReview ? <small>你的复核：{posting.ownerReview.decision === 'confirmed_direct' ? '已确认直招' : posting.ownerReview.decision === 'excluded' ? '已排除' : '待定'}</small> : null}
      {posting.preparation ? <small>{preparationStatusLabels[posting.preparation.status]}</small> : null}
    </button>
    <Tag color={group === 'contacted' ? 'purple' : dispositionColors[posting.decision.disposition]}>{group === 'contacted' ? '已联系过' : dispositionLabels[posting.decision.disposition]}</Tag>
  </li>;
}

function Evidence({ posting }: { posting: CareerTaskPostingView }) {
  return <div className="career-evidence">
    <h3>硬条件依据</h3>
    <ul>
      {posting.decision.reasons.map(reason => <li key={`${reason.code}-${reason.evidence[0]?.start ?? 'none'}`}>
        <strong>{reasonLabels[reason.code]}</strong>
        {reason.evidence.length
          ? <ul>{reason.evidence.map(item => <li key={`${item.field}-${item.start}`}><Tag>{fieldLabels[item.field]}</Tag><q>{item.quote}</q></li>)}</ul>
          : <span className="career-muted">（这类判断没有可引用的原文，需要你自己核对）</span>}
      </li>)}
    </ul>
    {posting.decision.blacklistMatches.length ? <div className="career-warnings" role="note">
      <strong>命中的公司黑名单关键词</strong>
      {posting.decision.blacklistMatches.map(match => <p key={`${match.keyword}-${match.start}`}>「{match.keyword}」出现在{fieldLabels[match.field]}：<q>{match.quote}</q></p>)}
    </div> : null}
    <p className="career-muted">薪资解析：{formatSalary(posting.decision)}</p>
    <details>
      <summary>{posting.observed.nativeFilterEvidence.method === 'search_url' ? '搜索请求条件（URL，未验证原生控件）' : '原生筛选证据（读取该岗位时的站点控件）'}</summary>
      <ul>{posting.observed.nativeFilterEvidence.controls.map(control => <li key={`${control.label}-${control.selected}`}>{control.label} = <strong>{control.selected}</strong></li>)}</ul>
      <p className="career-muted">这不是对筛选是否生效的担保：每条岗位都按可见原文重新判定。</p>
    </details>
  </div>;
}

function MatchEvidence({ posting }: { posting: CareerTaskPostingView }) {
  const match = posting.match;
  const coverage = matchCoverage(posting);
  if (!match || !coverage) return <div className="career-evidence">
    <h3>匹配依据</h3>
    <p className="career-muted">该岗位没有模型匹配结果：硬条件判定仍然有效，但没有可展示的匹配证据。这不会让你自动跳过它，也不会自动投递。</p>
  </div>;
  return <div className="career-evidence">
    <h3>匹配依据（不是通过分数线）</h3>
    <p className="career-muted">必备项覆盖 {coverage.requiredSupport}，必备缺口 {coverage.requiredGaps} 项，加分项覆盖 {coverage.preferredSupport}，AI 应用：{match.aiApplication.value === 'yes' ? '有证据' : match.aiApplication.value === 'no' ? '未体现' : '未知'}。</p>
    {match.assessments.map((assessment, index) => <article key={`${assessment.competency}-${index}`} className="career-assessment">
      <h4>{assessment.competency} <Tag>{assessment.priority === 'required' ? '必备' : '加分'}</Tag><Tag color={assessment.kind === 'supported' ? 'green' : assessment.kind === 'gap' ? 'orange' : 'default'}>{assessment.kind === 'supported' ? '有简历证据' : assessment.kind === 'gap' ? '缺口' : '不确定'}</Tag></h4>
      <p>{assessment.kind === 'supported' ? assessment.rationale : assessment.explanation}</p>
      <ul>
        {assessment.jdSources.map(source => <li key={`jd-${source.start}`}><Tag>JD</Tag><q>{source.quote}</q></li>)}
        {assessment.kind === 'supported' ? assessment.resumeSources.map(source => <li key={`resume-${source.start}`}><Tag color="blue">简历</Tag><q>{source.quote}</q></li>) : null}
      </ul>
    </article>)}
    {match.strengths.length ? <p><strong>优势：</strong>{match.strengths.join('；')}</p> : null}
    {match.gaps.length ? <p><strong>缺口：</strong>{match.gaps.join('；')}</p> : null}
    {match.uncertainties.length ? <p><strong>不确定：</strong>{match.uncertainties.join('；')}</p> : null}
    <p className="career-muted">引用只证明来源，不代表整段文字都成立。发送前请自己核对。{match.modelAttribution.model ? ` 生成模型：${match.modelAttribution.model}。` : ''}</p>
  </div>;
}

function GreetingEditor({ task, posting, onUpdated, onReload, onError, onNotice }: {
  task: CareerTaskView; posting: CareerTaskPostingView; onUpdated: (posting: CareerTaskPostingView) => void;
  onReload: () => void; onError: (message: string) => void; onNotice: (message: string) => void;
}) {
  const [text, setText] = useState(posting.greeting?.text ?? '');
  const [request, setRequest] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => { setText(posting.greeting?.text ?? ''); setRequest(null); setConflict(false); }, [posting.id, posting.greetingRevision]);
  const save = useMutation({
    mutationFn: (id: string) => api.patchCareerPosting(task.id, posting.id, careerPostingPatchSchema.parse({ requestId: id, expectedRevision: posting.revision, greetingText: text })),
    onSuccess: updated => { onUpdated(updated); setRequest(null); setConflict(false); onNotice('招呼语草稿已保存。'); },
    onError: (failure: Error) => {
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
      onError(failure.message);
    },
  });
  const problem = greetingProblem(text);
  const saved = posting.greeting?.text ?? '';
  if (posting.decision.disposition !== 'eligible' && !posting.greeting) {
    return <div className="career-evidence">
      <h3>招呼语草稿</h3>
      <p className="career-muted">只有可投递岗位能编辑招呼语；这条记录先处理复核或排除原因。</p>
    </div>;
  }
  return <div className="career-evidence">
    <h3>招呼语草稿（你编辑的文本才是最终发送内容）</h3>
    {posting.greeting ? null : <p className="career-muted">模型没有给这个岗位生成招呼语（例如匹配失败）。你可以手写一条，或先重试生成；发送前仍会逐字确认。</p>}
    <>
      <label htmlFor={`greeting-${posting.id}`}>招呼语（草稿版本 {posting.greetingRevision}）<Input.TextArea id={`greeting-${posting.id}`} rows={6} maxLength={1200} value={text} onChange={event => { setText(event.target.value); setRequest(null); setConflict(false); }} /></label>
      <p className="career-muted">{text.trim().length} / 1200 个字符。{problem ?? '可以保存后继续核对。'}</p>
      <div className="panel-actions"><Button loading={save.isPending} disabled={save.isPending || Boolean(problem) || text.trim() === saved.trim()} onClick={() => save.mutate(request ?? requestId())}>保存招呼语草稿</Button></div>
      {conflict ? <p role="alert" className="error">草稿已在别处更新（可能是另一个页面或重新生成）。你的修改仍保留在这里；请重新读取后再决定。 <Button size="small" onClick={onReload}>重新读取岗位</Button></p> : null}
      {posting.greeting?.factualClaims.length ? <div className="career-claims">
        <strong>招呼语里引用的事实</strong>
        {posting.greeting.factualClaims.map(claim => <article key={claim.claim}>
          <p>{claim.claim}</p>
          <ul>{claim.resumeSources.map(source => <li key={`claim-resume-${source.start}`}><Tag color="blue">简历</Tag><q>{source.quote}</q></li>)}
            {claim.jdSources.map(source => <li key={`claim-jd-${source.start}`}><Tag>JD</Tag><q>{source.quote}</q></li>)}</ul>
        </article>)}
        <p className="career-muted">模型可能写错细节：发送前逐条核对，不要保留你不愿为对方负责的表述。</p>
      </div> : null}
      {posting.greeting?.uncertainties.length ? <p className="career-muted">模型不确定：{posting.greeting.uncertainties.join('；')}</p> : null}
    </>
  </div>;
}

function OwnerReview({ task, posting, onUpdated, onError, onNotice }: {
  task: CareerTaskView; posting: CareerTaskPostingView; onUpdated: (posting: CareerTaskPostingView) => void;
  onError: (message: string) => void; onNotice: (message: string) => void;
}) {
  const [decision, setDecision] = useState<NonNullable<CareerTaskPostingView['ownerReview']>['decision']>(posting.ownerReview?.decision ?? 'unresolved');
  const [note, setNote] = useState(posting.ownerReview?.note ?? '');
  const [source, setSource] = useState(posting.ownerReview?.source ?? '');
  const [request, setRequest] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setDecision(posting.ownerReview?.decision ?? 'unresolved');
    setNote(posting.ownerReview?.note ?? '');
    setSource(posting.ownerReview?.source ?? '');
    setRequest(null);
    setConflict(false);
  }, [posting.id, posting.revision]);
  const save = useMutation({
    mutationFn: (id: string) => api.patchCareerPosting(task.id, posting.id, careerPostingPatchSchema.parse({ requestId: id, expectedRevision: posting.revision, ownerReview: { decision, note, source } })),
    onSuccess: updated => { onUpdated(updated); setRequest(null); setConflict(false); onNotice('复核结果已保存，并按你的证据重新判定。'); },
    onError: (failure: Error) => {
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
      onError(failure.message);
    },
  });
  const needsSource = decision === 'confirmed_direct' && !source.trim();
  return <div className="career-evidence">
    <h3>你的复核（只记录你看到的依据）</h3>
    <p className="career-muted">只有“雇佣关系未知”“地点/薪资口径不清”这类记录可以复核。明确不符合硬条件的岗位不能通过复核放行。</p>
    <label htmlFor={`review-decision-${posting.id}`}>复核结论
      <Select id={`review-decision-${posting.id}`} value={decision} onChange={value => { setDecision(parseOwnerReviewDecision(value)); setRequest(null); }}
        options={[{ value: 'unresolved', label: '保持待定' }, { value: 'confirmed_direct', label: '确认公司直招' }, { value: 'excluded', label: '复核后排除' }]} />
    </label>
    <label htmlFor={`review-source-${posting.id}`}>你看到的依据来源（确认直招时必填）<Input id={`review-source-${posting.id}`} maxLength={200} value={source} onChange={event => { setSource(event.target.value); setRequest(null); }} placeholder="例如：招聘主页“公司直招”原文 / 岗位页公司信息" /></label>
    <label htmlFor={`review-note-${posting.id}`}>复核备注<Input id={`review-note-${posting.id}`} maxLength={600} value={note} onChange={event => { setNote(event.target.value); setRequest(null); }} /></label>
    {needsSource ? <p role="alert" className="error">确认直招必须填写你看到的依据来源。</p> : null}
    {conflict ? <p role="alert" className="error">该岗位记录已被其他操作更新，请重新读取后再提交复核。</p> : null}
    <div className="panel-actions"><Button loading={save.isPending} disabled={save.isPending || needsSource} onClick={() => save.mutate(request ?? requestId())}>提交复核</Button></div>
  </div>;
}
// The owner-review select is a closed enum shared with the API; parse it instead of casting.
function parseOwnerReviewDecision(value: unknown): NonNullable<CareerTaskPostingView['ownerReview']>['decision'] {
  return careerPostingPatchSchema.shape.ownerReview.unwrap().shape.decision.parse(value);
}

function PostingDetail({ task, posting, onUpdated, onReload, onOpenPreparation, onError, onNotice, busy }: {
  task: CareerTaskView; posting: CareerTaskPostingView; onUpdated: (posting: CareerTaskPostingView) => void;
  onReload: () => void; onOpenPreparation: (preparationId: string) => void;
  onError: (message: string) => void; onNotice: (message: string) => void; busy: boolean;
}) {
  const cache = useQueryClient();
  const generate = useMutation({
    mutationFn: () => api.createCareerPreparation(task.id, posting.id),
    onSuccess: preparation => {
      void cache.invalidateQueries({ queryKey: ['career-postings', task.id] });
      onOpenPreparation(preparation.id);
    },
    onError: (failure: Error) => onError(failure.message),
  });
  const reinspect=useMutation({
    mutationFn:()=>api.reinspectCareerPosting(task.id,posting.id),
    onSuccess:()=>onNotice('已提交公司信息核对；不会重搜或投递，完成后点击重新读取查看结果。'),
    onError:(error:Error)=>onError(error.message),
  });
  const group = postingGroup(posting);
  return <article className="career-posting-detail" aria-label={`岗位 ${posting.observed.title} 详情`}>
    <header>
      <h2>{posting.observed.title}</h2>
      <p>{posting.observed.company} · {posting.observed.location || '地点未识别'} · {posting.observed.salaryRaw}</p>
      <p className="career-status-row">
        <Tag color={group === 'contacted' ? 'purple' : dispositionColors[posting.decision.disposition]}>{group === 'contacted' ? '之前已联系过，本任务不能重复发起' : dispositionLabels[posting.decision.disposition]}</Tag>
        <Tag>快照 {shortHash(posting.snapshotHash)}</Tag>
        <Tag>岗位编号 {posting.observed.sitePostingId}</Tag>
      </p>
      <p className="career-muted">岗位链接：<a href={posting.observed.url} target="_blank" rel="noreferrer">在没有登录态的普通浏览器里打开（不会带本应用会话）</a></p>
    </header>
    <details open><summary>岗位原文</summary><pre className="career-jd">{posting.observed.jdText || '（未读到 JD 正文）'}</pre></details>
    <details open><summary>招聘主体与公司原文</summary><pre className="career-jd">{posting.observed.companyProfileText || '（未读到公司说明，不能据此确认直招）'}</pre></details>
    {task.mode==='preview'?<div className="panel-actions"><Button loading={reinspect.isPending} disabled={reinspect.isPending||busy} onClick={()=>reinspect.mutate()}>重新核对公司信息</Button><Button onClick={onReload}>重新读取核对结果</Button></div>:null}
    <Evidence posting={posting} />
    <MatchEvidence posting={posting} />
    {group === 'needs_review' ? <OwnerReview task={task} posting={posting} onUpdated={onUpdated} onError={onError} onNotice={onNotice} /> : null}
    {task.mode !== 'preview' && (posting.decision.disposition === 'eligible' || posting.greeting) ? <GreetingEditor task={task} posting={posting} onUpdated={onUpdated} onReload={onReload} onError={onError} onNotice={onNotice} /> : null}
    <div className="career-evidence">
      <h3>个性化备题</h3>
      {task.mode !== 'personalized' ? <p className="career-muted">此任务未启用 AI，不会自动生成个性化备题。</p> : null}
      {posting.preparation
        ? <p>{preparationStatusLabels[posting.preparation.status]}（版本 {posting.preparation.revision}） <Button size="small" onClick={() => onOpenPreparation(posting.preparation?.id ?? '')}>打开备题</Button></p>
        : <><p className="career-muted">只有在你批准后才会自动生成；这个岗位还没有备题。也可以现在手动生成（不影响外发）。</p>
          <Button loading={generate.isPending} disabled={task.mode !== 'personalized' || busy || generate.isPending} onClick={() => generate.mutate()}>为这个岗位生成 10 道个性化备题</Button></>}
    </div>
  </article>;
}

function PreviewResumeBinding({task}:{task:CareerTaskView}) {
  const cache=useQueryClient();
  const versions=useQuery({queryKey:['resume-versions'],queryFn:api.resumeVersions});
  const [versionId,setVersionId]=useState<string|null>(null);
  const [problem,setProblem]=useState('');
  const [request,setRequest]=useState(()=>requestId());
  const bind=useMutation({
    mutationFn:()=>{if(!versionId)throw new Error('请选择本地简历版本。');return api.bindCareerResume(task.id,{requestId:request,expectedRevision:task.revision,resumeVersionId:versionId});},
    onSuccess:updated=>{cache.setQueryData(['career-task',task.id],updated);void cache.invalidateQueries({queryKey:['career-tasks']});},
    onError:(error:Error)=>setProblem(error.message),
  });
  if(task.mode!=='preview'||task.state.status!=='active'||task.state.phase!=='review')return null;
  return <div className="career-card">
    <h2>用本地简历准备投递（无需 AI）</h2>
    <p>保留这次搜索的岗位与筛选结论，绑定后可手动编辑招呼语并逐岗确认。不重搜、不自动发送。</p>
    <p className="career-muted">这里仅选择本地简历库版本；BOSS 站内已有简历需要单独核对，不能默认视为同一份。</p>
    {versions.isError?<Alert type="error" showIcon message={versions.error.message}/>:null}
    <Select aria-label="绑定本地简历版本" placeholder="选择本地简历库版本" value={versionId} onChange={value=>{setVersionId(value);setRequest(requestId());setProblem('');}} options={versions.data?.map(version=>({value:version.id,label:version.label}))??[]} />
    <div className="panel-actions"><Button loading={bind.isPending} disabled={!versionId||bind.isPending} onClick={()=>bind.mutate()}>绑定并准备投递</Button></div>
    {problem?<Alert type="error" showIcon message={problem}/>:null}
  </div>;
}

function ApprovalPanel({ task, selected, session, onBack, onApproved }: {
  task: CareerTaskView; selected: CareerTaskPostingView[]; session: BossSessionView | undefined;
  onBack: () => void; onApproved: (batchId: string) => void;
}) {
  const cache = useQueryClient();
  const version = useQuery({ queryKey: ['resume-version', task.resumeVersionId], queryFn: () => { if (!task.resumeVersionId) throw new Error('预览未绑定简历'); return api.resumeVersion(task.resumeVersionId); }, enabled: !!task.resumeVersionId });
  const [greetings, setGreetings] = useState<Record<string, string>>(() => Object.fromEntries(selected.map(posting => [posting.id, posting.greeting?.text ?? ''])));
  const [confirmed, setConfirmed] = useState(false);
  const [request, setRequest] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const blockers = approvalBlockers({ selected, greetings, resumeVersionId: task.resumeVersionId, session });
  const warnings = approvalWarnings({ selected, session });
  const approve = useMutation({
    mutationFn: (id: string) => {
      const body = careerApprovalSchema.safeParse({ requestId: id, expectedTaskRevision: task.revision, resumeVersionId: task.resumeVersionId, items: approvalItems(selected, greetings) });
      if (!body.success) throw new Error('审批内容不符合契约（选择的岗位、招呼语长度或简历版本有变化）。请返回复核页检查。');
      return api.approveCareerTask(task.id, body.data);
    },
    onSuccess: batch => {
      void cache.invalidateQueries({ queryKey: ['career-tasks'] });
      void cache.invalidateQueries({ queryKey: ['career-task', task.id] });
      void cache.invalidateQueries({ queryKey: ['career-postings', task.id] });
      onApproved(batch.id);
    },
    onError: (failure: Error) => {
      setProblem(failure instanceof ApiError && failure.status === 409
        ? '任务或岗位在你审批期间已经变化。你的最终文本仍保留在这里；请返回复核页重新读取后再确认。'
        : `审批没有提交成功：${failure.message} 最终文本与请求编号都保留在这里，可以直接重试同一个请求。`);
    },
  });
  function changeGreeting(id: string, value: string) {
    setGreetings(current => ({ ...current, [id]: value }));
    setRequest(null);
    setConfirmed(false);
    setProblem('');
  }
  return <section className="career" aria-labelledby="career-approval-title">
    <div className="intro">
      <h1 id="career-approval-title">确认这一批</h1>
      <p>下面就是将要真实发出的全部内容：{selected.length} 个岗位、每个岗位的最终招呼语、以及唯一的简历附件。确认后这批内容冻结，不能再修改。</p>
    </div>
    <div className="career-card">
      <div className="form-heading"><h2>固定简历与模型</h2><Button onClick={onBack} disabled={approve.isPending}>返回复核</Button></div>
      {version.isPending ? <p role="status">正在读取所选简历版本…</p> : null}
      {version.isError ? <Alert type="error" showIcon message={`所选简历版本读取失败：${version.error.message}`} /> : null}
      {version.data ? <dl className="career-facts">
        <div><dt>版本</dt><dd>{version.data.label} · {version.data.originalName} · {version.data.byteSize} 字节</dd></div>
        <div><dt>原始文件摘要</dt><dd>{version.data.attachmentSha256}</dd></div>
        <div><dt>提取文本摘要</dt><dd>{version.data.textSha256}</dd></div>
        <div><dt>模型连接</dt><dd>{task.model?.label ?? '未启用 AI'}</dd></div>
      </dl> : null}
      {version.data ? <div className="panel-actions"><ResumePreviewButton versionId={version.data.id} /></div> : null}
      <p className="storage-note">附件就是上面的原始文件字节。站点不接受该类型或大小时会显示附件限制，不会改成别的文件。</p>
    </div>
    <div className="career-card career-approval">
      <h2>逐条最终内容</h2>
      {selected.map(posting => {
        const text = greetings[posting.id] ?? '';
        const greetingFailure = greetingProblem(text);
        return <article key={posting.id} className="career-approval-item">
          <h3>{posting.observed.company} · {posting.observed.title}</h3>
          <p className="career-status-row"><Tag color="green">硬条件：{dispositionLabels[posting.decision.disposition]}</Tag><Tag>快照 {shortHash(posting.snapshotHash)}</Tag><Tag>草稿版本 {posting.greetingRevision}</Tag></p>
          <p className="career-muted">{posting.observed.location || '地点未识别'} · {posting.observed.salaryRaw} · 岗位编号 {posting.observed.sitePostingId}</p>
          <label htmlFor={`approve-greeting-${posting.id}`}>最终招呼语（会按此处文字原样发送）<Input.TextArea id={`approve-greeting-${posting.id}`} rows={5} maxLength={1200} value={text} onChange={event => changeGreeting(posting.id, event.target.value)} /></label>
          {greetingFailure ? <p role="alert" className="error">{greetingFailure}</p> : null}
        </article>;
      })}
    </div>
    {blockers.length ? <Alert type="error" showIcon message="还不能批准" description={<ul>{blockers.map(item => <li key={item}>{item}</li>)}</ul>} /> : null}
    {warnings.map(item => <Alert key={item} type="warning" showIcon message={item} />)}
    {problem ? <Alert type="error" showIcon message={problem} /> : null}
    <div className="career-card">
      <Checkbox checked={confirmed} disabled={approve.isPending} onChange={event => { setConfirmed(event.target.checked); setRequest(null); }}>
        我已逐条核对上面 {selected.length} 个岗位、每个岗位的最终招呼语和唯一的简历附件。我明白确认后会立即尝试发起沟通并发送该简历，且已发送的内容不能撤回。
      </Checkbox>
      <div className="panel-actions">
        <Button onClick={onBack} disabled={approve.isPending}>取消，返回复核</Button>
        <Button type="primary" danger loading={approve.isPending} disabled={approve.isPending || !confirmed || blockers.length > 0} onClick={() => { const id = request ?? requestId(); if (!request) setRequest(id); setProblem(''); approve.mutate(id); }}>
          {approve.isPending ? '正在冻结并提交…' : `确认冻结并批准这批（${selected.length} 条）`}
        </Button>
      </div>
      <p className="storage-note">如果网络中断，请用同一页面重试：相同请求编号会返回同一个批次，不会重复发送。{SEND_NOTE}</p>
    </div>
  </section>;
}

function SiteContactPanel({task,selected,session}:{task:CareerTaskView;selected:CareerTaskPostingView[];session:BossSessionView|undefined}){
  const cache=useQueryClient();
  const records=useQuery({queryKey:['career-contacts',task.id],queryFn:()=>api.careerContacts(task.id),refetchInterval:2000});
  const [command,setCommand]=useState(()=>requestId());
  const signature=selected.map(posting=>`${posting.id}:${posting.snapshotHash}`).join('|');
  useEffect(()=>{setCommand(requestId());},[signature,task.revision]);
  const approve=useMutation({
    mutationFn:()=>api.approveCareerContacts(task.id,{requestId:command,expectedTaskRevision:task.revision,items:selected.map(posting=>({taskPostingId:posting.id,snapshotHash:posting.snapshotHash}))}),
    onSuccess:()=>{void cache.invalidateQueries({queryKey:['career-contacts',task.id]});},
  });
  const retry=useMutation({
    mutationFn:(record:NonNullable<typeof records.data>[number])=>api.retryCareerContact(task.id,record.id,{requestId:requestId(),expectedUpdatedAt:record.updatedAt}),
    onSuccess:()=>{void cache.invalidateQueries({queryKey:['career-contacts',task.id]});},
  });
  const continuationController=useRef<AbortController|null>(null);
  useEffect(()=>()=>{continuationController.current?.abort();},[task.id]);
  const continuation=useMutation({
    mutationFn:async()=>{
      if(continuationController.current)throw new Error('已有继续任务在执行。');
      const controller=new AbortController();continuationController.current=controller;
      try{return await continueApprovedContacts({
        signal:controller.signal,
        read:()=>api.careerContacts(task.id),
        retry:record=>api.retryCareerContact(task.id,record.id,{requestId:requestId(),expectedUpdatedAt:record.updatedAt}),
        wait:()=>new Promise(resolve=>setTimeout(resolve,1000)),
      });}finally{if(continuationController.current===controller)continuationController.current=null;}
    },
    onSettled:()=>{void cache.invalidateQueries({queryKey:['career-contacts',task.id]});},
  });
  const modeAllowed=session?.automationMode==='contact'||session?.automationMode==='enabled';
  const alreadyApproved=selected.some(posting=>records.data?.some(record=>record.taskPostingId===posting.id));
  const blocked=alreadyApproved||task.state.status!=='active'||task.state.phase!=='review'||!selected.length||session?.state!=='ready'||!modeAllowed;
  const labels={queued:'等待执行',dispatching:'正在发起沟通',confirmed:'站内已显示沟通状态',already_contacted:'之前已沟通，本次未点击',failed:'未完成，查看原因',unknown:'结果未知，禁止自动重试',cancelled:'已取消'};
  return <div className="career-card">
    <h2>仅立即沟通（使用站内自动招呼词）</h2>
    <p>只对你选定且已通过筛选的岗位点击一次“立即沟通”。文案使用 BOSS 站内设置，系统不额外输入消息或发送附件，无需简历或模型。</p>
    {!task.shortlistCount?<Alert type="info" showIcon message={`当前没有可沟通岗位：${task.reviewCount} 个待复核，${task.excludedCount} 个已排除。先在待复核列表核对直招依据，通过后再勾选岗位。`}/>:null}
    {alreadyApproved?<p className="career-muted">所选岗位已有沟通记录，请核对下方状态，系统不会重复点击。</p>:null}
    {!modeAllowed?<p className="career-muted">当前配置尚未开启仅沟通执行。</p>:null}
    {session?.state!=='ready'?<p className="career-muted">请先打开并检查本机 BOSS 会话。</p>:null}
    <Popconfirm title={`确认仅对这 ${selected.length} 个岗位发起沟通？`} description={<div><p>将使用站内自动招呼词；不会额外发送消息或简历。</p><ul>{selected.map(posting=><li key={posting.id}>{posting.observed.company} · {posting.observed.title} · {posting.observed.salaryRaw}</li>)}</ul></div>} okText="确认仅立即沟通" cancelText="返回复核" disabled={blocked||approve.isPending||continuation.isPending} onConfirm={()=>approve.mutateAsync()}>
      <Button type="primary" loading={approve.isPending} disabled={blocked||approve.isPending||continuation.isPending}>确认所选 {selected.length} 个岗位，仅立即沟通</Button>
    </Popconfirm>
    {approve.isError?<Alert type="error" showIcon message={approve.error.message}/>:null}
    {approve.isSuccess?<p role="status">已保存沟通批准，下面显示真实执行状态。相同请求不会重复排队。</p>:null}
    <Button loading={continuation.isPending} disabled={!modeAllowed||session?.state!=='ready'||task.state.status!=='active'||retry.isPending||approve.isPending||continuation.isPending||!records.data?.some(row=>row.state==='failed')||records.data.some(row=>['unknown','queued','dispatching'].includes(row.state))} onClick={()=>continuation.mutate()}>继续已批准且未点击的记录</Button>
    {continuation.isPending?<Button onClick={()=>continuationController.current?.abort()}>停止后续提交</Button>:null}
    <p className="career-muted">程序逐条提交并等待结果，失败或未知即停止；关闭页面后不再提交下一条，已排队动作仍需核对执行记录。</p>
    {continuation.data?<p role="status">本轮确认 {continuation.data.completed} 条；{({completed:'本轮已结束',blocked:'存在执行中或未知记录，已停止',changed:'记录已变化，请重新核对',failed:'点击前失败，已停止',unknown:'结果未知，禁止重发',cancelled:'后续提交已停止',timeout:'等待结果超时，未继续'})[continuation.data.reason]}。</p>:null}
    {continuation.isError?<Alert type="error" showIcon message={continuation.error.message}/>:null}
    {retry.isError?<Alert type="error" showIcon message={retry.error.message}/>:null}
    {records.isError?<Alert type="error" showIcon message={records.error.message}/>:null}
    <ul aria-label="站内沟通执行记录">{records.data?.map(record=><li key={record.id}><strong>{record.company} · {record.title}</strong> — {labels[record.state]}{record.reason?'（原因见下方记录）':''}{record.state==='failed'?<Button size="small" loading={retry.isPending} disabled={continuation.isPending} onClick={()=>retry.mutate(record)}>重试这条未点击的记录</Button>:null}{record.evidence.map((item,index)=><p key={index}>{item.summary}</p>)}</li>)}</ul>
    {records.data&&!records.data.length?<p className="career-muted">尚未批准任何沟通，当前不会点击站点按钮。</p>:null}
  </div>;
}

function TaskView({ taskId, navigate, openModelSettings, onStrictPractice }: {
  taskId: string; navigate: (route: Route) => void; openModelSettings: () => void; onStrictPractice: (preparationId: string) => void;
}) {
  const cache = useQueryClient();
  const task = useCareerTask(taskId);
  const scanning = task.data?.state.status === 'active' && task.data.state.phase !== 'review';
  const postings = useQuery({
    queryKey: ['career-postings', taskId], queryFn: () => api.careerPostings(taskId),
    refetchInterval: scanning ? 2000 : task.data?.state.status==='active' ? 5000 : false,
  });
  const session = useSession();
  const [selected, setSelected] = useState<string[]>(() => keptSelection.get(taskId) ?? []);
  const [openPostingId, setOpenPostingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'eligible' | 'needs_review' | 'excluded' | 'contacted'>('eligible');
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resumeOpen, setResumeOpen] = useState(false);
  const [retryAcknowledged, setRetryAcknowledged] = useState(false);
  const groups = groupPostings(postings.data ?? []);
  const initialGroup=useRef<string|null>(null);
  useEffect(()=>{
    if(initialGroup.current===taskId||!postings.data?.length)return;
    const currentGroups=groupPostings(postings.data);
    const first=currentGroups.eligible.length?'eligible':currentGroups.needs_review.length?'needs_review':currentGroups.excluded.length?'excluded':'contacted';
    setTab(first);setOpenPostingId(currentGroups[first][0]?.id??null);initialGroup.current=taskId;
  },[taskId,postings.data]);
  const eligibleIds = groups.eligible.map(posting => posting.id);
  const eligibleSignature = eligibleIds.join(',');
  useEffect(() => {
    setSelected(current => {
      const next = current.filter(id => eligibleIds.includes(id));
      if (next.length === current.length) return current;
      keptSelection.set(taskId, next);
      return next;
    });
  }, [eligibleSignature, taskId]);
  // `eligibleIds` is captured from this render; the effect intentionally keys on the stable signature only.

  const resumeTask = useMutation({
    mutationFn: () => api.resumeCareerTask(taskId, { requestId: requestId(), expectedRevision: task.data?.revision ?? 0 }),
    onSuccess: result => { cache.setQueryData(['career-task', taskId], result); void cache.invalidateQueries({ queryKey: ['career-tasks'] }); setNotice('已请求恢复任务；如果会话仍未就绪，任务会再次暂停并说明原因。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelCareerTask(taskId, { requestId: requestId() }),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['career-task', taskId] }); void cache.invalidateQueries({ queryKey: ['career-tasks'] }); setNotice('任务已取消，不再读取新岗位。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const retryGeneration = useMutation({
    mutationFn: () => {
      const connection = connectionId();
      if (!connection) throw new Error('没有已启用的模型连接。');
      return api.retryCareerGeneration(taskId, { requestId: requestId(), expectedRevision: task.data?.revision ?? 0, modelConnectionId: connection, dataProcessingAcknowledged: true });
    },
    onSuccess: result => { cache.setQueryData(['career-task', taskId], result); void cache.invalidateQueries({ queryKey: ['career-postings', taskId] }); void cache.invalidateQueries({ queryKey: ['career-tasks'] }); setNotice('已用当前模型连接重试失败的匹配与招呼语生成；已批准的批次不受影响。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const settings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings });
  function connectionId() { return settings.data?.active?.id ?? null; }

  function updatePosting(updated: CareerTaskPostingView) {
    cache.setQueryData(['career-postings', taskId], (current: CareerTaskPostingView[] | undefined) => current?.map(item => item.id === updated.id ? updated : item));
  }
  function reloadPostings() {
    setError('');
    void cache.invalidateQueries({ queryKey: ['career-postings', taskId] });
  }
  const current = task.data;
  const selectedPostings = (postings.data ?? []).filter(posting => selected.includes(posting.id));
  const openPosting = (postings.data ?? []).find(posting => posting.id === openPostingId) ?? null;

  if (task.isPending) return <section className="career"><div role="status" className="loading"><Spin size="small" /> 正在读取求职任务…</div></section>;
  if (task.isError) return <section className="career"><Alert type="error" showIcon message={`任务读取失败：${task.error.message}`} action={<Button onClick={() => void task.refetch()}>重新读取</Button>} /></section>;
  if (!current) return null;
  if (approving) return <ApprovalPanel task={current} selected={selectedPostings} session={session.data} onBack={() => setApproving(false)}
    onApproved={batchId => navigate({ page: 'career', batchId })} />;

  const warning = taskWarning(current);
  return <section className="career" aria-labelledby="career-task-title">
    <div className="intro">
      <h1 id="career-task-title">任务 {current.id.slice(0, 8)}</h1>
      <p>{[...current.policy.roleTargets.map(role => role === 'fullstack' ? '全栈' : 'Agent 开发'), ...(current.policy.customRoleKeywords ?? [])].join(' / ')} · {current.policy.cities.join(' / ')} · ≥{current.policy.salaryUpperMinCnyMonthly} 元/月 · 读取 {current.readCount}/{CAREER_MAX_POSTINGS} · 模型 {current.model?.label ?? '纯规则预览'}</p>
      {current.mode === 'preview' ? <Alert type="info" showIcon message="岗位筛选与站内沟通" description="岗位已在系统保存并按条件分组。先复核直招依据，通过后勾选岗位，使用下方“仅立即沟通”；不要求本地简历或模型。" /> : null}
      <p className="career-status-row"><TaskStateTag state={current.state} />{current.resumeTextSha256 ? <Tag>简历 {shortHash(current.resumeTextSha256)}</Tag> : <Tag>仅站内自动招呼，无需本地简历</Tag>}{current.attachmentSha256 ? <Tag>附件 {shortHash(current.attachmentSha256)}</Tag> : null}<Button size="small" onClick={() => navigate({ page: 'career' })}>返回求职首页</Button></p>
      <p className="career-muted">公司黑名单：{current.policy.companyBlacklistKeywords.length ? current.policy.companyBlacklistKeywords.join('、') : '未设置'} · AI 应用加分：{current.policy.preferAiApplication ? '是（仅并列排序）' : '否'}</p>
    </div>
    {settings.isError ? <Alert type="error" showIcon message={`模型状态读取失败：${settings.error.message}`} /> : null}
    {warning ? <Alert type="warning" showIcon message={warning} /> : null}
    {current.state.status === 'paused' ? <div className="career-card">
      <div className="form-heading"><h2>暂停处理</h2><span className="career-muted">{pauseLabels[current.state.reason]}</span></div>
      <p>{current.state.detail}</p>
      <p className="career-muted">修复本机会话或站点状态后，再手动恢复任务。恢复不会重发任何已确认的沟通或附件。</p>
      <div className="panel-actions">
        <Button loading={resumeTask.isPending} disabled={resumeTask.isPending} onClick={() => { setError(''); resumeTask.mutate(); }}>恢复任务</Button>
        <Button onClick={() => setResumeOpen(value => !value)}>{resumeOpen ? '收起会话操作' : '打开登录/检查会话'}</Button>
      </div>
      {resumeOpen ? <BossSessionCard /> : null}
    </div> : null}
    {current.state.status === 'failed' && current.mode === 'personalized' ? <div className="career-card">
      <div className="form-heading"><h2>重试生成</h2><span className="career-muted">只影响匹配与招呼语，不会外发</span></div>
      <p>{current.state.error}</p>
      <p className="career-muted">重试需要显式同意：所选简历文本与岗位 JD 会再次发送给当前模型连接 {settings.data?.active?.model ?? '（无）'}。</p>
      <Checkbox checked={retryAcknowledged} onChange={event => setRetryAcknowledged(event.target.checked)}>我同意用当前模型连接重试生成</Checkbox>
      <div className="panel-actions">
        <Button loading={retryGeneration.isPending} disabled={retryGeneration.isPending || !retryAcknowledged || !connectionId()} onClick={() => { setError(''); retryGeneration.mutate(); }}>重试失败的生成</Button>
        <Button onClick={openModelSettings}>更换模型连接</Button>
      </div>
      {!connectionId() ? <p role="alert" className="error">没有已启用的模型连接。请先在模型设置里启用后再重试。</p> : null}
    </div> : null}
    {current.state.status === 'failed' && current.mode === 'preview' ? <Alert type="error" showIcon message={current.state.error} action={<Button onClick={() => navigate({ page: 'career' })}>返回条件页重新搜索</Button>} /> : null}

    {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setError('')}>关闭</Button>} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="career-card">
      <div className="form-heading">
        <h2>岗位复核</h2>
        <span className="career-muted">可投递 {groups.eligible.length} · 需复核 {groups.needs_review.length} · 已排除 {groups.excluded.length} · 已联系过 {groups.contacted.length}</span>
      </div>
      {postings.isPending ? <div role="status" className="career-muted"><Spin size="small" /> 正在读取本次读到的岗位…</div> : null}
      {postings.isError ? <Alert type="error" showIcon message={`岗位读取失败：${postings.error.message}`} action={<Button onClick={reloadPostings}>重新读取</Button>} /> : null}
      {postings.data && !postings.data.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scanning ? '正在读取岗位，还没有可展示的记录。' : '本次任务没有读到岗位记录。原因可能登录未就绪、原生筛选未生效或站点没有返回结果，不能理解为“没有符合条件的岗位”。'} /> : null}
      {postings.data?.length ? <>
        <div className="career-selection">
          <span>已选 {selected.length}/{CAREER_MAX_BATCH_ITEMS} 个可投递岗位</span>
          <div className="panel-actions">
            <Button onClick={() => { setSelected(groups.eligible.slice(0, CAREER_MAX_BATCH_ITEMS).map(posting => posting.id)); keptSelection.set(taskId, groups.eligible.slice(0, CAREER_MAX_BATCH_ITEMS).map(posting => posting.id)); }} disabled={!groups.eligible.length}>选中前 {Math.min(CAREER_MAX_BATCH_ITEMS, groups.eligible.length)} 个可投递岗位</Button>
            <Button onClick={() => { setSelected([]); keptSelection.set(taskId, []); }} disabled={!selected.length}>清空选择</Button>
            <Button type="primary" disabled={!selected.length || current.mode === 'preview'} onClick={() => { setError(''); setNotice(''); setApproving(true); }}>可选：自定义文案与本地附件审批</Button>
          </div>
          <p className="career-muted">勾选只保存在当前页面会话内；刷新后需要重新勾选，已保存的招呼语草稿不受影响。</p>
        </div>
        <Tabs
          activeKey={tab}
          onChange={key => { const next = key === 'needs_review' || key === 'excluded' || key === 'contacted' ? key : 'eligible'; setTab(next); setOpenPostingId(null); }}
          items={([
            ['eligible', '可投递'], ['needs_review', '需复核'], ['excluded', '已排除'], ['contacted', '已联系过'],
          ] as const).map(([key, label]) => ({
            key, label: `${label} ${groups[key].length}`,
            children: groups[key].length
              ? <div className="career-review">
                <ul className="career-posting-list" aria-label={`${label}岗位`}>
                  {groups[key].map(posting => <PostingRow key={posting.id} posting={posting} selected={selected.includes(posting.id)}
                    onToggle={checked => {
                      if (checked && selected.length >= CAREER_MAX_BATCH_ITEMS) return;
                      setSelected(current => {
                        // Unchecking must drop the id; keeping it would approve a posting the owner unchecked.
                        const next = checked
                          ? (current.includes(posting.id) ? current : [...current, posting.id])
                          : current.filter(id => id !== posting.id);
                        keptSelection.set(taskId, next);
                        return next;
                      });
                    }}
                    onOpen={() => setOpenPostingId(posting.id)} />)}
                </ul>
                <div className="career-detail-pane">
                  {openPosting && groups[key].some(posting => posting.id === openPosting.id)
                    ? <PostingDetail task={current} posting={openPosting} busy={false} onUpdated={updatePosting} onReload={reloadPostings}
                      onOpenPreparation={preparationId => navigate({ page: 'career', preparationId })}
                      onError={setError} onNotice={setNotice} />
                    : <p className="career-muted">选择左侧一个岗位，查看硬条件依据、匹配证据与可编辑招呼语。</p>}
                </div>
              </div>
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={key === 'eligible' ? '还没有可投递岗位。需复核与已排除的记录仍然在对应标签里。' : '这一类暂时没有记录。'} />,
          }))}
        />
      </> : null}
    </div>
    <SiteContactPanel task={current} selected={selectedPostings} session={session.data}/>
    <details><summary>可选：本地简历与自定义文案投递</summary><PreviewResumeBinding task={current}/></details>
    <div className="career-card">
      <div className="form-heading"><h2>任务操作</h2><span className="career-muted">取消与删除都不会撤回已发送的内容</span></div>
      <div className="panel-actions">
        <Popconfirm title="取消这个任务？" description="停止读取新岗位并撤销未开始的外发；已发出的沟通或附件保留实际结果。" okText="确认取消任务" cancelText="保留"
          onConfirm={() => { setError(''); return cancel.mutateAsync(); }}><Button danger disabled={current.state.status === 'cancelled' || cancel.isPending}>取消任务</Button></Popconfirm>
        <Popconfirm title="删除任务及其个人快照？" description="会先取消任务，再删除岗位快照、招呼语、备题等派生数据；由这些备题保存到题库的题目，以及用它们开展的整个严格面试（含全部作答历史）也会一起删除。简历库版本保留。用于去重的最少量岗位记录会保留但没有个人文本。" okText="确认删除任务" cancelText="保留"
          onConfirm={async () => {
            setError('');
            try {
              await api.deleteCareerTask(taskId, { requestId: requestId() });
              void cache.invalidateQueries({ queryKey: ['career-tasks'] });
              void cache.invalidateQueries({ queryKey: ['career-postings', taskId] });
              navigate({ page: 'career' });
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : '删除任务失败。');
            }
          }}><Button type="text" danger>删除任务</Button></Popconfirm>
      </div>
      {current.batches.length ? <ul className="career-task-list" aria-label="该任务的批次">
        {current.batches.map(batch => <li key={batch.id}>
          <button type="button" className="career-task-row" onClick={() => navigate({ page: 'career', batchId: batch.id })}>
            <strong>批次 {batch.id.slice(0, 8)}</strong>
            <span><Tag color={batch.state === 'completed' ? 'green' : batch.state === 'cancelled' ? 'default' : 'blue'}>{batchStateLabels[batch.state]}</Tag>批准于 {dateTime(batch.approvedAt)}</span>
          </button>
        </li>)}
      </ul> : null}
      <p className="storage-note">{BATCH_NOTE}</p>
    </div>
  </section>;
}

const BATCH_NOTE = '已批准批次的外发进度请打开对应批次查看：沟通、等待同意、附件与备题是四个独立状态，不会合并成一个“成功”。';

// Selected postings survive in-app navigation but never get persisted as task state.
const keptSelection = new Map<string, string[]>();

function BatchView({ batchId, navigate }: { batchId: string; navigate: (route: Route) => void }) {
  const cache = useQueryClient();
  const batch = useQuery({
    queryKey: ['career-batch', batchId], queryFn: () => api.careerBatch(batchId),
    refetchInterval: query => {
      const data = query.state.data;
      const busy = data && (data.state === 'approved' || data.state === 'delivering' || data.items.some(item => item.conversation.state === 'dispatching' || item.attachment.state === 'dispatching'));
      return busy ? 2000 : false;
    },
  });
  const session = useSession();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sessionOpen, setSessionOpen] = useState(false);
  const reload = () => {
    void cache.invalidateQueries({ queryKey: ['career-batch', batchId] });
    void cache.invalidateQueries({ queryKey: ['career-task'] });
    void cache.invalidateQueries({ queryKey: ['career-tasks'] });
  };
  const resume = useMutation({
    // The batch view exposes the frozen task revision; the API only uses it to scope the command.
    mutationFn: () => api.resumeCareerBatch(batchId, { requestId: requestId(), expectedRevision: batch.data?.taskRevision ?? 0 }),
    onSuccess: () => { reload(); setNotice('已请求恢复批次。只会继续未完成的阶段，不会重发已确认的沟通。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelCareerBatch(batchId, { requestId: requestId() }),
    onSuccess: () => { reload(); setNotice('批次已取消。已经发出的沟通或附件保留实际观测结果。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const itemAction = useMutation({
    mutationFn: ({ action, item }: { action: BatchItemAction; item: CareerBatchItemView }) => {
      const id = requestId();
      if (action === 'retry_conversation') return api.retryCareerItem(batchId, item.id, { requestId: id, expectedRevision: item.revision, phase: 'conversation' });
      if (action === 'retry_attachment') return api.retryCareerItem(batchId, item.id, { requestId: id, expectedRevision: item.revision, phase: 'attachment' });
      if (action === 'reconcile') return api.reconcileCareerItem(batchId, item.id, { requestId: id });
      return api.resumeCareerAttachment(batchId, item.id, { requestId: id, expectedRevision: item.revision });
    },
    onSuccess: (_result, input) => { reload(); setNotice(`${actionLabels[input.action]}已排队。${input.action === 'reconcile' ? '这是只读核对，不会发送任何内容。' : ''}`); },
    onError: (failure: Error) => setError(failure.message),
  });
  const preparationRetry = useMutation({
    mutationFn: (preparationId: string) => api.retryCareerPreparation(preparationId, { requestId: requestId() }),
    onSuccess: () => { reload(); setNotice('已重试备题。备题失败不会影响外发。'); },
    onError: (failure: Error) => setError(failure.message),
  });

  if (batch.isPending) return <section className="career"><div role="status" className="loading"><Spin size="small" /> 正在读取批次…</div></section>;
  if (batch.isError) return <section className="career"><Alert type="error" showIcon message={`批次读取失败：${batch.error.message}`} action={<Button onClick={() => void batch.refetch()}>重新读取</Button>} /></section>;
  const data = batch.data;
  if (!data) return null;
  const outcome = batchOutcome(data);
  return <section className="career" aria-labelledby="career-batch-title">
    <div className="intro">
      <h1 id="career-batch-title">批次 {data.id.slice(0, 8)}</h1>
      <p>批准于 {dateTime(data.approvedAt)} · 冻结摘要 {shortHash(data.digest)} · 任务版本 {data.taskRevision}</p>
      <p className="career-status-row"><Tag color={data.state === 'completed' ? 'green' : data.state === 'cancelled' ? 'default' : data.state === 'paused' ? 'orange' : 'blue'}>{batchStateLabels[data.state]}</Tag><Button size="small" onClick={() => navigate({ page: 'career', taskId: data.taskId })}>返回任务</Button><Button size="small" onClick={() => navigate({ page: 'career' })}>求职首页</Button></p>
    </div>
    {outcome.pauseLabel ? <Alert type="warning" showIcon message={`批次已暂停：${outcome.pauseLabel}`} description="登录、人机验证或站点限制会暂停整批。完成本机会话检查后再手动恢复。" /> : null}
    <div className="career-card">
      <div className="form-heading"><h2>冻结的外发内容</h2><span className="career-muted">{data.originalName} · 原始文件摘要 {shortHash(data.attachmentSha256)}</span></div>
      <dl className="career-facts">
        <div><dt>简历版本</dt><dd>{data.resumeLabel}（{data.resumeVersionId.slice(0, 8)}）</dd></div>
        <div><dt>原始文件</dt><dd>{data.originalName} · {data.attachmentSha256}</dd></div>
        <div><dt>文本摘要</dt><dd>{data.resumeTextSha256}</dd></div>
        <div><dt>生成模型</dt><dd>{data.model.model}</dd></div>
      </dl>
      <p className="career-muted">沟通已确认 {outcome.conversations.confirmed} · 等待发起 {outcome.conversations.pending} · 未知 {outcome.conversations.unknown} · 已证明未发生 {outcome.conversations.failed}；附件已确认 {outcome.attachments.confirmed} · 等待同意 {outcome.attachments.awaiting} · 未知 {outcome.attachments.unknown} · 已证明未发生 {outcome.attachments.failed}。</p>
      <div className="panel-actions">
        <Button onClick={() => setSessionOpen(value => !value)}>{sessionOpen ? '收起会话操作' : '打开登录/检查会话'}</Button>
        <Button loading={resume.isPending} disabled={resume.isPending || data.state !== 'paused'} onClick={() => { setError(''); resume.mutate(); }}>恢复批次</Button>
        {data.state === 'paused' && session.data?.state !== 'ready' ? <span className="career-muted">恢复前需要会话状态为“已就绪”。</span> : null}
        <Popconfirm title="取消这个批次？" description="停止后续投递并撤销未开始的阶段；已发出的沟通或附件无法撤回，会保留实际观测结果。" okText="确认取消批次" cancelText="保留"
          onConfirm={() => { setError(''); return cancel.mutateAsync(); }}><Button danger disabled={cancel.isPending || data.state === 'cancelled'}>取消批次</Button></Popconfirm>
      </div>
      {sessionOpen ? <BossSessionCard busy={resume.isPending} /> : null}
      {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setError('')}>关闭</Button>} /> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
    <div className="career-batch">
      {data.items.map(item => <article className="career-card career-batch-item" key={item.id} aria-label={`${item.company} ${item.title}`}>
        <header>
          <h2>{item.company} · {item.title}</h2>
          <p className="career-muted">{item.location || '地点未识别'} · {item.salaryRaw} · 快照 {shortHash(item.snapshotHash)} · 招呼语摘要 {shortHash(item.greetingSha256)}</p>
        </header>
        <details><summary>这条冻结的招呼语原文</summary><blockquote className="career-answer">{item.greeting}</blockquote></details>
        <div className="career-phase">
          <div>
            <h3>沟通：<Tag color={item.conversation.state === 'confirmed' ? 'green' : item.conversation.state === 'unknown' ? 'red' : 'default'}>{conversationStateLabels[item.conversation.state]}</Tag></h3>
            {item.conversation.reason ? <p className="career-muted">原因：{item.conversation.reason}</p> : null}
            <ul>{item.conversation.evidence.map(entry => <li key={`${entry.observedAt}-${entry.summary}`}><span className="career-muted">{dateTime(entry.observedAt)}</span> {entry.summary}</li>)}</ul>
          </div>
          <div>
            <h3>附件：<Tag color={item.attachment.state === 'confirmed' ? 'green' : item.attachment.state === 'unknown' ? 'red' : 'default'}>{attachmentStateLabels[item.attachment.state]}</Tag></h3>
            <p className="career-muted">{item.attachment.originalName} · {shortHash(item.attachment.attachmentSha256)}</p>
            {item.attachment.reason ? <p className="career-muted">原因：{item.attachment.reason}</p> : null}
            <ul>{item.attachment.evidence.map(entry => <li key={`${entry.observedAt}-${entry.summary}`}><span className="career-muted">{dateTime(entry.observedAt)}</span> {entry.summary}</li>)}</ul>
          </div>
          <div>
            <h3>备题：{item.preparation ? <Tag color={item.preparation.status === 'ready' ? 'green' : item.preparation.status === 'failed' ? 'red' : 'default'}>{preparationStatusLabels[item.preparation.status]}</Tag> : <span className="career-muted">未生成</span>}</h3>
            {item.preparation ? <div className="panel-actions">
              <Button size="small" onClick={() => navigate({ page: 'career', preparationId: item.preparation?.id ?? '' })}>打开备题</Button>
              {item.preparation.status === 'failed' ? <Button size="small" loading={preparationRetry.isPending} onClick={() => preparationRetry.mutate(item.preparation?.id ?? '')}>只重试备题</Button> : null}
            </div> : null}
          </div>
        </div>
        <div className="panel-actions">
          {batchItemActions(item, data.state).map(action => <Button key={action} size="small" loading={itemAction.isPending} onClick={() => { setError(''); itemAction.mutate({ action, item }); }}>{actionLabels[action]}</Button>)}
          {item.attachment.state === 'blocked_by_conversation' ? <span className="career-muted">附件要等沟通确认后才能发送。</span> : null}
          {item.conversation.state === 'unknown' ? <span className="career-muted">结果未知时不会自动重发：请先只读核对。</span> : null}
        </div>
      </article>)}
    </div>
    <p className="context-note">这里的每个状态都来自本机浏览器实际观测；点击、HTTP 200 或上传完成都不等于已送达。{SEND_NOTE}</p>
  </section>;
}

function splitLines(value: string) {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

function PreparationView({ preparationId, navigate, onStartPractice }: {
  preparationId: string; navigate: (route: Route) => void; onStartPractice: (seed: CareerPracticeSeed) => void;
}) {
  const cache = useQueryClient();
  const preparation = useQuery({
    queryKey: ['career-preparation', preparationId], queryFn: () => api.careerPreparation(preparationId),
    refetchInterval: query => query.state.data && ['queued', 'generating'].includes(query.state.data.status) ? 2000 : false,
  });
  const data = preparation.data;
  // The preparation view carries the frozen posting and resume it was generated from, so the page
  // does not need to re-fetch the task, posting list and resume version to show its sources.
  const posting = data?.posting ?? null;
  const resume = data?.resume ?? null;
  const [drafts, setDrafts] = useState<Record<string, { title: string; text: string; assessmentPoints: string; referenceAnswerGuidance: string }> | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saveRequest, setSaveRequest] = useState<string | null>(null);
  const bankRequests = useRef(new Map<string, string>());

  const server = data?.preparation ?? null;
  const loadedRevision = useRef<number | null>(null);
  useEffect(() => {
    if (!server) return;
    if (loadedRevision.current === server.revision) return;
    loadedRevision.current = server.revision;
    setDrafts(Object.fromEntries(server.questions.map(question => [question.id, {
      title: question.title, text: question.text,
      assessmentPoints: question.assessmentPoints.join('\n'), referenceAnswerGuidance: question.referenceAnswerGuidance.join('\n'),
    }])));
    setSaveRequest(null);
  }, [server]);

  /** Identical content reuses the accepted request id; any edit needs a new one because the payload hash changes. */
  function requestForSave() {
    const id = saveRequest ?? requestId();
    if (!saveRequest) setSaveRequest(id);
    return id;
  }
  const save = useMutation({
    mutationFn: (id: string) => {
      if (!server) throw new Error('备题还没有生成完成。');
      const questions = server.questions.map(question => {
        const draft = drafts?.[question.id];
        if (!draft) throw new Error('备题内容已变化，请重新读取后再编辑。');
        return {
          id: question.id, title: draft.title, text: draft.text,
          assessmentPoints: splitLines(draft.assessmentPoints), referenceAnswerGuidance: splitLines(draft.referenceAnswerGuidance),
          jdSources: question.jdSources, basis: question.basis,
        };
      });
      const body = personalizedPreparationPatchSchema.safeParse({ requestId: id, expectedRevision: data?.revision ?? 0, questions });
      if (!body.success) throw new Error('每道题的评估要点与参考指导各需要 2–5 条，一行一条；标题 2–160 字，题面 10–3000 字。');
      return api.patchCareerPreparation(preparationId, body.data);
    },
    onSuccess: result => {
      cache.setQueryData(['career-preparation', preparationId], result);
      setConflict(false);
      setSaveRequest(null);
      setNotice('备题修改已保存为新修订；原始生成结果与来源引用仍保留。');
    },
    onError: (failure: Error) => {
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
      setError(failure.message);
    },
  });
  const retry = useMutation({
    mutationFn: () => api.retryCareerPreparation(preparationId, { requestId: requestId() }),
    onSuccess: result => { cache.setQueryData(['career-preparation', preparationId], result); setNotice('已重试备题生成；外发状态不受影响。'); },
    onError: (failure: Error) => setError(failure.message),
  });
  const bank = useMutation({
    mutationFn: () => api.saveCareerPreparationToBank(preparationId, {
      questions: selectedQuestions.map(questionId => {
        const existing = bankRequests.current.get(questionId) ?? requestId();
        bankRequests.current.set(questionId, existing);
        return { questionId, requestId: existing };
      }),
    }),
    onSuccess: saved => {
      setSavedIds(current => [...new Set([...current, ...saved.map(question => question.id)])]);
      setNotice(`已把 ${saved.length} 道题保存到题库（保留个性化来源）。`);
      void cache.invalidateQueries({ queryKey: ['question-bank'] });
    },
    onError: (failure: Error) => setError(failure.message),
  });
  async function exportAs(format: 'markdown' | 'json') {
    setError('');
    try {
      const file = await api.exportCareerPreparation(preparationId, format);
      saveBlob(file.body, file.filename);
      setNotice(`已导出 ${file.filename}。导出只包含当前修订与来源引用，不含路径或密钥。`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '导出失败。');
    }
  }

  if (preparation.isPending) return <section className="career"><div role="status" className="loading"><Spin size="small" /> 正在读取备题…</div></section>;
  if (preparation.isError) return <section className="career"><Alert type="error" showIcon message={`备题读取失败：${preparation.error.message}`} action={<Button onClick={() => void preparation.refetch()}>重新读取</Button>} /></section>;
  if (!data) return null;
  const purposes = preparationSummary(server)?.purposes ?? [];
  const roleFamily = data.roleFamily;
  const resumeText = resume?.text ?? '';
  const jdText = posting?.jdText ?? '';
  const strictLimits = [
    resumeText.length > STAGE_TEXT_LIMITS.resume ? `简历文本 ${resumeText.length} 字，超过严格练习的 ${STAGE_TEXT_LIMITS.resume} 字上限。请使用导出的备题，或在面试准备页选择明确标注的片段；不会自动截断。` : '',
    jdText.length > STAGE_TEXT_LIMITS.jobDescription ? `岗位 JD ${jdText.length} 字，超过严格练习的 ${STAGE_TEXT_LIMITS.jobDescription} 字上限。请使用导出的备题，或在面试准备页选择明确标注的节选。` : '',
  ].filter(Boolean);
  const canPractice = savedIds.length > 0 && strictLimits.length === 0 && Boolean(posting) && Boolean(resume);
  return <section className="career" aria-labelledby="career-preparation-title">
    <div className="intro">
      <h1 id="career-preparation-title">{posting ? `${posting.company} · ${posting.title}` : '个性化备题'}</h1>
      <p>{preparationStatusLabels[data.status]} · 修订 {data.revision} · 模型 {data.model.label}{data.edited ? ' · 已由你编辑' : ''}</p>
      <p className="career-status-row"><Button size="small" onClick={() => navigate({ page: 'career', taskId: data.taskId })}>返回任务</Button></p>
    </div>
    {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setError('')}>关闭</Button>} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {data.status === 'failed' ? <div className="career-card">
      <h2>备题生成失败</h2>
      <p>{data.failure ?? '没有记录失败原因。'}</p>
      <p className="career-muted">只重试备题：不会重发招呼语或附件，也不会改变已批准的批次。</p>
      <Button loading={retry.isPending} disabled={retry.isPending} onClick={() => { setError(''); retry.mutate(); }}>重试备题</Button>
    </div> : null}
    {['queued', 'generating'].includes(data.status) ? <div className="career-card"><div role="status" className="career-muted"><Spin size="small" /> 正在用固定简历与冻结 JD 生成 10 道题…</div><p className="career-muted">外发进度与备题互不等待。</p></div> : null}
    {server ? <>
      <div className="career-card">
        <div className="form-heading"><h2>来源与用途</h2><span className="career-muted">JD 摘要 {shortHash(server.sourceHashes.jd)} · 简历摘要 {shortHash(server.sourceHashes.resume)}</span></div>
        <p className="career-muted">{purposes.map(item => `${purposeLabels[item.purpose]} ${item.count} 道`).join(' · ')}</p>
        <p className="career-muted">缺口类题目只表示“准备方向”，{gapBasisLabel}。没有项目证据时不会编造项目。</p>
        {server.uncertainties.length ? <p className="career-muted">生成时的不确定项：{server.uncertainties.join('；')}</p> : null}
        <div className="panel-actions">
          <Button onClick={() => void exportAs('markdown')}>导出 Markdown</Button>
          <Button onClick={() => void exportAs('json')}>导出 JSON</Button>
        </div>
      </div>
      <div className="career-card">
        <div className="form-heading"><h2>10 道题（可编辑）</h2><span className="career-muted">已选 {selectedQuestions.length} 道</span></div>
        <div className="panel-actions">
          <Button onClick={() => setSelectedQuestions(server.questions.map(question => question.id))}>全选题目</Button>
          <Button onClick={() => setSelectedQuestions([])} disabled={!selectedQuestions.length}>清空选择</Button>
          <Button loading={bank.isPending} disabled={!selectedQuestions.length || bank.isPending} onClick={() => { setError(''); bank.mutate(); }}>保存所选到题库</Button>
          <Button onClick={() => navigate({ page: 'bank' })}>打开题库</Button>
        </div>
        {selectedQuestions.some(questionId => savedIds.includes(questionId)) ? <p className="career-muted">已保存过的题目会返回同一个题库条目，不会重复创建。</p> : null}
        {server.questions.map((question, index) => {
          const draft = drafts?.[question.id];
          if (!draft) return null;
          return <article className="career-prep-question" key={question.id}>
            <div className="preparation-card-heading">
              <Checkbox checked={selectedQuestions.includes(question.id)} aria-label={`选择第 ${index + 1} 题`} onChange={event => setSelectedQuestions(current => event.target.checked ? [...current, question.id] : current.filter(id => id !== question.id))}>第 {index + 1} 题</Checkbox>
              <span><Tag color={question.purpose === 'skill_gap' ? 'orange' : question.purpose === 'resume_project' ? 'blue' : 'default'}>{purposeLabels[question.purpose]}</Tag>{question.category === 'technical' ? '技术' : '综合素质'}{savedIds.includes(question.id) ? ' · 已入库' : ''}</span>
            </div>
            <label htmlFor={`prep-title-${question.id}`}>第 {index + 1} 题标题<Input id={`prep-title-${question.id}`} maxLength={160} value={draft.title} onChange={event => { setDrafts({ ...drafts, [question.id]: { ...draft, title: event.target.value } }); setSaveRequest(null); }} /></label>
            <label htmlFor={`prep-text-${question.id}`}>第 {index + 1} 题题面<Input.TextArea id={`prep-text-${question.id}`} rows={3} maxLength={3000} value={draft.text} onChange={event => { setDrafts({ ...drafts, [question.id]: { ...draft, text: event.target.value } }); setSaveRequest(null); }} /></label>
            <details>
              <summary>评估要点、参考指导与来源引用</summary>
              <label htmlFor={`prep-points-${question.id}`}>评估要点（一行一条，2–5 条）<Input.TextArea id={`prep-points-${question.id}`} rows={4} value={draft.assessmentPoints} onChange={event => { setDrafts({ ...drafts, [question.id]: { ...draft, assessmentPoints: event.target.value } }); setSaveRequest(null); }} /></label>
              <label htmlFor={`prep-guidance-${question.id}`}>参考回答指导（一行一条，2–5 条；是思路，不是替你写好的答案）<Input.TextArea id={`prep-guidance-${question.id}`} rows={4} value={draft.referenceAnswerGuidance} onChange={event => { setDrafts({ ...drafts, [question.id]: { ...draft, referenceAnswerGuidance: event.target.value } }); setSaveRequest(null); }} /></label>
              <QuestionSources question={question} />
            </details>
          </article>;
        })}
        <div className="panel-actions">
          <Button type="primary" loading={save.isPending} disabled={save.isPending || !drafts} onClick={() => save.mutate(requestForSave())}>保存备题修改</Button>
        </div>
        {conflict ? <p role="alert" className="error">备题已在别处更新。你的编辑仍保留在页面上；重新读取会看到两边的差异。</p> : null}
        <p className="storage-note">修改只改可编辑字段；JD 与简历引用的来源哈希保持不变，旧修订仍可恢复。</p>
      </div>
      <div className="career-card">
        <div className="form-heading"><h2>带入严格练习</h2><span className="career-muted">已入库 {savedIds.length} 道</span></div>
        <p className="career-muted">严格练习会使用固定简历文本、该岗位 JD 与所选题库题目，并按现有面试计划规则出题。超出字段上限时不会截断。</p>
        {strictLimits.map(item => <p key={item} role="alert" className="error">{item}</p>)}
        {!savedIds.length ? <p className="career-muted">先保存至少一道题到题库，才能带入练习。</p> : null}
        <div className="panel-actions">
          <Button type="primary" disabled={!canPractice} onClick={() => {
            if (!posting) return;
            onStartPractice({ role: posting.title.slice(0, 120), resume: resumeText, jobDescription: jdText, roleFamily, bankIds: savedIds });
          }}>带入严格练习</Button>
          <Button onClick={() => void exportAs('markdown')}>改为导出备题</Button>
        </div>
        {canPractice && posting ? <p className="career-muted">将带入：{savedIds.length} 道题 · 角色 {posting.title} · 岗位方向 {roleFamily === 'fullstack' ? '全栈' : '通用'}。</p> : null}
      </div>
    </> : null}
    <p className="context-note">备题属于个人资料：只在本机保存与导出，不会进入公开题库或经验库。</p>
  </section>;
}

function QuestionSources({ question }: { question: PersonalizedQuestion }) {
  return <div className="career-evidence">
    <p><strong>JD 原文引用</strong></p>
    <ul>{question.jdSources.map(source => <li key={`jd-${source.start}`}><q>{source.quote}</q></li>)}</ul>
    {question.basis.kind === 'resume_evidence'
      ? <><p><strong>简历原文引用</strong></p><ul>{question.basis.resumeSources.map(source => <li key={`resume-${source.start}`}><q>{source.quote}</q></li>)}</ul></>
      : <p className="career-muted">缺口方向：{question.basis.missingCompetency}（{gapBasisLabel}）</p>}
  </div>;
}
export function CareerPanel({ route, navigate, openModelSettings, openResumeLibrary, onStrictPractice }: {
  route: Route;
  navigate: (route: Route) => void;
  openModelSettings: () => void;
  openResumeLibrary: () => void;
  onStrictPractice: (seed: CareerPracticeSeed) => void;
}) {
  if (route.batchId) return <BatchView batchId={route.batchId} navigate={navigate} />;
  if (route.preparationId) return <PreparationView key={route.preparationId} preparationId={route.preparationId} navigate={navigate} onStartPractice={onStrictPractice} />;
  if (route.taskId) return <TaskView taskId={route.taskId} navigate={navigate} openModelSettings={openModelSettings} onStrictPractice={preparationId => navigate({ page: 'career', preparationId })} />;
  return <CareerLanding navigate={navigate} openModelSettings={openModelSettings} openResumeLibrary={openResumeLibrary} />;
}
