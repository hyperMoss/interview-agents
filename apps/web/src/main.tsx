import React, { useState,useEffect } from 'react';
import { z } from 'zod';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { createInterviewSchema, type InterviewInput, type Session, type Turn } from '../../../packages/contracts/src/index';
import './style.css';
import { ModelPanel } from './model-panel';
import { readSession,writeSession,tryClearInterviewDrafts } from './storage';
import { reportMarkdown } from '../../../packages/interview/src/report';
import { ResumeUpload } from './resume-upload';
import { SearchPanel } from './search-panel';
import { BankPanel } from './bank-panel';
import { PlanningFields,PlanSummary,ReplanPanel,EvaluationBars,defaultPlanning } from './planning-panel';
import { planningOptionsSchema } from '../../../packages/contracts/src/planning';
import { searchChoiceSchema } from '../../../packages/contracts/src/search';
import { stageLabels,difficultyLabels,categoryLabels,sourceLabels } from './labels';
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true }, mutations: { retry: 0,gcTime:0 } } });
const statusLabels: Record<Session['status'], string> = { preparing: '正在准备', awaiting_answer: '进行中', evaluating: '正在评估', completed: '已完成', failed: '生成失败', cancelled: '已取消' };

function App() {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(() => {const stored=z.uuid().safeParse(readSession('interview-selected'));return stored.success?stored.data:null;});
  const [modelPanel,setModelPanel]=useState(false);const [historySearch,setHistorySearch]=useState('');
  const [searchPanel,setSearchPanel]=useState(false),[bankPanel,setBankPanel]=useState(false);
  const [notice, setNotice] = useState('');
  function select(id: string | null) { setSelected(id);writeSession('interview-selected',id);setNotice(''); }
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const history = useQuery({ queryKey: ['history'], queryFn: api.list,enabled:identity.isSuccess, refetchInterval: query=>query.state.data?.some(item=>item.status==='preparing'||item.status==='evaluating')?2000:false });
  const capabilities = useQuery({ queryKey: ['capabilities'], queryFn: api.capabilities,enabled:identity.isSuccess });
  const modelSettings=useQuery({queryKey:['model-settings'],queryFn:api.modelSettings,enabled:identity.isSuccess});
  const searchSettings=useQuery({queryKey:['search-settings'],queryFn:api.searchSettings,enabled:identity.isSuccess});
  const session = useQuery({ queryKey: ['session', selected], queryFn: () => selected ? api.get(selected) : Promise.reject(new Error('没有选择练习')), enabled: Boolean(selected)&&identity.isSuccess,
    refetchInterval: query => query.state.data && ['preparing', 'evaluating'].includes(query.state.data.status) ? 1000 : false });
  const modelLabel=selected&&session.data
    ?session.data.modelMode==='demo'?'规则演示模式':session.data.modelSource.model??'部署方 AI 模型'
    :modelSettings.data?.active?.model??(modelSettings.data?.mode==='live'?'部署方 AI 模型':modelSettings.data?.mode==='disabled'?'请配置模型':modelSettings.data?.mode==='demo'?'规则演示模式':'读取模型状态…');
  const create = useMutation({ mutationFn: (intent:{input:InterviewInput;search:z.infer<typeof searchChoiceSchema>})=>api.create(intent.input,modelSettings.data?.active?.id??null,intent.search), onSuccess: data => { writeSession('interview-intake',null);cache.setQueryData(['session', data.id], data); select(data.id); void cache.invalidateQueries({ queryKey: ['history'] }); } });
  const remove = useMutation({ mutationFn: api.remove, onSuccess: (_result,id) => { create.reset();tryClearInterviewDrafts(id);cache.removeQueries({queryKey:['session',id]});select(null); void cache.invalidateQueries({ queryKey: ['history'] }); } });
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="面试练习室首页"><span className="brand-mark">面</span><span>面试练习室<small>把经历说清楚</small></span></a>
      <button className="primary new-session" onClick={() => select(null)}>＋ 新建练习</button>
      <div className="history-title">最近的练习 <span>{history.data?.length ?? 0}</span></div>
      <input className="history-search" aria-label="查找练习" value={historySearch} onChange={event=>setHistorySearch(event.target.value)} placeholder="查找岗位或状态"/>
      <nav aria-label="练习历史" className="history">
        {history.data?.filter(item=>`${item.role} ${statusLabels[item.status]}`.toLowerCase().includes(historySearch.trim().toLowerCase())).map(item => <button key={item.id} className={`history-item ${selected === item.id ? 'selected' : ''}`} onClick={() => select(item.id)}>
          <strong>{item.role}</strong><span>{new Date(item.createdAt).toLocaleDateString('zh-CN')} <i>{statusLabels[item.status]}</i></span>
        </button>)}
        {history.data?.length === 0 ? <p className="quiet">完成第一场练习后，你的记录会留在这里。</p> : null}
        {history.isError ? <button onClick={() => void history.refetch()}>历史加载失败，重试</button> : null}
      </nav>
      <div className="sidebar-tools"><button className="secondary model-settings-button" onClick={()=>setModelPanel(true)}>模型设置</button><button className="secondary" onClick={()=>setSearchPanel(true)}>联网搜索</button><button className="secondary" onClick={()=>setBankPanel(true)}>题库管理</button></div>
      <div className="privacy-note">记录仅属于当前浏览器身份。共享设备使用后，请删除练习记录并清除模型连接。</div>
    </aside>
    <main className="workspace">
      <header className="workspace-header"><span>个人练习空间</span><button className="mode-indicator" onClick={()=>setModelPanel(true)}>{modelLabel}</button></header>
      {(selected?session.data?.modelMode==='demo':!modelSettings.data?.active&&capabilities.data?.modelMode==='demo')?<div className="demo-banner" role="note"><strong>当前是规则演示。</strong> 想开始真实 AI 面试，请打开“模型设置”启用自己的连接。演示评分不代表专业能力评价。</div>:null}
      {identity.error?<p className="error" role="alert">无法建立浏览器身份，请检查 API 服务。<button onClick={()=>void identity.refetch()}>重试连接</button></p>:null}
      {notice ? <p role="status">{notice}</p> : null}
      {modelSettings.isError?<div className="error" role="alert">{modelSettings.error.message}<button onClick={()=>void modelSettings.refetch()}>重新读取模型状态</button></div>:null}
      {!selected&&modelSettings.data?.mode==='disabled'&&!modelSettings.data.active?<div className="demo-banner" role="note">当前没有默认模型。请打开模型设置，启用自己的连接后开始面试。</div>:null}
      {!selected ? <Intake pending={create.isPending} ready={Boolean(modelSettings.data&&(modelSettings.data.active||modelSettings.data.mode!=='disabled'))} error={create.error?.message} onCreate={(input,search) => create.mutate({input,search})} onSearchSettings={()=>setSearchPanel(true)} onBankSettings={()=>setBankPanel(true)} /> : null}
      {selected && session.isPending ? <div className="loading" role="status">正在读取练习记录…</div> : null}
      {selected && session.isError ? <div className="error" role="alert">练习加载失败：{session.error.message}<button onClick={() => void session.refetch()}>重新读取</button></div> : null}
      {session.data && selected ? <Interview key={`${session.data.id}:${session.data.revision}`} session={session.data} connectionId={modelSettings.data?.active?.id} searchConnectionId={searchSettings.data?.active?.id} onModelSettings={()=>setModelPanel(true)} onSearchSettings={()=>setSearchPanel(true)} onRepeat={()=>{writeSession('interview-intake',JSON.stringify(session.data.input));select(null);}} onUpdate={data => { cache.setQueryData(['session', data.id], data); void cache.invalidateQueries({ queryKey: ['history'] }); }} /> : null}
      {selected && session.data ? <div className="record-actions"><button className="text-button danger" disabled={remove.isPending} onClick={() => remove.mutate(selected)}>删除此练习及简历资料</button>{remove.error ? <p role="alert">删除失败：{remove.error.message}</p> : null}</div> : null}
    </main>
    {modelPanel?<ModelPanel onClose={()=>setModelPanel(false)}/>:null}
    {searchPanel?<SearchPanel onClose={()=>setSearchPanel(false)}/>:null}
    {bankPanel?<BankPanel onClose={()=>setBankPanel(false)}/>:null}
  </div>;
}
function Intake({ pending,ready, error, onCreate,onSearchSettings,onBankSettings }: { pending: boolean;ready:boolean; error: string | undefined; onCreate: (input: InterviewInput,search:z.infer<typeof searchChoiceSchema>) => void;onSearchSettings:()=>void;onBankSettings:()=>void }) {
  const [saved]=useState(()=>{try{return z.object({role:z.string().max(120),resume:z.string().max(64000),jobDescription:z.string().max(12000),level:z.enum(['junior','mid','senior']),questionCount:z.number().int().min(1).max(30),focus:z.string().max(1000).default(''),planning:z.unknown().optional()}).parse(JSON.parse(readSession('interview-intake')??'null'));}catch{return null;}});
  const [role, setRole] = useState(saved?.role??''); const [resume, setResume] = useState(saved?.resume??''); const [jd, setJd] = useState(saved?.jobDescription??'');
  const [planning,setPlanning]=useState(()=>{const parsed=planningOptionsSchema.safeParse(saved?.planning);return parsed.success?parsed.data:defaultPlanning;}),[focus,setFocus]=useState(saved?.focus??''),[validation,setValidation]=useState(''),[searchEnabled,setSearchEnabled]=useState(false),[searchQuery,setSearchQuery]=useState('');
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const bank=useQuery({queryKey:['question-bank'],queryFn:api.bankList,enabled:identity.isSuccess});
  const search=useQuery({queryKey:['search-settings'],queryFn:api.searchSettings,enabled:identity.isSuccess});
  const preview=useQuery({queryKey:['plan-preview',planning],queryFn:()=>api.previewPlan(planning),enabled:identity.isSuccess&&planningOptionsSchema.safeParse(planning).success});
  const level:InterviewInput['level']=planning.candidateLevel==='intern'?'junior':planning.candidateLevel==='experienced'?'senior':'mid';const count=Math.max(1,preview.data?.totalQuestions??saved?.questionCount??3);
  useEffect(()=>{writeSession('interview-intake',JSON.stringify({role,resume,jobDescription:jd,level,questionCount:count,focus,planning}));},[role,resume,jd,level,count,focus,planning]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = createInterviewSchema.safeParse({ role, resume, jobDescription: jd, level, questionCount: count,focus,planning });
    if (!input.success) { setValidation('检查岗位和规划参数。简历需 20 至 16000 字，岗位描述需 20 至 12000 字。'); return; }
    const choice=searchChoiceSchema.safeParse(searchEnabled?{kind:'on',connectionId:search.data?.active?.id,query:searchQuery||`${role} 岗位公开资料`}:{kind:'off'});if(!choice.success){setValidation('先配置搜索连接，再确认 2 至 200 字的查询。');return;}
    setValidation(''); onCreate(input.data,choice.data);
  }
  function example() { setRole('Web 全栈工程师'); setResume('示例经历：负责一个 React 与 NestJS 项目，设计接口和数据库，完成任务队列、权限校验与自动化测试。'); setJd('示例岗位：熟悉 TypeScript、React、Node.js 和 PostgreSQL，能解释技术方案与性能优化，重视跨团队协作。'); }
  return <section className="intake">
    <div className="intro"><h1>下一场面试，<br/>从一次有准备的练习开始。</h1><p>带上你的经历与目标岗位。围绕真实项目回答问题，再看看哪些地方值得说得更具体。</p></div>
    <form onSubmit={submit}>
      <div className="form-heading"><h2>准备练习资料</h2><button type="button" className="text-button" onClick={example}>填入示例</button></div>
      <label>目标岗位<input required minLength={2} maxLength={120} value={role} onChange={e => setRole(e.target.value)} placeholder="例如：Web 全栈工程师" /></label>
      <ResumeUpload onUse={setResume}/>
      <label>简历与项目经历<textarea required minLength={20} maxLength={16000} value={resume} onChange={e => setResume(e.target.value)} rows={5} placeholder="粘贴你实际负责的项目、行动与结果。可先去除联系方式等私人信息。" /></label>
      <label>岗位描述 / JD<textarea required minLength={20} maxLength={12000} value={jd} onChange={e => setJd(e.target.value)} rows={4} placeholder="粘贴职责与技能要求，让问题贴近目标岗位。" /></label>
      <label>本次练习重点（选填）<input value={focus} maxLength={1000} onChange={event=>setFocus(event.target.value)} placeholder="例如：系统设计、项目细节、故障复盘或表达结构"/></label>
      <PlanningFields options={planning} onChange={setPlanning}/>
      <details className="bank-selection"><summary>选择本次使用的题库 · {planning.bankIds.length?`已选 ${planning.bankIds.length} 题`:'全部可用题目'}</summary><p>不勾选时使用全部可用题目。指定题目时补入内置开场和反问。岗位与难度仍会筛选。</p><button type="button" className="text-button" onClick={onBankSettings}>管理或导入题目</button><button type="button" className="text-button" onClick={()=>setPlanning({...planning,bankIds:[]})}>使用全部可用题目</button><div className="bank-options">{bank.data?.filter(q=>q.category!=='intro'&&q.category!=='reverse').map(q=><label className="checkbox-label" key={q.id}><input type="checkbox" checked={planning.bankIds.includes(q.id)} onChange={e=>setPlanning({...planning,bankIds:e.target.checked?[...planning.bankIds,q.id]:planning.bankIds.filter(id=>id!==q.id)})}/><span>{q.title}<small>{categoryLabels[q.category]} · {difficultyLabels[q.difficulty]} · {sourceLabels[q.source]}</small></span></label>)}</div>{bank.error?<p className="error">{bank.error.message}</p>:null}</details>
      <div className="search-choice"><label className="checkbox-label"><input type="checkbox" checked={searchEnabled} disabled={!search.data?.active} onChange={e=>setSearchEnabled(e.target.checked)}/>本场启用联网搜索</label><button type="button" className="text-button" onClick={onSearchSettings}>配置搜索连接</button>{searchEnabled?<label>确认搜索关键词<input value={searchQuery||`${role} 岗位公开资料`} maxLength={200} onChange={e=>setSearchQuery(e.target.value)}/></label>:null}<p className="storage-note">只发送这里确认的关键词，不自动发送简历、JD 或作答。初次取得的来源固定用于本场面试。搜索可能产生供应商费用。</p></div>
      {preview.data?<PlanSummary plan={preview.data}/>:null}{preview.error?<p role="alert" className="error">{preview.error.message}</p>:null}
      <div className="form-footer"><p>题量会按实际进度重排，已完成 QA 保留。</p><button className="primary" disabled={pending||!ready||preview.isFetching||!preview.data?.remainingQuestions} type="submit">{pending ? '正在创建…' : '开始练习'}</button></div>
      {validation || error ? <p className="error" role="alert">{validation || error}</p> : null}
    </form>
    <p className="context-note">资料草稿只暂存在当前标签页。提交后保存面试记录，支持刷新和继续练习。</p>
  </section>;
}
function Interview({ session, onUpdate,connectionId,searchConnectionId,onModelSettings,onSearchSettings,onRepeat }: { session: Session; onUpdate: (session: Session) => void;connectionId:string|undefined;searchConnectionId:string|undefined;onModelSettings:()=>void;onSearchSettings:()=>void;onRepeat:()=>void }) {
  const draftKey=`answer-${session.id}-${'question' in session&&session.question.id?session.question.id:session.revision}`;
  const [answer, setAnswer] = useState(()=>readSession(draftKey)??'');
  useEffect(()=>{if(session.status==='awaiting_answer')writeSession(draftKey,answer);},[draftKey,answer,session.status]);
  const [command, setCommand] = useState<{ answer: string; revision: number; requestId: string } | null>(null);
  const submit = useMutation({ mutationFn: (input: { answer: string; revision: number; requestId: string }) => api.answer(session.id, input), onSuccess: data => { writeSession(draftKey,null);onUpdate(data); setAnswer(''); setCommand(null); } });
  const cancel = useMutation({ mutationFn: () => api.cancel(session.id), onSuccess: onUpdate });
  const [retryId]=useState(()=>crypto.randomUUID());const retry=useMutation({mutationFn:()=>api.retry(session.id,{requestId:retryId,revision:session.revision,modelConnectionId:connectionId??null,...(session.search?.kind==='on'&&searchConnectionId?{searchConnectionId}:{})}),onSuccess:onUpdate});
  const noSearchRetry=useMutation({mutationFn:()=>api.retry(session.id,{requestId:crypto.randomUUID(),revision:session.revision,modelConnectionId:connectionId??null,searchConnectionId:null}),onSuccess:onUpdate});
  const [exportFormat,setExportFormat]=useState('markdown');
  const pending = session.status === 'preparing' || session.status === 'evaluating';
  const terminal = session.status === 'completed' || session.status === 'cancelled';
  function send(event: React.FormEvent) { event.preventDefault(); const input = command && command.answer === answer && command.revision === session.revision ? command : { answer, revision: session.revision, requestId: crypto.randomUUID() }; setCommand(input); submit.mutate(input); }
  function download() { const blob = new Blob([exportFormat==='markdown'?reportMarkdown(session):JSON.stringify(session, null, 2)], { type:exportFormat==='markdown'?'text/markdown;charset=utf-8':'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `interview-${session.id}.${exportFormat==='markdown'?'md':'json'}`; link.click(); URL.revokeObjectURL(url); }
  return <section className="interview">
    <div className="interview-title"><div><h1>{session.role}</h1><p>{statusLabels[session.status]} · 已完成 {session.turns.length} / {session.input.questionCount} 题</p></div>
      {!terminal ? <button className="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>取消练习</button> : null}</div>
    <progress aria-label="练习进度" value={session.turns.length} max={session.input.questionCount} />
    <p className="session-model">本次模型：{session.modelSource.model??(session.modelMode==='demo'?'规则演示':'部署方默认模型')}</p>
    {session.plan?<PlanSummary plan={session.plan}/>:null}
    {session.plan&&session.status==='awaiting_answer'?<ReplanPanel session={session} onUpdate={onUpdate}/>:null}
    {session.research?<details className="research-sources"><summary>本场联网资料 · {session.research.sources.length} 条</summary><p>查询 {session.research.query}。资料只用于理解岗位，评分依据仍来自你的答案。</p>{session.research.sources.map(source=><article key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.snippet}</p></article>)}</details>:null}
    {session.turns.map((turn, index) => <Feedback key={index} turn={turn} index={index} demo={session.modelMode === 'demo'} />)}
    {pending ? <div className="pending-box" role="status"><span className="pulse"/><div><strong>{session.status === 'preparing' ? '正在准备第一道问题' : '正在阅读你的回答'}</strong><p>任务已保存。刷新页面后仍可继续查看结果。</p></div></div> : null}
    {session.status === 'awaiting_answer' ? <div className="question-panel"><span className="question-label">第 {session.turns.length + 1} 题 · {session.question.competency}</span><h2>{session.question.text}</h2>
      <p className="question-origin">{stageLabels[session.question.stage??'qa']} · {session.question.difficulty?difficultyLabels[session.question.difficulty]:'按题面'} · {session.question.provenance==='bank'?'题库原题':session.question.provenance==='adapted'?'按题库改编':'生成题'}</p>
      <form onSubmit={send}><label htmlFor="answer">你的回答</label><textarea id="answer" className={session.question.kind==='coding'?'code-answer':''} disabled={submit.isPending} required minLength={10} maxLength={12000} value={answer} onChange={e => setAnswer(e.target.value)} rows={session.question.kind==='coding'?12:7} placeholder={session.question.kind==='coding'?'填写代码、思路、边界与复杂度。代码不会在服务端执行。':'把问题、你的行动与结果说清楚。可以先写下要点，再组织成完整回答。'}/><div className="answer-footer"><span>{answer.length} / 12000 字 · 草稿保留在本标签页</span><button className="primary" disabled={submit.isPending || answer.trim().length < 10} type="submit">{submit.isPending ? '正在提交…' : '提交回答'}</button></div></form></div> : null}
    {session.status === 'completed' ? <div className="report" aria-label="练习报告"><div className="report-top"><div><span>{session.modelMode === 'demo' ? '规则演示评分' : '本次练习评分'}</span><strong className="score">{session.report.overallScore}<small>/ 100</small></strong></div><div><h2>练习完成，可以开始复盘了。</h2><p>{session.report.summary}</p></div></div>
      {session.report.evaluation?<EvaluationBars evaluation={session.report.evaluation}/>:session.report.dimensions?<Dimensions dimensions={session.report.dimensions}/>:null}
      <div className="report-columns"><div><h3>可保留的表达</h3><ul>{session.report.strengths.map(text => <li key={text}>{text}</li>)}</ul></div><div><h3>下一次练习的重点</h3><ul>{session.report.improvements.map(text => <li key={text}>{text}</li>)}</ul></div></div><div className="report-actions"><select aria-label="导出格式" value={exportFormat} onChange={event=>setExportFormat(event.target.value)}><option value="markdown">Markdown 复盘报告</option><option value="json">JSON 原始记录</option></select><button className="secondary" onClick={download}>导出本次记录</button><button className="primary" onClick={onRepeat}>用相同资料再练一次</button></div></div> : null}
    {session.status === 'failed' ? <div className="recovery-panel"><p className="error" role="alert">{session.error}</p>{session.recovery?<><h3>{session.recovery.question.text}</h3><p className="answer-text">{session.recovery.answer}</p></>:null}<div className="panel-actions"><button className="secondary" onClick={onModelSettings}>检查模型设置</button>{session.search?.kind==='on'?<><button className="secondary" onClick={onSearchSettings}>检查搜索设置</button><button className="secondary" disabled={noSearchRetry.isPending} onClick={()=>noSearchRetry.mutate()}>关闭本场搜索并重试</button></>:null}<button className="primary" disabled={retry.isPending} onClick={()=>retry.mutate()}>{retry.isPending?'提交重试中…':session.search?.kind==='on'?'使用当前模型和搜索重试本轮':connectionId?'用当前模型重试本轮':'重试本轮'}</button></div></div> : null}
    {session.status === 'cancelled' ? <p className="cancelled">练习已取消，已完成的回答保留在上方。你可以从左侧开始新的练习。</p> : null}
    {submit.error || cancel.error||retry.error||noSearchRetry.error ? <p className="error" role="alert">{submit.error?.message || cancel.error?.message||retry.error?.message||noSearchRetry.error?.message}。可重新读取或重试。</p> : null}
  </section>;
}
function Feedback({ turn, index, demo }: { turn: Turn; index: number; demo: boolean }) {
  return <details className="feedback"><summary><span className="turn-index">{index + 1}</span><span>{turn.question.competency}<small>{turn.question.text}</small></span><strong>{turn.assessment.score}<small>{demo ? '演示分' : '分'}</small></strong></summary>
    <div className="feedback-body"><p className="session-model">第 {index+1} 题 QA · 评分模型 {turn.modelSource.model??'部署方默认模型'}</p><h3>你的回答</h3><p className="answer-text">{turn.answer}</p><h3>回答依据</h3><blockquote>{turn.assessment.evidence}</blockquote><p>{turn.assessment.feedback}</p>{turn.assessment.evaluation?<EvaluationBars evaluation={turn.assessment.evaluation}/>:turn.assessment.dimensions?<Dimensions dimensions={turn.assessment.dimensions}/>:null}<h3>改进方向</h3><ul>{turn.assessment.improvements.map(text => <li key={text}>{text}</li>)}</ul></div>
  </details>;
}
function Dimensions({dimensions}:{dimensions:NonNullable<Turn['assessment']['dimensions']>}){const labels={relevance:'岗位相关',depth:'技术深度',clarity:'表达结构',evidence:'结果证据'};return <div className="dimension-bars" aria-label="分维度反馈">{Object.entries(labels).map(([key,label])=>{const parsed=z.enum(['relevance','depth','clarity','evidence']).parse(key);return <div key={key}><span>{label}</span><meter aria-label={label} min={0} max={100} value={dimensions[parsed]}/><strong>{dimensions[parsed]}</strong></div>;})}</div>;}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
createRoot(root).render(<React.StrictMode><QueryClientProvider client={client}><App/></QueryClientProvider></React.StrictMode>);
