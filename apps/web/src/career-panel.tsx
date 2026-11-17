import { continueApprovedContacts } from './contact-continuation';
import { useEffect, useRef, useState } from 'react';
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { type SearchSource } from '@astryxdesign/core/Typeahead';
import { ConfirmAction } from './ui/confirm-action';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAREER_MAX_BATCH_ITEMS, CAREER_MAX_POSTINGS, careerApprovalSchema, careerPostingPatchSchema, careerTaskCreateSchema,
  type BossSessionView, type CareerBatchItemView, type CareerTaskPostingView, type CareerTaskState, type CareerTaskView,
} from '../../../packages/contracts/src/career';
import { CAREER_DEFAULT_CITIES, CAREER_MAX_CITIES, findBossCity, searchBossCities } from '../../../packages/contracts/src/career-cities';
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

type TagItem = { id: string; label: string };
/** Free-form tag entry: every value is created from typed text, so there is nothing to search. */
const freeTextTags: SearchSource<TagItem> = { search: () => [], bootstrap: () => [] };
/** Only the controlled mainland snapshot can appear here; there is no create option and no free text. */
const cityTags: SearchSource<TagItem> = { search: query => searchBossCities(query).map(city => ({ id: city.name, label: `${city.name} · ${city.province}` })), bootstrap: () => [] };
function cityLabel(name: string) {
  const city = findBossCity(name);
  return city ? `${city.name} · ${city.province}` : name;
}
function cityTagValues(items: TagItem[]) {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of items) {
    if (!findBossCity(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    values.push(item.id);
  }
  return values.slice(0, CAREER_MAX_CITIES);
}
/** Normalise and de-duplicate custom role directions; the token limit is enforced by the control. */
function roleTagValues(items: TagItem[]) {
  const seen = new Map<string, string>();
  for (const item of items) {
    const value = item.label.trim();
    if (!value) continue;
    const key = value.normalize('NFKC').toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()].slice(0, 6);
}
function blacklistTagValues(items: TagItem[]) {
  const seen = new Set<string>();
  for (const item of items) {
    const value = item.label.trim();
    if (value) seen.add(value);
  }
  return [...seen].slice(0, 50);
}
const tabLabels = { eligible: '可投递', needs_review: '需复核', excluded: '已排除', contacted: '已联系过' } as const;

// The badge variant is the only place a disposition becomes visual; the label text carries the meaning.
const dispositionColors: Record<CareerDisposition, BadgeVariant> = { eligible: 'success', needs_review: 'warning', excluded: 'neutral' };
function TaskStateTag({ state }: { state: CareerTaskState }) {
  if (state.status === 'active') return <Badge variant="info" label={phaseLabels[state.phase]} />;
  if (state.status === 'paused') return <Badge variant="warning" label={`已暂停 · ${pauseLabels[state.reason]}`} />;
  if (state.status === 'failed') return <Badge variant="error" label="生成或读取失败" />;
  return <Badge label="已取消" />;
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
    <Button variant="primary" isLoading={open.isPending} isDisabled={pending} onClick={() => { setError(''); open.mutate(); }} label={session?.state === 'ready' ? '重新打开并聚焦本机浏览器' : '打开 BOSS 登录/验证'} />
    <Button isLoading={check.isPending} isDisabled={pending} onClick={() => { setError(''); check.mutate(); }} label="我已完成，检查会话" />
    <ConfirmAction
      title="清除本机 BOSS 会话？"
      description={`会停止并关闭本应用拥有的浏览器、删除私有会话目录，并暂停${affected ? ` ${affected} 个` : '相关'}进行中的求职任务。下次需要重新登录。已发出的沟通或附件无法撤回。`}
      okText="确认清除会话" cancelText="保留会话"
      onConfirm={() => { setError(''); return clear.mutateAsync(); }}
    ><Button variant="destructive" isDisabled={pending} label="清除 BOSS 会话" /></ConfirmAction>
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
      {current?.automationMode === 'contact' ? <Badge variant="blue" label="允许搜索与仅立即沟通，不追加消息或附件" /> : null}
      {current?.automationMode === 'search' ? <Badge variant="blue" label="允许自动搜索，投递已关闭" /> : null}
      {current?.automationMode === 'manual' ? <Badge variant="blue" label="仅手动登录与检查，搜索和投递已关闭" /> : null}
      <span className="career-status-row">
        {current ? <Badge variant={current.state === 'ready' ? 'success' : current.state === 'absent' ? 'neutral' : 'warning'} label={sessionStateLabels[current.state]} /> : null}
        {current ? <Badge label={engineLabels[current.engine]} /> : null}
        {current?.humanWindow === 'open' ? <Badge variant="blue" label="本机窗口已打开" /> : current ? <Badge label="无人工窗口" /> : null}
      </span>
    </div>
    {session.isPending ? <div role="status" className="career-muted"><Spinner size="sm" /> 正在读取会话状态…</div> : null}
    {session.isError ? <Banner role="alert" status="error" title={`会话状态读取失败：${session.error.message}`} endContent={<Button onClick={() => void session.refetch()} label="重新读取" />} /> : null}
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
    <Button onClick={() => void openResumeOriginal(versionId).catch((failure: Error) => setError(failure.message))} label="预览该版本原始文件" />
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
  const [cities, setCities] = useState<string[]>([...CAREER_DEFAULT_CITIES]);
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
      <div className="form-heading"><h2>AI 个性化（可选）</h2><Button onClick={openResumeLibrary} label="打开简历库" /></div>
      <div className="career-fields"><Switch label="启用 AI 匹配、招呼语与备题" labelPosition="start" value={useAi} onChange={setUseAi} /></div>
      {!useAi ? <p className="career-muted">先按城市、岗位、薪资和黑名单预览结果，无需简历或模型。开启 AI 后再选择简历与模型连接。</p> : null}
      {useAi ? <>
      {settings.isError ? <Banner role="alert" status="error" title={`模型状态读取失败：${settings.error.message}`} endContent={<Button onClick={() => void settings.refetch()} label="重试" />} /> : null}
      {settings.data && !active ? <Banner role="alert" status="warning" title="需要先在模型设置里启用一个自带模型连接。匹配、招呼语与备题都绑定这个连接，不会回退到演示模式。" endContent={<Button onClick={openModelSettings} label="配置模型" />} /> : null}
      {active ? <p className="career-muted">当前模型连接：<strong>{active.model}</strong>（{active.remember ? '长期连接' : '临时连接'}，有效至 {dateTime(active.expiresAt)}）</p> : null}
      {versions.isError ? <Banner role="alert" status="error" title={`简历库读取失败：${versions.error.message}`} endContent={<Button onClick={() => void versions.refetch()} label="重试" />} /> : null}
      {versions.data && !versions.data.length ? <EmptyState isCompact title="简历库还没有版本" description="上传原始文件后才会出现在这里。" /> : null}
      {versions.data?.length ? <>
        <Selector
          label="本任务固定的简历版本（匹配、备题与外发附件都用它）" placeholder="选择一个已保存版本" value={resumeVersionId ?? undefined} onChange={value => setResumeVersionId(value)}
          options={versions.data.map(item => ({ value: item.id, label: `${item.label} · ${item.originalName} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}` }))}
        />
        {version ? <div className="resume-pair">
          <div className="resume-pair-head"><strong>{version.label}</strong><span>{version.originalName} · {version.byteSize} 字节 · 原始摘要 {shortHash(version.attachmentSha256)}</span></div>
          <p className="career-muted">提取文本摘要 {shortHash(version.textSha256)}。文本预览：{version.textPreview || '（空）'}</p>
          <div className="panel-actions"><ResumePreviewButton versionId={version.id} /><Button onClick={openResumeLibrary} label="在简历库查看完整文本" /></div>
        </div> : null}
      </> : null}
      </> : null}
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>搜索条件</h2><span className="career-muted">冻结后不会因站点改版而变化；改动条件请新建任务</span></div>
      <fieldset className="career-fields">
        <legend>岗位方向（或）</legend>
        <CheckboxInput label="全栈开发" value={roles.includes('fullstack')} onChange={() => setRoles(toggle(roles, 'fullstack'))} />
        <CheckboxInput label="Agent / AI 应用开发" value={roles.includes('agent_development')} onChange={() => setRoles(toggle(roles, 'agent_development'))} />
      </fieldset>
      <Tokenizer label="添加自定义岗位方向" placeholder="输入方向后按回车，例如：前端、Python、产品经理" value={customRoles.map(value => ({ id: value, label: value }))} searchSource={freeTextTags} debounceMs={0} hasCreate maxEntries={6} hasClear onChange={items => setCustomRoles(roleTagValues(items))} />
      <p className="career-muted">最多添加 6 个方向，每项 1–40 个字符；按回车添加，点标签上的 × 删除。与上方预设按“或”搜索，标题或 JD 包含任一自定义词即匹配方向，其余条件仍逐条核对。可取消全部预设，只用自定义方向。</p>
      <Tokenizer
          containerClassName="career-city-field"
          label={`城市（多选，最多 ${CAREER_MAX_CITIES} 个）`}
          description={`已选 ${cities.length}/${CAREER_MAX_CITIES} 个城市。搜索城市名或省份，例如：杭州、广东。只能从大陆城市列表中选择，不能自由输入。`}
          placeholder="搜索城市或省份后选择"
          value={cities.map(name => ({ id: name, label: cityLabel(name) }))}
          searchSource={cityTags}
          width="100%"
          debounceMs={0}
          maxEntries={CAREER_MAX_CITIES}
          hasClear
          emptySearchText="没有匹配的大陆城市；只能选择列表中的城市。"
          status={cities.length ? undefined : { type: 'error', message: '至少选择一个城市。' }}
          onChange={items => setCities(cityTagValues(items))}
        />
      {!cities.length ? <p className="career-muted" role="status">至少选择一个城市；默认广州、深圳。街道、县、海外地点不在城市列表中，请选择对应的地级城市。</p> : null}
      <NumberInput label="月薪区间上限至少（CNY/月，读到岗位后逐条核对）" min={1000} max={100000} step={1000} value={salary} onChange={value => setSalary(value)} />
      <p className="storage-note">15–25K 与 18–18K 视为达标，10–15K 不达标；面议、年薪、日薪与“20K 以上”等口径会进入需人工复核，不会自动换算。</p>
      <div className="career-fields"><Switch label="AI 应用方向加分（只在匹配质量相同时作为并列排序依据）" labelPosition="start" value={preferAi} onChange={setPreferAi} /></div>
      <Tokenizer label="公司黑名单关键词（字面匹配，忽略大小写与全半角；命中即排除并显示原文）" placeholder="例如：人才服务、劳务派遣" value={blacklist.map(value => ({ id: value, label: value }))} searchSource={freeTextTags} debounceMs={0} hasCreate maxEntries={50} hasClear onChange={items => setBlacklist(blacklistTagValues(items))} />
      <p className="storage-note">明确外包、驻场或劳务派遣会被排除；雇佣关系未知会进入需复核，不会默认视为直招。</p>
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>开始本机搜索</h2><span className="career-muted">不会自动投递</span></div>
      {session.data && session.data.state !== 'ready' ? <Banner role="alert" status="info" title="本机会话尚未就绪。任务会先暂停，完成登录并在会话卡片里检查通过后再手动恢复。" /> : null}
      {useAi ? <CheckboxInput label={`我了解：所选简历的提取文本、读取到的岗位 JD 会发送给当前模型连接 ${active?.model ?? '（未启用）'}；原始简历文件只在本机与本机浏览器之间使用。`} value={acknowledged} onChange={checked => setAcknowledged(checked)} /> : <p className="storage-note">纯规则预览仅保存岗位信息和筛选依据，不调用模型、不发起沟通或发送简历。</p>}
      <div className="panel-actions"><Button variant="primary" isLoading={create.isPending} isDisabled={create.isPending || blockers.length > 0} onClick={start} label={create.isPending ? '正在创建任务…' : '开始本机搜索'} /></div>
      {blockers.length ? <ul className="career-blockers" aria-label="开始前还需要的条件">{blockers.map(item => <li key={item}>{item}</li>)}</ul> : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
    </div>

    <div className="career-card">
      <div className="form-heading"><h2>求职任务历史</h2><Button onClick={() => void tasks.refetch()} isDisabled={tasks.isFetching} label="重新读取" /></div>
      {tasks.isPending ? <p role="status">正在读取任务…</p> : null}
      {tasks.isError ? <Banner role="alert" status="error" title={`任务读取失败：${tasks.error.message}`} endContent={<Button onClick={() => void tasks.refetch()} label="重试" />} /> : null}
      {tasks.data && !tasks.data.length ? <EmptyState isCompact title="还没有求职任务" description="设置条件后手动开始第一个任务。" /> : null}
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
      ? <CheckboxInput isLabelHidden label={`选择 ${posting.observed.company} ${posting.observed.title}`} value={selected} onChange={checked => onToggle(checked)} />
      : <span className="career-row-spacer" aria-hidden="true" />}
    <button type="button" className="career-posting-open" onClick={onOpen}>
      <strong>{posting.observed.title}</strong>
      <span>{posting.observed.company} · {posting.observed.location || '地点未识别'}</span>
      <small>{posting.observed.salaryRaw} · {dispositionLabels[posting.decision.disposition]}{group === 'contacted' ? '（已联系）' : ''}</small>
      {posting.ownerReview ? <small>你的复核：{posting.ownerReview.decision === 'confirmed_direct' ? '已确认直招' : posting.ownerReview.decision === 'excluded' ? '已排除' : '待定'}</small> : null}
      {posting.preparation ? <small>{preparationStatusLabels[posting.preparation.status]}</small> : null}
    </button>
    <Badge variant={group === 'contacted' ? 'purple' : dispositionColors[posting.decision.disposition]} label={group === 'contacted' ? '已联系过' : dispositionLabels[posting.decision.disposition]} />
  </li>;
}

function Evidence({ posting }: { posting: CareerTaskPostingView }) {
  return <div className="career-evidence">
    <h3>硬条件依据</h3>
    <ul>
      {posting.decision.reasons.map(reason => <li key={`${reason.code}-${reason.evidence[0]?.start ?? 'none'}`}>
        <strong>{reasonLabels[reason.code]}</strong>
        {reason.evidence.length
          ? <ul>{reason.evidence.map(item => <li key={`${item.field}-${item.start}`}><Badge label={fieldLabels[item.field]} /><q>{item.quote}</q></li>)}</ul>
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
      <h4>{assessment.competency} <Badge label={assessment.priority === 'required' ? '必备' : '加分'} /><Badge variant={assessment.kind === 'supported' ? 'success' : assessment.kind === 'gap' ? 'warning' : 'neutral'} label={assessment.kind === 'supported' ? '有简历证据' : assessment.kind === 'gap' ? '缺口' : '不确定'} /></h4>
      <p>{assessment.kind === 'supported' ? assessment.rationale : assessment.explanation}</p>
      <ul>
        {assessment.jdSources.map(source => <li key={`jd-${source.start}`}><Badge label="JD" /><q>{source.quote}</q></li>)}
        {assessment.kind === 'supported' ? assessment.resumeSources.map(source => <li key={`resume-${source.start}`}><Badge variant="blue" label="简历" /><q>{source.quote}</q></li>) : null}
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
      <TextArea label={`招呼语（草稿版本 ${posting.greetingRevision}）`} rows={6} maxLength={1200} value={text} onChange={value => { setText(value); setRequest(null); setConflict(false); }} />
      <p className="career-muted">{text.trim().length} / 1200 个字符。{problem ?? '可以保存后继续核对。'}</p>
      <div className="panel-actions"><Button isLoading={save.isPending} isDisabled={save.isPending || Boolean(problem) || text.trim() === saved.trim()} onClick={() => save.mutate(request ?? requestId())} label="保存招呼语草稿" /></div>
      {conflict ? <p role="alert" className="error">草稿已在别处更新（可能是另一个页面或重新生成）。你的修改仍保留在这里；请重新读取后再决定。 <Button size="sm" onClick={onReload} label="重新读取岗位" /></p> : null}
      {posting.greeting?.factualClaims.length ? <div className="career-claims">
        <strong>招呼语里引用的事实</strong>
        {posting.greeting.factualClaims.map(claim => <article key={claim.claim}>
          <p>{claim.claim}</p>
          <ul>{claim.resumeSources.map(source => <li key={`claim-resume-${source.start}`}><Badge variant="blue" label="简历" /><q>{source.quote}</q></li>)}
            {claim.jdSources.map(source => <li key={`claim-jd-${source.start}`}><Badge label="JD" /><q>{source.quote}</q></li>)}</ul>
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
    <Selector label="复核结论" value={decision} onChange={value => { setDecision(parseOwnerReviewDecision(value)); setRequest(null); }}
      options={[{ value: 'unresolved', label: '保持待定' }, { value: 'confirmed_direct', label: '确认公司直招' }, { value: 'excluded', label: '复核后排除' }]} />
    {/* TextInput has no maxLength prop, so the field keeps its 200 character contract limit while typing. */}
    <TextInput label="你看到的依据来源（确认直招时必填）" value={source} onChange={value => { setSource(value.slice(0, 200)); setRequest(null); }} placeholder="例如：招聘主页“公司直招”原文 / 岗位页公司信息" />
    <TextInput label="复核备注" value={note} onChange={value => { setNote(value.slice(0, 600)); setRequest(null); }} />
    {needsSource ? <p role="alert" className="error">确认直招必须填写你看到的依据来源。</p> : null}
    {conflict ? <p role="alert" className="error">该岗位记录已被其他操作更新，请重新读取后再提交复核。</p> : null}
    <div className="panel-actions"><Button isLoading={save.isPending} isDisabled={save.isPending || needsSource} onClick={() => save.mutate(request ?? requestId())} label="提交复核" /></div>
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
        <Badge variant={group === 'contacted' ? 'purple' : dispositionColors[posting.decision.disposition]} label={group === 'contacted' ? '之前已联系过，本任务不能重复发起' : dispositionLabels[posting.decision.disposition]} />
        <Badge label={`快照 ${shortHash(posting.snapshotHash)}`} />
        <Badge label={`岗位编号 ${posting.observed.sitePostingId}`} />
      </p>
      <p className="career-muted">岗位链接：<a href={posting.observed.url} target="_blank" rel="noreferrer">在没有登录态的普通浏览器里打开（不会带本应用会话）</a></p>
    </header>
    <details open><summary>岗位原文</summary><pre className="career-jd">{posting.observed.jdText || '（未读到 JD 正文）'}</pre></details>
    <details open><summary>招聘主体与公司原文</summary><pre className="career-jd">{posting.observed.companyProfileText || '（未读到公司说明，不能据此确认直招）'}</pre></details>
    {task.mode==='preview'?<div className="panel-actions"><Button isLoading={reinspect.isPending} isDisabled={reinspect.isPending||busy} onClick={()=>reinspect.mutate()} label="重新核对公司信息" /><Button onClick={onReload} label="重新读取核对结果" /></div>:null}
    <Evidence posting={posting} />
    <MatchEvidence posting={posting} />
    {group === 'needs_review' ? <OwnerReview task={task} posting={posting} onUpdated={onUpdated} onError={onError} onNotice={onNotice} /> : null}
    {task.mode !== 'preview' && (posting.decision.disposition === 'eligible' || posting.greeting) ? <GreetingEditor task={task} posting={posting} onUpdated={onUpdated} onReload={onReload} onError={onError} onNotice={onNotice} /> : null}
    <div className="career-evidence">
      <h3>个性化备题</h3>
      {task.mode !== 'personalized' ? <p className="career-muted">此任务未启用 AI，不会自动生成个性化备题。</p> : null}
      {posting.preparation
        ? <p>{preparationStatusLabels[posting.preparation.status]}（版本 {posting.preparation.revision}） <Button size="sm" onClick={() => onOpenPreparation(posting.preparation?.id ?? '')} label="打开备题" /></p>
        : <><p className="career-muted">只有在你批准后才会自动生成；这个岗位还没有备题。也可以现在手动生成（不影响外发）。</p>
          <Button isLoading={generate.isPending} isDisabled={task.mode !== 'personalized' || busy || generate.isPending} onClick={() => generate.mutate()} label="为这个岗位生成 10 道个性化备题" /></>}
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
    {versions.isError?<Banner role="alert" status="error" title={versions.error.message}/>:null}
    <Selector label="绑定本地简历版本" placeholder="选择本地简历库版本" value={versionId ?? undefined} onChange={value=>{setVersionId(value);setRequest(requestId());setProblem('');}} options={versions.data?.map(version=>({value:version.id,label:version.label}))??[]} />
    <div className="panel-actions"><Button isLoading={bind.isPending} isDisabled={!versionId||bind.isPending} onClick={()=>bind.mutate()} label="绑定并准备投递" /></div>
    {problem?<Banner role="alert" status="error" title={problem}/>:null}
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
      <div className="form-heading"><h2>固定简历与模型</h2><Button onClick={onBack} isDisabled={approve.isPending} label="返回复核" /></div>
      {version.isPending ? <p role="status">正在读取所选简历版本…</p> : null}
      {version.isError ? <Banner role="alert" status="error" title={`所选简历版本读取失败：${version.error.message}`} /> : null}
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
          <p className="career-status-row"><Badge variant="success" label={`硬条件：${dispositionLabels[posting.decision.disposition]}`} /><Badge label={`快照 ${shortHash(posting.snapshotHash)}`} /><Badge label={`草稿版本 ${posting.greetingRevision}`} /></p>
          <p className="career-muted">{posting.observed.location || '地点未识别'} · {posting.observed.salaryRaw} · 岗位编号 {posting.observed.sitePostingId}</p>
          <TextArea label="最终招呼语（会按此处文字原样发送）" rows={5} maxLength={1200} value={text} onChange={value => changeGreeting(posting.id, value)} />
          {greetingFailure ? <p role="alert" className="error">{greetingFailure}</p> : null}
        </article>;
      })}
    </div>
    {blockers.length ? <Banner role="alert" status="error" title="还不能批准" description={<ul>{blockers.map(item => <li key={item}>{item}</li>)}</ul>} /> : null}
    {warnings.map(item => <Banner role="alert" key={item} status="warning" title={item} />)}
    {problem ? <Banner role="alert" status="error" title={problem} /> : null}
    <div className="career-card">
      <CheckboxInput label={`我已逐条核对上面 ${selected.length} 个岗位、每个岗位的最终招呼语和唯一的简历附件。我明白确认后会立即尝试发起沟通并发送该简历，且已发送的内容不能撤回。`} value={confirmed} isDisabled={approve.isPending} onChange={checked => { setConfirmed(checked); setRequest(null); }} />
      <div className="panel-actions">
        <Button onClick={onBack} isDisabled={approve.isPending} label="取消，返回复核" />
        <Button variant="destructive" isLoading={approve.isPending} isDisabled={approve.isPending || !confirmed || blockers.length > 0} onClick={() => { const id = request ?? requestId(); if (!request) setRequest(id); setProblem(''); approve.mutate(id); }} label={approve.isPending ? '正在冻结并提交…' : `确认冻结并批准这批（${selected.length} 条）`} />
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
    {!task.shortlistCount?<Banner role="alert" status="info" title={`当前没有可沟通岗位：${task.reviewCount} 个待复核，${task.excludedCount} 个已排除。先在待复核列表核对直招依据，通过后再勾选岗位。`}/>:null}
    {alreadyApproved?<p className="career-muted">所选岗位已有沟通记录，请核对下方状态，系统不会重复点击。</p>:null}
    {!modeAllowed?<p className="career-muted">当前配置尚未开启仅沟通执行。</p>:null}
    {session?.state!=='ready'?<p className="career-muted">请先打开并检查本机 BOSS 会话。</p>:null}
    <ConfirmAction title={`确认仅对这 ${selected.length} 个岗位发起沟通？`} description={<div><p>将使用站内自动招呼词；不会额外发送消息或简历。</p><ul>{selected.map(posting=><li key={posting.id}>{posting.observed.company} · {posting.observed.title} · {posting.observed.salaryRaw}</li>)}</ul></div>} okText="确认仅立即沟通" cancelText="返回复核" onConfirm={()=>approve.mutateAsync()}>
      <Button variant="primary" isLoading={approve.isPending} isDisabled={blocked||approve.isPending||continuation.isPending} label={`确认所选 ${selected.length} 个岗位，仅立即沟通`} />
    </ConfirmAction>
    {approve.isError?<Banner role="alert" status="error" title={approve.error.message}/>:null}
    {approve.isSuccess?<p role="status">已保存沟通批准，下面显示真实执行状态。相同请求不会重复排队。</p>:null}
    <Button isLoading={continuation.isPending} isDisabled={!modeAllowed||session?.state!=='ready'||task.state.status!=='active'||retry.isPending||approve.isPending||continuation.isPending||!records.data?.some(row=>row.state==='failed')||records.data.some(row=>['unknown','queued','dispatching'].includes(row.state))} onClick={()=>continuation.mutate()} label="继续已批准且未点击的记录" />
    {continuation.isPending?<Button onClick={()=>continuationController.current?.abort()} label="停止后续提交" />:null}
    <p className="career-muted">程序逐条提交并等待结果，失败或未知即停止；关闭页面后不再提交下一条，已排队动作仍需核对执行记录。</p>
    {continuation.data?<p role="status">本轮确认 {continuation.data.completed} 条；{({completed:'本轮已结束',blocked:'存在执行中或未知记录，已停止',changed:'记录已变化，请重新核对',failed:'点击前失败，已停止',unknown:'结果未知，禁止重发',cancelled:'后续提交已停止',timeout:'等待结果超时，未继续'})[continuation.data.reason]}。</p>:null}
    {continuation.isError?<Banner role="alert" status="error" title={continuation.error.message}/>:null}
    {retry.isError?<Banner role="alert" status="error" title={retry.error.message}/>:null}
    {records.isError?<Banner role="alert" status="error" title={records.error.message}/>:null}
    <ul aria-label="站内沟通执行记录">{records.data?.map(record=><li key={record.id}><strong>{record.company} · {record.title}</strong> — {labels[record.state]}{record.reason?'（原因见下方记录）':''}{record.state==='failed'?<Button size="sm" isLoading={retry.isPending} isDisabled={continuation.isPending} onClick={()=>retry.mutate(record)} label="重试这条未点击的记录" />:null}{record.evidence.map((item,index)=><p key={index}>{item.summary}</p>)}</li>)}</ul>
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

  if (task.isPending) return <section className="career"><div role="status" className="loading"><Spinner size="sm" /> 正在读取求职任务…</div></section>;
  if (task.isError) return <section className="career"><Banner role="alert" status="error" title={`任务读取失败：${task.error.message}`} endContent={<Button onClick={() => void task.refetch()} label="重新读取" />} /></section>;
  if (!current) return null;
  if (approving) return <ApprovalPanel task={current} selected={selectedPostings} session={session.data} onBack={() => setApproving(false)}
    onApproved={batchId => navigate({ page: 'career', batchId })} />;

  const warning = taskWarning(current);
  return <section className="career" aria-labelledby="career-task-title">
    <div className="intro">
      <h1 id="career-task-title">任务 {current.id.slice(0, 8)}</h1>
      <p>{[...current.policy.roleTargets.map(role => role === 'fullstack' ? '全栈' : 'Agent 开发'), ...(current.policy.customRoleKeywords ?? [])].join(' / ')} · {current.policy.cities.join(' / ')} · ≥{current.policy.salaryUpperMinCnyMonthly} 元/月 · 读取 {current.readCount}/{CAREER_MAX_POSTINGS} · 模型 {current.model?.label ?? '纯规则预览'}</p>
      {current.mode === 'preview' ? <Banner role="alert" status="info" title="岗位筛选与站内沟通" description="岗位已在系统保存并按条件分组。先复核直招依据，通过后勾选岗位，使用下方“仅立即沟通”；不要求本地简历或模型。" /> : null}
      <p className="career-status-row"><TaskStateTag state={current.state} />{current.resumeTextSha256 ? <Badge label={`简历 ${shortHash(current.resumeTextSha256)}`} /> : <Badge label="仅站内自动招呼，无需本地简历" />}{current.attachmentSha256 ? <Badge label={`附件 ${shortHash(current.attachmentSha256)}`} /> : null}<Button size="sm" onClick={() => navigate({ page: 'career' })} label="返回求职首页" /></p>
      <p className="career-muted">公司黑名单：{current.policy.companyBlacklistKeywords.length ? current.policy.companyBlacklistKeywords.join('、') : '未设置'} · AI 应用加分：{current.policy.preferAiApplication ? '是（仅并列排序）' : '否'}</p>
    </div>
    {settings.isError ? <Banner role="alert" status="error" title={`模型状态读取失败：${settings.error.message}`} /> : null}
    {warning ? <Banner role="alert" status="warning" title={warning} /> : null}
    {current.state.status === 'paused' ? <div className="career-card">
      <div className="form-heading"><h2>暂停处理</h2><span className="career-muted">{pauseLabels[current.state.reason]}</span></div>
      <p>{current.state.detail}</p>
      <p className="career-muted">修复本机会话或站点状态后，再手动恢复任务。恢复不会重发任何已确认的沟通或附件。</p>
      <div className="panel-actions">
        <Button isLoading={resumeTask.isPending} isDisabled={resumeTask.isPending} onClick={() => { setError(''); resumeTask.mutate(); }} label="恢复任务" />
        <Button onClick={() => setResumeOpen(value => !value)} label={resumeOpen ? '收起会话操作' : '打开登录/检查会话'} />
      </div>
      {resumeOpen ? <BossSessionCard /> : null}
    </div> : null}
    {current.state.status === 'failed' && current.mode === 'personalized' ? <div className="career-card">
      <div className="form-heading"><h2>重试生成</h2><span className="career-muted">只影响匹配与招呼语，不会外发</span></div>
      <p>{current.state.error}</p>
      <p className="career-muted">重试需要显式同意：所选简历文本与岗位 JD 会再次发送给当前模型连接 {settings.data?.active?.model ?? '（无）'}。</p>
      <CheckboxInput label="我同意用当前模型连接重试生成" value={retryAcknowledged} onChange={checked => setRetryAcknowledged(checked)} />
      <div className="panel-actions">
        <Button isLoading={retryGeneration.isPending} isDisabled={retryGeneration.isPending || !retryAcknowledged || !connectionId()} onClick={() => { setError(''); retryGeneration.mutate(); }} label="重试失败的生成" />
        <Button onClick={openModelSettings} label="更换模型连接" />
      </div>
      {!connectionId() ? <p role="alert" className="error">没有已启用的模型连接。请先在模型设置里启用后再重试。</p> : null}
    </div> : null}
    {current.state.status === 'failed' && current.mode === 'preview' ? <Banner role="alert" status="error" title={current.state.error} endContent={<Button onClick={() => navigate({ page: 'career' })} label="返回条件页重新搜索" />} /> : null}

    {error ? <Banner role="alert" status="error" title={error} endContent={<Button onClick={() => setError('')} label="关闭" />} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="career-card">
      <div className="form-heading">
        <h2>岗位复核</h2>
        <span className="career-muted">可投递 {groups.eligible.length} · 需复核 {groups.needs_review.length} · 已排除 {groups.excluded.length} · 已联系过 {groups.contacted.length}</span>
      </div>
      {postings.isPending ? <div role="status" className="career-muted"><Spinner size="sm" /> 正在读取本次读到的岗位…</div> : null}
      {postings.isError ? <Banner role="alert" status="error" title={`岗位读取失败：${postings.error.message}`} endContent={<Button onClick={reloadPostings} label="重新读取" />} /> : null}
      {postings.data && !postings.data.length ? <EmptyState isCompact title={scanning ? '正在读取岗位' : '本次任务没有读到岗位记录'} description={scanning ? '正在读取岗位，还没有可展示的记录。' : '原因可能登录未就绪、原生筛选未生效或站点没有返回结果，不能理解为“没有符合条件的岗位”。'} /> : null}
      {postings.data?.length ? <>
        <div className="career-selection">
          <span>已选 {selected.length}/{CAREER_MAX_BATCH_ITEMS} 个可投递岗位</span>
          <div className="panel-actions">
            <Button onClick={() => { setSelected(groups.eligible.slice(0, CAREER_MAX_BATCH_ITEMS).map(posting => posting.id)); keptSelection.set(taskId, groups.eligible.slice(0, CAREER_MAX_BATCH_ITEMS).map(posting => posting.id)); }} isDisabled={!groups.eligible.length} label={`选中前 ${Math.min(CAREER_MAX_BATCH_ITEMS, groups.eligible.length)} 个可投递岗位`} />
            <Button onClick={() => { setSelected([]); keptSelection.set(taskId, []); }} isDisabled={!selected.length} label="清空选择" />
            <Button variant="primary" isDisabled={!selected.length || current.mode === 'preview'} onClick={() => { setError(''); setNotice(''); setApproving(true); }} label="可选：自定义文案与本地附件审批" />
          </div>
          <p className="career-muted">勾选只保存在当前页面会话内；刷新后需要重新勾选，已保存的招呼语草稿不受影响。</p>
        </div>
        <TabList value={tab} onChange={value => { const next = value === 'needs_review' || value === 'excluded' || value === 'contacted' ? value : 'eligible'; setTab(next); setOpenPostingId(null); }} aria-label="岗位分组">
          {(['eligible', 'needs_review', 'excluded', 'contacted'] as const).map(key => <Tab key={key} value={key} label={`${tabLabels[key]} ${groups[key].length}`} panelId="career-posting-panel" />)}
        </TabList>
        <div id="career-posting-panel" role="tabpanel">
        {groups[tab].length
          ? <div className="career-review">
            <ul className="career-posting-list" aria-label={`${tabLabels[tab]}岗位`}>
              {groups[tab].map(posting => <PostingRow key={posting.id} posting={posting} selected={selected.includes(posting.id)}
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
              {openPosting && groups[tab].some(posting => posting.id === openPosting.id)
                ? <PostingDetail task={current} posting={openPosting} busy={false} onUpdated={updatePosting} onReload={reloadPostings}
                  onOpenPreparation={preparationId => navigate({ page: 'career', preparationId })}
                  onError={setError} onNotice={setNotice} />
                : <p className="career-muted">选择左侧一个岗位，查看硬条件依据、匹配证据与可编辑招呼语。</p>}
            </div>
          </div>
          : <EmptyState isCompact title={tab === 'eligible' ? '还没有可投递岗位' : '这一类暂时没有记录'} description={tab === 'eligible' ? '需复核与已排除的记录仍然在对应标签里。' : '切回其他分组可以继续核对岗位记录。'} />}
        </div>
      </> : null}
    </div>
    <SiteContactPanel task={current} selected={selectedPostings} session={session.data}/>
    <details><summary>可选：本地简历与自定义文案投递</summary><PreviewResumeBinding task={current}/></details>
    <div className="career-card">
      <div className="form-heading"><h2>任务操作</h2><span className="career-muted">取消与删除都不会撤回已发送的内容</span></div>
      <div className="panel-actions">
        <ConfirmAction title="取消这个任务？" description="停止读取新岗位并撤销未开始的外发；已发出的沟通或附件保留实际结果。" okText="确认取消任务" cancelText="保留"
          onConfirm={() => { setError(''); return cancel.mutateAsync(); }}><Button variant="destructive" isDisabled={current.state.status === 'cancelled' || cancel.isPending} label="取消任务" /></ConfirmAction>
        <ConfirmAction title="删除任务及其个人快照？" description="会先取消任务，再删除岗位快照、招呼语、备题等派生数据；由这些备题保存到题库的题目，以及用它们开展的整个严格面试（含全部作答历史）也会一起删除。简历库版本保留。用于去重的最少量岗位记录会保留但没有个人文本。" okText="确认删除任务" cancelText="保留"
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
          }}><Button variant="destructive" label="删除任务" /></ConfirmAction>
      </div>
      {current.batches.length ? <ul className="career-task-list" aria-label="该任务的批次">
        {current.batches.map(batch => <li key={batch.id}>
          <button type="button" className="career-task-row" onClick={() => navigate({ page: 'career', batchId: batch.id })}>
            <strong>批次 {batch.id.slice(0, 8)}</strong>
            <span><Badge variant={batch.state === 'completed' ? 'success' : batch.state === 'cancelled' ? 'neutral' : 'blue'} label={batchStateLabels[batch.state]} />批准于 {dateTime(batch.approvedAt)}</span>
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

  if (batch.isPending) return <section className="career"><div role="status" className="loading"><Spinner size="sm" /> 正在读取批次…</div></section>;
  if (batch.isError) return <section className="career"><Banner role="alert" status="error" title={`批次读取失败：${batch.error.message}`} endContent={<Button onClick={() => void batch.refetch()} label="重新读取" />} /></section>;
  const data = batch.data;
  if (!data) return null;
  const outcome = batchOutcome(data);
  return <section className="career" aria-labelledby="career-batch-title">
    <div className="intro">
      <h1 id="career-batch-title">批次 {data.id.slice(0, 8)}</h1>
      <p>批准于 {dateTime(data.approvedAt)} · 冻结摘要 {shortHash(data.digest)} · 任务版本 {data.taskRevision}</p>
      <p className="career-status-row"><Badge variant={data.state === 'completed' ? 'success' : data.state === 'cancelled' ? 'neutral' : data.state === 'paused' ? 'warning' : 'blue'} label={batchStateLabels[data.state]} /><Button size="sm" onClick={() => navigate({ page: 'career', taskId: data.taskId })} label="返回任务" /><Button size="sm" onClick={() => navigate({ page: 'career' })} label="求职首页" /></p>
    </div>
    {outcome.pauseLabel ? <Banner role="alert" status="warning" title={`批次已暂停：${outcome.pauseLabel}`} description="登录、人机验证或站点限制会暂停整批。完成本机会话检查后再手动恢复。" /> : null}
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
        <Button onClick={() => setSessionOpen(value => !value)} label={sessionOpen ? '收起会话操作' : '打开登录/检查会话'} />
        <Button isLoading={resume.isPending} isDisabled={resume.isPending || data.state !== 'paused'} onClick={() => { setError(''); resume.mutate(); }} label="恢复批次" />
        {data.state === 'paused' && session.data?.state !== 'ready' ? <span className="career-muted">恢复前需要会话状态为“已就绪”。</span> : null}
        <ConfirmAction title="取消这个批次？" description="停止后续投递并撤销未开始的阶段；已发出的沟通或附件无法撤回，会保留实际观测结果。" okText="确认取消批次" cancelText="保留"
          onConfirm={() => { setError(''); return cancel.mutateAsync(); }}><Button variant="destructive" isDisabled={cancel.isPending || data.state === 'cancelled'} label="取消批次" /></ConfirmAction>
      </div>
      {sessionOpen ? <BossSessionCard busy={resume.isPending} /> : null}
      {error ? <Banner role="alert" status="error" title={error} endContent={<Button onClick={() => setError('')} label="关闭" />} /> : null}
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
            <h3>沟通：<Badge variant={item.conversation.state === 'confirmed' ? 'success' : item.conversation.state === 'unknown' ? 'error' : 'neutral'} label={conversationStateLabels[item.conversation.state]} /></h3>
            {item.conversation.reason ? <p className="career-muted">原因：{item.conversation.reason}</p> : null}
            <ul>{item.conversation.evidence.map(entry => <li key={`${entry.observedAt}-${entry.summary}`}><span className="career-muted">{dateTime(entry.observedAt)}</span> {entry.summary}</li>)}</ul>
          </div>
          <div>
            <h3>附件：<Badge variant={item.attachment.state === 'confirmed' ? 'success' : item.attachment.state === 'unknown' ? 'error' : 'neutral'} label={attachmentStateLabels[item.attachment.state]} /></h3>
            <p className="career-muted">{item.attachment.originalName} · {shortHash(item.attachment.attachmentSha256)}</p>
            {item.attachment.reason ? <p className="career-muted">原因：{item.attachment.reason}</p> : null}
            <ul>{item.attachment.evidence.map(entry => <li key={`${entry.observedAt}-${entry.summary}`}><span className="career-muted">{dateTime(entry.observedAt)}</span> {entry.summary}</li>)}</ul>
          </div>
          <div>
            <h3>备题：{item.preparation ? <Badge variant={item.preparation.status === 'ready' ? 'success' : item.preparation.status === 'failed' ? 'error' : 'neutral'} label={preparationStatusLabels[item.preparation.status]} /> : <span className="career-muted">未生成</span>}</h3>
            {item.preparation ? <div className="panel-actions">
              <Button size="sm" onClick={() => navigate({ page: 'career', preparationId: item.preparation?.id ?? '' })} label="打开备题" />
              {item.preparation.status === 'failed' ? <Button size="sm" isLoading={preparationRetry.isPending} onClick={() => preparationRetry.mutate(item.preparation?.id ?? '')} label="只重试备题" /> : null}
            </div> : null}
          </div>
        </div>
        <div className="panel-actions">
          {batchItemActions(item, data.state).map(action => <Button key={action} size="sm" isLoading={itemAction.isPending} onClick={() => { setError(''); itemAction.mutate({ action, item }); }} label={actionLabels[action]} />)}
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

  if (preparation.isPending) return <section className="career"><div role="status" className="loading"><Spinner size="sm" /> 正在读取备题…</div></section>;
  if (preparation.isError) return <section className="career"><Banner role="alert" status="error" title={`备题读取失败：${preparation.error.message}`} endContent={<Button onClick={() => void preparation.refetch()} label="重新读取" />} /></section>;
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
      <p className="career-status-row"><Button size="sm" onClick={() => navigate({ page: 'career', taskId: data.taskId })} label="返回任务" /></p>
    </div>
    {error ? <Banner role="alert" status="error" title={error} endContent={<Button onClick={() => setError('')} label="关闭" />} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {data.status === 'failed' ? <div className="career-card">
      <h2>备题生成失败</h2>
      <p>{data.failure ?? '没有记录失败原因。'}</p>
      <p className="career-muted">只重试备题：不会重发招呼语或附件，也不会改变已批准的批次。</p>
      <Button isLoading={retry.isPending} isDisabled={retry.isPending} onClick={() => { setError(''); retry.mutate(); }} label="重试备题" />
    </div> : null}
    {['queued', 'generating'].includes(data.status) ? <div className="career-card"><div role="status" className="career-muted"><Spinner size="sm" /> 正在用固定简历与冻结 JD 生成 10 道题…</div><p className="career-muted">外发进度与备题互不等待。</p></div> : null}
    {server ? <>
      <div className="career-card">
        <div className="form-heading"><h2>来源与用途</h2><span className="career-muted">JD 摘要 {shortHash(server.sourceHashes.jd)} · 简历摘要 {shortHash(server.sourceHashes.resume)}</span></div>
        <p className="career-muted">{purposes.map(item => `${purposeLabels[item.purpose]} ${item.count} 道`).join(' · ')}</p>
        <p className="career-muted">缺口类题目只表示“准备方向”，{gapBasisLabel}。没有项目证据时不会编造项目。</p>
        {server.uncertainties.length ? <p className="career-muted">生成时的不确定项：{server.uncertainties.join('；')}</p> : null}
        <div className="panel-actions">
          <Button onClick={() => void exportAs('markdown')} label="导出 Markdown" />
          <Button onClick={() => void exportAs('json')} label="导出 JSON" />
        </div>
      </div>
      <div className="career-card">
        <div className="form-heading"><h2>10 道题（可编辑）</h2><span className="career-muted">已选 {selectedQuestions.length} 道</span></div>
        <div className="panel-actions">
          <Button onClick={() => setSelectedQuestions(server.questions.map(question => question.id))} label="全选题目" />
          <Button onClick={() => setSelectedQuestions([])} isDisabled={!selectedQuestions.length} label="清空选择" />
          <Button isLoading={bank.isPending} isDisabled={!selectedQuestions.length || bank.isPending} onClick={() => { setError(''); bank.mutate(); }} label="保存所选到题库" />
          <Button onClick={() => navigate({ page: 'bank' })} label="打开题库" />
        </div>
        {selectedQuestions.some(questionId => savedIds.includes(questionId)) ? <p className="career-muted">已保存过的题目会返回同一个题库条目，不会重复创建。</p> : null}
        {server.questions.map((question, index) => {
          const draft = drafts?.[question.id];
          if (!draft) return null;
          return <article className="career-prep-question" key={question.id}>
            <div className="preparation-card-heading">
              <CheckboxInput label={`第 ${index + 1} 题`} value={selectedQuestions.includes(question.id)} onChange={checked => setSelectedQuestions(current => checked ? [...current, question.id] : current.filter(id => id !== question.id))} />
              <span><Badge variant={question.purpose === 'skill_gap' ? 'warning' : question.purpose === 'resume_project' ? 'blue' : 'neutral'} label={purposeLabels[question.purpose]} />{question.category === 'technical' ? '技术' : '综合素质'}{savedIds.includes(question.id) ? ' · 已入库' : ''}</span>
            </div>
            <TextInput label={`第 ${index + 1} 题标题`} value={draft.title} onChange={value => { setDrafts({ ...drafts, [question.id]: { ...draft, title: value.slice(0, 160) } }); setSaveRequest(null); }} />
            <TextArea label={`第 ${index + 1} 题题面`} rows={3} maxLength={3000} value={draft.text} onChange={value => { setDrafts({ ...drafts, [question.id]: { ...draft, text: value } }); setSaveRequest(null); }} />
            <details>
              <summary>评估要点、参考指导与来源引用</summary>
              <TextArea label="评估要点（一行一条，2–5 条）" rows={4} value={draft.assessmentPoints} onChange={value => { setDrafts({ ...drafts, [question.id]: { ...draft, assessmentPoints: value } }); setSaveRequest(null); }} />
              <TextArea label="参考回答指导（一行一条，2–5 条；是思路，不是替你写好的答案）" rows={4} value={draft.referenceAnswerGuidance} onChange={value => { setDrafts({ ...drafts, [question.id]: { ...draft, referenceAnswerGuidance: value } }); setSaveRequest(null); }} />
              <QuestionSources question={question} />
            </details>
          </article>;
        })}
        <div className="panel-actions">
          <Button variant="primary" isLoading={save.isPending} isDisabled={save.isPending || !drafts} onClick={() => save.mutate(requestForSave())} label="保存备题修改" />
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
          <Button variant="primary" isDisabled={!canPractice} onClick={() => { if (!posting) return; onStartPractice({ role: posting.title.slice(0, 120), resume: resumeText, jobDescription: jdText, roleFamily, bankIds: savedIds }); }} label="带入严格练习" />
          <Button onClick={() => void exportAs('markdown')} label="改为导出备题" />
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
