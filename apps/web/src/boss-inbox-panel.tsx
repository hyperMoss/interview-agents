import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Empty,Input,Popconfirm,Select,Tag} from 'antd';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {api} from './api';
import type {Route} from './navigation';
import type {BossConversationView} from '../../../packages/contracts/src/boss-inbox';
import {resumeText} from '../../../packages/resume/src/import';
import {readSession,writeSession} from './storage';
import './boss-inbox.css';

export type BossInterviewSeed={role:string;jobDescription:string;resume:string;focus:string;sourceId:string;sourceHash:string};
export function BossInboxPanel({route,navigate,onUse}:{route:Route;navigate:(route:Route)=>void;onUse:(seed:BossInterviewSeed,mode:'preparation'|'practice')=>void}) {
  const cache=useQueryClient();
  const [search,setSearch]=useState('');
  const [jobId,setJobId]=useState(()=>{const result=z.uuid().safeParse(readSession('boss-inbox-job'));return result.success?result.data:null;});
  const list=useQuery({queryKey:['boss-inbox'],queryFn:api.bossConversations});
  const detail=useQuery({queryKey:['boss-conversation',route.conversationId],queryFn:()=>api.bossConversation(route.conversationId??''),enabled:Boolean(route.conversationId)});
  const job=useQuery({queryKey:['boss-inbox-job',jobId],queryFn:()=>api.bossConversationJob(jobId??''),enabled:Boolean(jobId),refetchInterval:query=>query.state.data&&['completed','failed','cancelled'].includes(query.state.data.status)?false:1500});
  useEffect(()=>{writeSession('boss-inbox-job',jobId);},[jobId]);
  useEffect(()=>{if(job.data){void cache.invalidateQueries({queryKey:['boss-inbox']});void cache.invalidateQueries({queryKey:['boss-conversation']});}},[job.data?.status,job.data?.progress?.completed,cache]);
  const sync=useMutation({mutationFn:(mode:'current'|'first_ten')=>api.syncBossConversation(crypto.randomUUID(),mode),onSuccess:next=>setJobId(next.id)});
  const cancel=useMutation({mutationFn:()=>api.cancelBossConversationJob(jobId??''),onSuccess:()=>void job.refetch()});
  const active=sync.isPending||Boolean(jobId&&!job.error&&(!job.data||['queued','processing'].includes(job.data.status)));
  return <section className="boss-inbox"><div className="panel-heading"><div><h1>已交换简历会话</h1><p>保存公司、JD 和沟通快照，继续准备面试。</p></div><Button onClick={()=>navigate({page:'career'})}>管理 BOSS 专用窗口</Button></div>
    <div className="inbox-sync"><p>在专用 BOSS 窗口打开消息页。可自动切换到站点“有交换”列表，依次同步前 10 条会话；不足 10 条按实际数量同步。也可选中一个聊天后仅同步当前会话。需要完整 JD 时读取该会话的同站岗位链接。</p><Button type="primary" disabled={active} onClick={()=>sync.mutate('first_ten')}>自动同步前 10 条</Button><Button disabled={active} onClick={()=>sync.mutate('current')}>同步当前会话</Button>{active?<Button disabled={!jobId||cancel.isPending} onClick={()=>cancel.mutate()}>取消同步</Button>:null}<span>逐条核对简历成功依据，只同步已加载的可见消息，不能当作完整聊天历史。</span></div>
    {sync.error?<Alert type="error" message={sync.error.message}/>:null}
    {cancel.error?<Alert type="error" message={cancel.error.message}/>:null}
    {job.data?<Alert type={job.data.status==='failed'?'error':'info'} message={`同步状态：${({queued:'等待 Worker',processing:'正在读取',completed:'已完成',failed:'未完成',cancelled:'已取消'})[job.data.status]}${job.data.progress?` · 已同步 ${job.data.progress.completed} / ${job.data.progress.total} 条`:''}`} description={job.data.failure}/>:null}
    {job.error?<Alert type="error" message={job.error.message} action={<Button onClick={()=>setJobId(null)}>清除状态显示</Button>}/>:null}
    {list.error?<Alert type="error" message={list.error.message} action={<Button onClick={()=>void list.refetch()}>重新读取</Button>}/>:null}
    <div className="inbox-layout"><aside><Input aria-label="查找会话" placeholder="公司或岗位" value={search} onChange={event=>setSearch(event.target.value)}/>{list.data?.filter(row=>(row.company+row.title).includes(search)).map(row=><Button key={row.id} className="inbox-row" type={route.conversationId===row.id?'primary':'default'} onClick={()=>navigate({page:'bossInbox',conversationId:row.id})}><strong>{row.company}</strong><span>{row.title}</span></Button>)}{list.data&&!list.data.length?<Empty description="还没有同步会话"/>:null}<small>显示最近 100 个会话</small></aside><div>
      {detail.error?<Alert type="error" message={detail.error.message}/>:detail.data?<ConversationDetail key={`${detail.data.id}:${detail.data.revision}`} row={detail.data} onUse={onUse} onDeleted={()=>{void cache.invalidateQueries({queryKey:['boss-inbox']});navigate({page:'bossInbox'});}}/>:<Empty description={detail.isFetching?'正在读取会话…':'选择会话，查看 JD 与沟通记录'}/>}</div></div>
  </section>;
}
function ConversationDetail({row,onUse,onDeleted}:{row:BossConversationView;onUse:(seed:BossInterviewSeed,mode:'preparation'|'practice')=>void;onDeleted:()=>void}) {
  const cache=useQueryClient();
  const [manualJd,setManualJd]=useState(row.manualJd??'');
  const [resumeId,setResumeId]=useState<string>();
  const [context,setContext]=useState('');
  const [shareContext,setShareContext]=useState(false);
  const [error,setError]=useState('');
  const [historyHash,setHistoryHash]=useState<string>();
  const versions=useQuery({queryKey:['boss-inbox-snapshots',row.id],queryFn:()=>api.bossConversationSnapshots(row.id)});
  const resumes=useQuery({queryKey:['resume-drafts'],queryFn:api.resumeDrafts});
  const historical=useQuery({queryKey:['boss-inbox-snapshot',row.id,historyHash],queryFn:()=>api.bossConversationSnapshot(row.id,historyHash??''),enabled:Boolean(historyHash)});
  const shown=historical.data??row.snapshot;
  const jd=shown.jdText??row.manualJd;
  const saveJd=useMutation({mutationFn:()=>api.updateBossConversationJd(row.id,row.revision,manualJd),onSuccess:()=>void cache.invalidateQueries({queryKey:['boss-conversation',row.id]})});
  const remove=useMutation({mutationFn:()=>api.deleteBossConversation(row.id,row.revision),onSuccess:()=>{cache.removeQueries({queryKey:['boss-conversation',row.id]});cache.removeQueries({queryKey:['boss-inbox-snapshots',row.id]});cache.removeQueries({queryKey:['boss-inbox-snapshot',row.id]});onDeleted();}});
  const use=useMutation({mutationFn:async(mode:'preparation'|'practice')=>{
    if(historyHash&&!historical.data)throw new Error('请等待所选快照读取完成。');
    if(!jd||jd.length<20||jd.length>12000||shown.title.length>120)throw new Error('请先核对完整 JD（20–12000 字）和岗位名称（最多120字），不会自动截断。');
    const draft=resumeId?await api.resumeDraft(resumeId):null;
    const resume=draft?resumeText(draft.document):'';
    if(mode==='practice'&&(!resume||resume.length<20))throw new Error('模拟面试需要先选择一份有效简历。');
    if(resume.length>16000)throw new Error('简历文本超过16000字，请先整理，未截断。');
    onUse({role:shown.title,jobDescription:jd,resume,focus:shareContext?context:'',sourceId:row.id,sourceHash:historyHash??row.snapshotHash},mode);
  },onError:e=>setError(e.message)});
  return <article className="inbox-detail"><h2>{shown.company} · {shown.title}</h2><Tag>已观察到简历交换依据</Tag><p>{shown.exchangeEvidence}</p><p className="inbox-meta">读取于 {new Date(shown.observedAt).toLocaleString()} · 当前可见 {shown.messages.length} 条 · 岗位 {shown.postingId}</p>
    <Select aria-label="选择会话快照" placeholder="当前快照" value={historyHash} allowClear onChange={setHistoryHash} options={versions.data?.map(version=>({value:version.hash,label:`${new Date(version.observedAt).toLocaleString()} · ${version.messageCount}条`}))}/>
    {historyHash&&historical.isPending?<p role="status">正在读取所选历史快照…</p>:null}{historical.error?<Alert type="error" message={historical.error.message}/>:null}
    {versions.error?<Alert type="warning" message="历史快照读取失败"/>:null}<h3>岗位 JD</h3>{jd?<pre>{jd}</pre>:<Alert type="warning" message="未读取到完整 JD，请展开站点岗位后重新同步，或在下面手动补充。"/>}
    {row.manualJd&&!shown.jdText?<Tag>JD 来源：手动补充</Tag>:<Tag>JD 来源：站点快照{shown.jdText?'':'（缺失）'}</Tag>}
    <details><summary>手动补充 JD（保留站点快照原文）</summary><Input.TextArea aria-label="手动补充JD" rows={7} maxLength={12000} value={manualJd} onChange={event=>setManualJd(event.target.value)}/><Button disabled={manualJd.trim().length<20||saveJd.isPending} onClick={()=>saveJd.mutate()}>保存补充 JD</Button>{saveJd.error?<Alert type="error" message={saveJd.error.message}/>:null}</details>
    <h3>沟通记录</h3><p>仅为已加载的可见窗口；旧快照可回看，不按相同文本合并消息。</p>{shown.messages.map((message,index)=><div className={`inbox-message ${message.direction}`} key={`${message.sourceId??'local'}-${index}`}><small>{({self:'我',recruiter:'招聘方',system:'系统',unknown:'方向未确认'})[message.direction]} · {message.timeLabel??'时间未显示'}</small><pre>{message.text}</pre></div>)}
    <h3>准备下一步</h3><Select aria-label="会话面试简历" placeholder="选择简历库副本（模拟面试必选）" value={resumeId} onChange={setResumeId} options={resumes.data?.map(draft=>({value:draft.id,label:draft.label}))}/>{resumes.error?<Alert type="error" message={resumes.error.message}/>:null}
    <Checkbox checked={shareContext} onChange={event=>setShareContext(event.target.checked)}>将下面的沟通摘要作为备题关注点</Checkbox>{shareContext?<Input.TextArea aria-label="沟通关注点" placeholder="选取相关沟通要点，最多1000字" maxLength={1000} rows={3} value={context} onChange={event=>setContext(event.target.value)}/>:null}
    <p>进入准备页后才生成内容；启用模型生成时，JD、所选简历及勾选的摘要将发送给所选模型。不会把沟通内容当作已验证履历。</p>
    <div className="inbox-actions">{(['preparation','practice'] as const).map(mode=><Popconfirm key={mode} title="带入本次准备资料？" description="替换尚未提交的准备草稿，已完成的面试与会话快照保留。" okText="确认带入" cancelText="保留" onConfirm={()=>use.mutateAsync(mode)}><Button disabled={!jd||use.isPending||(mode==='practice'&&!resumeId)}>{mode==='preparation'?'JD 备题':'模拟面试'}</Button></Popconfirm>)}<Popconfirm title="删除这个会话及其历史快照？" description="同时取消本身份未完成的会话同步；已开始的面试保留。" okText="删除会话" cancelText="保留" onConfirm={()=>remove.mutateAsync()}><Button danger disabled={remove.isPending}>删除本地会话</Button></Popconfirm></div>
    {error?<Alert type="error" message={error}/>:null}{remove.error?<Alert type="error" message={remove.error.message}/>:null}
  </article>;
}
