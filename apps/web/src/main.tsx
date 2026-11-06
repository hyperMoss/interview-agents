import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfigProvider, Input, Popconfirm, Select, Tabs } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { InterviewInput } from '../../../packages/contracts/src/index';
import { interviewStatusSchema } from '../../../packages/contracts/src/history';
import { searchChoiceSchema } from '../../../packages/contracts/src/search';
import { workspaceIntakeSchema } from '../../../packages/contracts/src/workspace';
import { ModelPanel } from './model-panel';
import { SearchPanel } from './search-panel';
import { BankPanel } from './bank-panel';
import { PreparationPanel, type PreparedPractice, type PreparationSeed } from './preparation-panel';
import type { AlgorithmSeed } from './algorithm-panel';
import { Intake } from './intake';
import { Interview } from './interview';
import { HomePanel, ReviewPanel } from './home-panel';
import { CareerPanel, type CareerPracticeSeed } from './career-panel';
import { ResumeLibrary } from './resume-library';
import { DataPanel, WorkspaceSaveStatus } from './data-panel';
import { initializeWorkspace } from './workspace-store';
import { readSession, writeSession, tryClearInterviewDrafts } from './storage';
import { defaultPlanning } from './planning-panel';
import { parseRoute, useWorkspaceRoute, statusLabels, type Route } from './navigation';
import './style.css';
import './usability.css';
import { ModuleNavigation, MobileNavigation, moduleTitle } from './module-navigation';
import './module-layout.css';
import { resumeText } from '../../../packages/resume/src/import';
import type { ResumeDocument } from '../../../packages/contracts/src/resume-document';
import { removeInterviewReviews } from './personal-data';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true }, mutations: { retry: 0, gcTime: 0 } } });
const ResumeStudio = React.lazy(() => import('./resume-studio').then(module => ({ default: module.ResumeStudio })));
const AlgorithmPanel = React.lazy(() => import('./algorithm-panel').then(module => ({ default: module.AlgorithmPanel })));

function App() {
  const cache = useQueryClient();
  const { route, navigate } = useWorkspaceRoute();
  const latestRoute = useRef(route); latestRoute.current = route;
  const selected = route.page === 'practice' ? route.sessionId : undefined;
  const [returnTo, setReturnTo] = useState<Route>({ page: 'practice' });
  const [intakeVersion, setIntakeVersion] = useState(0);
  const [preparationRequest, setPreparationRequest] = useState<{ id: string; seed: PreparationSeed } | null>(null);
  const [algorithmRequest, setAlgorithmRequest] = useState<{ id: string; seed: AlgorithmSeed } | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState<string>('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(historySearch), 250); return () => window.clearTimeout(timer); }, [historySearch]);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const status = interviewStatusSchema.safeParse(historyStatus);
  const history = useInfiniteQuery({
    queryKey: ['history', debouncedSearch, historyStatus],
    queryFn: ({ pageParam }) => api.history({ role: debouncedSearch, ...(status.success ? { status: status.data } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '', getNextPageParam: page => page.nextCursor ?? undefined, enabled: identity.isSuccess,
    refetchInterval: query => query.state.data?.pages.some(page => page.items.some(item => ['preparing', 'evaluating'].includes(item.status))) ? 2000 : false,
  });
  const recent = useQuery({ queryKey: ['recent-history'], queryFn: () => api.history({ limit: 20 }), enabled: identity.isSuccess && route.page === 'home' });
  const items = history.data?.pages.flatMap(page => page.items) ?? [];
  const settings = useQuery({ queryKey: ['model-settings'], queryFn: api.modelSettings, enabled: identity.isSuccess });
  const searchSettings = useQuery({ queryKey: ['search-settings'], queryFn: api.searchSettings, enabled: identity.isSuccess });
  const session = useQuery({ queryKey: ['session', selected], queryFn: () => api.get(selected ?? ''), enabled: Boolean(selected) && identity.isSuccess,
    refetchInterval: query => query.state.data && ['preparing', 'evaluating'].includes(query.state.data.status) ? 1000 : false });
  function invalidateHistory() { void cache.invalidateQueries({ queryKey: ['history'] }); void cache.invalidateQueries({ queryKey: ['recent-history'] }); }
  function newPractice() { create.reset(); setNotice(''); navigate({ page: 'practice' }); }
  function openUtility(page: 'model' | 'search' | 'bank' | 'data' | 'resumeLibrary') {
    if (!['model', 'search', 'data'].includes(route.page)) setReturnTo(route);
    if (route.page === 'preparation') setPreparationRequest(null);
    navigate({ page });
  }
  function useResumeForPractice(document: ResumeDocument) {
    const resume = resumeText(document);
    writeSession('interview-intake', JSON.stringify({ role: document.title, resume, jobDescription: '', level: 'mid', questionCount: 6, focus: '', planning: defaultPlanning, step: 0 }));
    setIntakeVersion(value => value + 1); newPractice();
    setNotice('已从简历库带入已保存的简历。填写目标岗位与 JD 后，确认面试安排。');
  }
  function navigateMenu(next: Route) {
    if (next.page === 'preparation') setPreparationRequest(null);
    if (next.page === 'algorithm') setAlgorithmRequest(null);
    if (next.page === 'model' || next.page === 'search' || next.page === 'data' || next.page === 'resumeLibrary' || next.page === 'bank') openUtility(next.page);
    else navigate(next);
  }
  // BOSS career questions reach strict practice through the existing bank + intake path.
  function useCareerPractice({ role, resume, jobDescription, roleFamily, bankIds }: CareerPracticeSeed) {
    const planning = { ...defaultPlanning, candidateLevel: 'experienced', round: 'first', roleType: 'technical', roleFamily, bankMode: 'strict', bankIds };
    writeSession('interview-intake', JSON.stringify({ role, resume, jobDescription, level: 'senior', questionCount: 10, focus: '', planning, step: 0 }));
    setIntakeVersion(value => value + 1); newPractice();
    setNotice(`已带入 ${bankIds.length} 道 BOSS 备题，并固定使用该岗位 JD 与所选简历文本。确认后开始严格练习。`);
  }
  const create = useMutation({ mutationFn: ({ input, search }: { input: InterviewInput; search: ReturnType<typeof searchChoiceSchema.parse> }) => api.create(input, settings.data?.active?.id ?? null, search), onSuccess: data => {
    writeSession('interview-intake', null); cache.setQueryData(['session', data.id], data); navigate({ page: 'practice', sessionId: data.id }); invalidateHistory();
  } });
  const remove = useMutation({ mutationFn: api.remove, onSuccess: (_result, id) => {
    tryClearInterviewDrafts(id); removeInterviewReviews(id); cache.removeQueries({ queryKey: ['session', id] });
    const visible = parseRoute(window.location.hash) ?? latestRoute.current;
    if (visible.page === 'practice' && visible.sessionId === id) newPractice();
    invalidateHistory();
  } });
  function usePreparation({ input, bankIds }: PreparedPractice) {
    let resume = ''; try { resume = workspaceIntakeSchema.parse(JSON.parse(readSession('interview-intake') ?? 'null')).resume; } catch {}
    const planning = { ...defaultPlanning, candidateLevel: input.candidateLevel, round: input.round, roleType: input.roleType, roleFamily: input.roleFamily, bankMode: 'strict', bankIds };
    writeSession('interview-intake', JSON.stringify({ role: input.role, resume, jobDescription: input.jobDescription, level: input.candidateLevel === 'intern' ? 'junior' : input.candidateLevel === 'experienced' ? 'senior' : 'mid', questionCount: input.questionCount, focus: input.focus, planning, step: 0 }));
    setIntakeVersion(value => value + 1); newPractice(); setNotice(`已带入 ${bankIds.length} 道 JD 备题。检查资料与面试时长后开始。`);
  }
  const modelLabel = selected && session.data ? session.data.modelSource.model ?? (session.data.modelMode === 'demo' ? '规则演示模式' : '部署方 AI 模型') : settings.data?.active?.model ?? (settings.data?.mode === 'demo' ? '规则演示模式' : settings.data?.mode === 'disabled' ? '请配置模型' : '部署方 AI 模型');
  const ready = Boolean(settings.data && (settings.data.active || settings.data.mode !== 'disabled'));
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#/home"><span className="brand-mark">面</span><span>求职与面试<small>简历 · 求职 · 练习</small></span></a><ModuleNavigation page={route.page} navigate={navigateMenu} /><div className="sidebar-footer">本机工作空间 · SQLite</div></aside>
    <main className="workspace">
      <header className="workspace-header"><MobileNavigation page={route.page} navigate={navigateMenu} /><span className="module-breadcrumb">{moduleTitle(route.page)}</span><WorkspaceSaveStatus onOpenData={() => openUtility('data')} /><Button className="mode-indicator" onClick={() => openUtility('model')}>{modelLabel}</Button></header>
      <div id="workspace-panel">
      {!online ? <Alert type="warning" showIcon message="网络已断开。本机草稿仍可编辑，恢复连接后再重试面试或生成请求。" /> : null}
      {identity.error && !['algorithm', 'data'].includes(route.page) ? <Alert type="error" showIcon message="暂时无法连接本机 API。资料会保留，也可以继续算法练习。" action={<Button onClick={() => void identity.refetch()}>重试连接</Button>} /> : null}
      {route.page === 'history' ? <section className="module-history"><div className="panel-heading"><div><h1>面试历史</h1><p>按岗位与状态查找，继续作答或查看报告。</p></div><Button type="primary" onClick={newPractice}>新建面试</Button></div>      <div className="history-tools"><Input className="history-search" aria-label="查找练习" maxLength={120} placeholder="查找岗位" value={historySearch} onChange={event => setHistorySearch(event.target.value)} allowClear />
      <Select className="history-filter" aria-label="筛选练习状态" value={historyStatus} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} onChange={setHistoryStatus} />
</div><nav aria-label="练习历史" className="history">
        {items.map(item => <Button key={item.id} className={`history-item ${selected === item.id ? 'selected' : ''}`} onClick={() => navigate({ page: 'practice', sessionId: item.id })}><strong>{item.role}</strong><span>{new Date(item.createdAt).toLocaleDateString('zh-CN')} <i>{statusLabels[item.status]}</i></span></Button>)}
        {history.isSuccess && !items.length ? <p className="quiet">{historySearch || historyStatus !== 'all' ? '没有匹配的练习，请调整筛选。' : '新建第一场练习后，这里可以继续和复盘。'}</p> : null}
        {history.isError ? <Button onClick={() => void history.refetch()}>历史加载失败，重试</Button> : null}
        {history.hasNextPage ? <Button loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>加载更早的练习</Button> : null}
      </nav>
</section> : null}
      {route.page === 'home' ? <HomePanel history={recent.data?.items ?? []} navigate={navigate} openUtility={openUtility} modelReady={Boolean(settings.data?.active) || settings.data?.mode === 'live'} /> : null}
      {route.page === 'practice' ? <>
        {(session.data?.modelMode === 'demo' || (!selected && settings.data?.mode === 'demo' && !settings.data.active)) ? <div className="demo-banner" role="note"><strong>当前是规则演示。</strong> 启用自己的模型后开始真实 AI 面试。演示评分不代表专业能力评价。</div> : null}
        {settings.error ? <Alert type="error" message={settings.error.message} action={<Button onClick={() => void settings.refetch()}>重新读取模型状态</Button>} /> : null}
        {!selected && settings.data?.mode === 'disabled' && !settings.data.active ? <Alert type="info" message="请先启用模型连接，再开始面试。" action={<Button onClick={() => openUtility('model')}>配置模型</Button>} /> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {!selected ? <Intake key={intakeVersion} pending={create.isPending} ready={ready} error={create.error?.message} onCreate={(input, search) => create.mutate({ input, search })} onSearchSettings={() => openUtility('search')} onBankSettings={() => openUtility('bank')} onPreparation={seed => { setPreparationRequest({ id: crypto.randomUUID(), seed }); navigate({ page: 'preparation' }); }} /> : null}
        {selected && session.isPending ? <p className="loading" role="status">正在读取练习记录…</p> : null}
        {selected && session.error ? <Alert type="error" showIcon message={`练习加载失败：${session.error.message}`} action={<Button onClick={() => void session.refetch()}>重新读取</Button>} /> : null}
        {selected && session.data ? <><Interview key={`${session.data.id}:${session.data.revision}`} session={session.data} connectionId={settings.data?.active?.id} searchConnectionId={searchSettings.data?.active?.id} onModelSettings={() => openUtility('model')} onSearchSettings={() => openUtility('search')} onRepeat={() => { writeSession('interview-intake', JSON.stringify({ ...session.data.input, step: 0 })); setIntakeVersion(value => value + 1); newPractice(); }} onUpdate={data => { cache.setQueryData(['session', data.id], data); invalidateHistory(); }} />
          <div className="record-actions"><Popconfirm title="删除这场练习及简历资料？" description="同时删除服务端记录、派生数据、本机未提交答案及这场面试的复习笔记，无法撤回。独立保存的岗位档案保留。" okText="确认删除" cancelText="保留" onConfirm={() => remove.mutateAsync(selected)}><Button type="text" danger disabled={remove.isPending}>删除此练习及简历资料</Button></Popconfirm>{remove.error ? <p role="alert">删除失败：{remove.error.message}</p> : null}</div></> : null}
      </> : null}
      {route.page === 'preparation' ? <PreparationPanel key={preparationRequest?.id ?? 'stored'} seed={preparationRequest?.seed} onUse={usePreparation} onModelSettings={() => openUtility('model')} /> : null}
      {route.page === 'algorithm' ? <React.Suspense fallback={<p role="status">正在打开算法练习…</p>}><AlgorithmPanel key={algorithmRequest?.id ?? 'stored'} seed={algorithmRequest?.seed} initialView={route.view ?? 'hot100'} questionId={route.questionId} patternId={route.patternId} onNavigate={next => navigate({ page: 'algorithm', ...next })} /></React.Suspense> : null}
      {route.page === 'bank' ? <div className="utility-panel"><BankPanel onClose={() => navigate(returnTo)} onAlgorithmPractice={seed => { setAlgorithmRequest({ id: crypto.randomUUID(), seed }); navigate({ page: 'algorithm', view: 'patterns' }); }} /></div> : null}
      {['model', 'search', 'data'].includes(route.page) ? <div className="utility-panel"><Tabs activeKey={route.page === 'resumeLibrary' ? 'resumes' : route.page} onChange={page => { if (page === 'model' || page === 'search' || page === 'data' || page === 'resumes') navigate({ page: page === 'resumes' ? 'resumeLibrary' : page }); }} items={[{ key: 'model', label: '模型设置' }, { key: 'search', label: '联网搜索' }, { key: 'data', label: '本机数据' }]} />{route.page === 'model' ? <ModelPanel onClose={() => navigate(returnTo)} /> : route.page === 'search' ? <SearchPanel onClose={() => navigate(returnTo)} /> : route.page === 'resumeLibrary' ? <ResumeLibrary /> : <DataPanel />}</div> : null}
      {route.page === 'resumeLibrary' ? <div className="utility-panel"><ResumeLibrary /></div> : null}
      {route.page === 'resumeStudio' ? <React.Suspense fallback={<p role="status">正在打开简历制作…</p>}><ResumeStudio route={route} navigate={navigate} onPractice={useResumeForPractice} /></React.Suspense> : null}
      {route.page === 'review' ? <ReviewPanel navigate={navigate} /> : null}
      {route.page === 'career' ? <CareerPanel route={route} navigate={navigate} openModelSettings={() => openUtility('model')} openResumeLibrary={() => openUtility('resumeLibrary')} onStrictPractice={useCareerPractice} /> : null}
      </div>
    </main>
  </div>;
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="loading"><h1>页面暂时遇到了问题</h1><p>已保存的数据仍在本机。重新打开页面后继续。</p><Button onClick={() => window.location.reload()}>重新打开</Button></div> : this.props.children; }
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
const appRoot = createRoot(root);
function renderApp() { appRoot.render(<React.StrictMode><ErrorBoundary><ConfigProvider locale={zhCN} virtual={false} theme={{ token: { colorPrimary: '#2141c6', colorLink: '#2141c6', colorTextSecondary: '#53617a', borderRadius: 8, fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif' } }}><QueryClientProvider client={client}><App /></QueryClientProvider></ConfigProvider></ErrorBoundary></React.StrictMode>); }
void initializeWorkspace().then(renderApp).catch(renderApp);
