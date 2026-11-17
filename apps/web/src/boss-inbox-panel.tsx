import {useEffect,useState} from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {api} from './api';
import type {Route} from './navigation';
import type {BossConversationView} from '../../../packages/contracts/src/boss-inbox';
import {resumeText} from '../../../packages/resume/src/import';
import {readSession,writeSession} from './storage';
import {ConfirmAction} from './ui/confirm-action';
import './boss-inbox.css';

export type BossInterviewSeed={role:string;jobDescription:string;resume:string;focus:string;sourceId:string;sourceHash:string};
const handoffLimits={jdMin:20,jdMax:12000,titleMax:120,resumeMin:20,resumeMax:16000,preview:200};
/** Bounded JD preview for the confirmation layer; the handoff itself carries the untrimmed original text. */
export function handoffPreview(jd:string){const text=jd.trim();return{text:text.slice(0,handoffLimits.preview),length:text.length,bounded:text.length>handoffLimits.preview};}
export type HandoffFacts={title:string;jd:string;snapshotPending:boolean;snapshotUnavailable:boolean;resumeSelected:boolean;resumePending:boolean;resumeError:boolean;resume:string};
/** Single source of truth for both the disabled entry and the confirmed handoff. */
export function handoffBlockers(mode:'preparation'|'practice',facts:HandoffFacts){
  const problems:string[]=[];
  if(facts.snapshotPending)problems.push('正在读取所选历史快照，请稍候。');
  else if(facts.snapshotUnavailable)problems.push('所选历史快照还没有读取成功，请重试或改回当前快照。');
  const jd=facts.jd.trim();
  if(!jd)problems.push('缺少 JD：请先展开站点岗位重新同步，或手动补充。');
  else if(jd.length<handoffLimits.jdMin)problems.push(`JD 只有 ${jd.length} 字，至少需要 ${handoffLimits.jdMin} 字，不会自动补写。`);
  else if(jd.length>handoffLimits.jdMax)problems.push(`JD 有 ${jd.length} 字，超过 ${handoffLimits.jdMax} 字上限；请先精简，不会自动截断。`);
  if(facts.title.trim().length>handoffLimits.titleMax)problems.push(`岗位名称超过 ${handoffLimits.titleMax} 字，请先修正。`);
  if(facts.resumeSelected){
    if(facts.resumeError)problems.push('所选简历读取失败，请重新选择或重试。');
    else if(facts.resumePending)problems.push('正在读取所选简历，请稍候。');
    else if(facts.resume.trim().length<handoffLimits.resumeMin)problems.push(`所选简历整理后只有 ${facts.resume.trim().length} 字，至少需要 ${handoffLimits.resumeMin} 字。`);
    else if(facts.resume.trim().length>handoffLimits.resumeMax)problems.push(`所选简历超过 ${handoffLimits.resumeMax} 字，请先整理，不会自动截断。`);
  }else if(mode==='practice')problems.push('模拟面试需要先选择一份简历库副本。');
  return problems;
}
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
  return <section className="boss-inbox"><div className="panel-heading"><div><h1>已交换简历会话</h1><p>保存公司、JD 和沟通快照，继续准备面试。</p></div><Button label="管理 BOSS 专用窗口" onClick={()=>navigate({page:'career'})}/></div>
    <div className="inbox-sync"><p>在专用 BOSS 窗口打开消息页。可自动切换到站点“有交换”列表，依次同步前 10 条会话；不足 10 条按实际数量同步。也可选中一个聊天后仅同步当前会话。需要完整 JD 时读取该会话的同站岗位链接。</p><Button variant="primary" isDisabled={active} label="自动同步前 10 条" onClick={()=>sync.mutate('first_ten')}/><Button isDisabled={active} label="同步当前会话" onClick={()=>sync.mutate('current')}/>{active?<Button isDisabled={!jobId||cancel.isPending} label="取消同步" onClick={()=>cancel.mutate()}/>:null}<span>逐条核对简历成功依据，只同步已加载的可见消息，不能当作完整聊天历史。</span></div>
    {sync.error?<Banner role="alert" status="error" title={sync.error.message}/>:null}
    {cancel.error?<Banner role="alert" status="error" title={cancel.error.message}/>:null}
    {job.data?<Banner role="alert" status={job.data.status==='failed'?'error':'info'} title={`同步状态：${({queued:'等待 Worker',processing:'正在读取',completed:'已完成',failed:'未完成',cancelled:'已取消'})[job.data.status]}${job.data.progress?` · 已同步 ${job.data.progress.completed} / ${job.data.progress.total} 条`:''}`} description={job.data.failure}/>:null}
    {job.error?<Banner role="alert" status="error" title={job.error.message} endContent={<Button label="清除状态显示" onClick={()=>setJobId(null)}/>}/>:null}
    {list.error?<Banner role="alert" status="error" title={list.error.message} endContent={<Button label="重新读取" onClick={()=>void list.refetch()}/>}/>:null}
    <div className="inbox-layout"><aside><TextInput label="查找会话" isLabelHidden placeholder="公司或岗位" value={search} onChange={value=>setSearch(value)}/>{list.data?.filter(row=>(row.company+row.title).includes(search)).map(row=><Button key={row.id} className="inbox-row" variant={route.conversationId===row.id?'primary':'secondary'} label={`${row.company} ${row.title}`} onClick={()=>navigate({page:'bossInbox',conversationId:row.id})}><strong>{row.company}</strong><span>{row.title}</span></Button>)}{list.data&&!list.data.length?<EmptyState isCompact title="还没有同步会话" description="在专用 BOSS 窗口打开消息页后同步会话。"/>:null}<small>显示最近 100 个会话</small></aside><div>
      {detail.error?<Banner role="alert" status="error" title={detail.error.message}/>:detail.data?<ConversationDetail key={`${detail.data.id}:${detail.data.revision}`} row={detail.data} onUse={onUse} onDeleted={()=>{void cache.invalidateQueries({queryKey:['boss-inbox']});navigate({page:'bossInbox'});}}/>:<EmptyState isCompact title={detail.isFetching?'正在读取会话…':'还没有选择会话'} description="选择会话，查看 JD 与沟通记录。"/>}</div></div>
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
  const [handoff,setHandoff]=useState<'preparation'|'practice'|null>(null);
  const selectedResume=useQuery({queryKey:['resume-draft',resumeId],queryFn:()=>api.resumeDraft(resumeId??''),enabled:Boolean(resumeId),refetchOnWindowFocus:false});
  const facts:HandoffFacts={title:shown.title,jd:jd??'',snapshotPending:Boolean(historyHash&&historical.isPending),snapshotUnavailable:Boolean(historyHash&&!historical.isPending&&!historical.data),resumeSelected:Boolean(resumeId),resumePending:selectedResume.isPending,resumeError:selectedResume.isError,resume:selectedResume.data?resumeText(selectedResume.data.document):''};
  const blockers={preparation:handoffBlockers('preparation',facts),practice:handoffBlockers('practice',facts)};
  const preview=handoffPreview(jd??'');
  const resumeLabel=resumes.data?.find(draft=>draft.id===resumeId)?.label??'';
  const saveJd=useMutation({mutationFn:()=>api.updateBossConversationJd(row.id,row.revision,manualJd),onSuccess:()=>void cache.invalidateQueries({queryKey:['boss-conversation',row.id]})});
  const remove=useMutation({mutationFn:()=>api.deleteBossConversation(row.id,row.revision),onSuccess:()=>{cache.removeQueries({queryKey:['boss-conversation',row.id]});cache.removeQueries({queryKey:['boss-inbox-snapshots',row.id]});cache.removeQueries({queryKey:['boss-inbox-snapshot',row.id]});onDeleted();}});
  const use=useMutation({mutationFn:async(mode:'preparation'|'practice')=>{
    const problems=handoffBlockers(mode,facts);
    if(problems.length)throw new Error(problems[0]);
    const resume=resumeId&&selectedResume.data?resumeText(selectedResume.data.document):'';
    onUse({role:shown.title,jobDescription:jd??'',resume,focus:shareContext?context:'',sourceId:row.id,sourceHash:historyHash??row.snapshotHash},mode);
  },onError:e=>setError(e.message)});
  return <article className="inbox-detail"><h2>{shown.company} · {shown.title}</h2><Badge label="已观察到简历交换依据"/><p>{shown.exchangeEvidence}</p><p className="inbox-meta">读取于 {new Date(shown.observedAt).toLocaleString()} · 当前可见 {shown.messages.length} 条 · 岗位 {shown.postingId}</p>
    <section className="inbox-handoff" aria-label="带入准备"><div><h3>带入准备</h3><p>岗位、公司、JD 与所选简历按原长度带入，不截断、不改写。</p></div><div className="inbox-handoff-pick"><Selector label="会话面试简历" placeholder="选择简历库副本（模拟面试必选）" value={resumeId} onChange={value=>setResumeId(value)} options={resumes.data?.map(draft=>({value:draft.id,label:draft.label}))??[]}/>{resumes.error?<Banner role="alert" status="error" title={resumes.error.message}/>:null}</div><div className="inbox-handoff-modes">{(['preparation','practice'] as const).map(mode=><div className="inbox-handoff-mode" key={mode}><Button variant={mode==='practice'?'primary':'secondary'} isDisabled={blockers[mode].length>0||use.isPending} label={mode==='preparation'?'JD 备题':'模拟面试'} onClick={()=>{setError('');setHandoff(mode);}}/>{blockers[mode].length?<small>{blockers[mode][0]}</small>:null}</div>)}</div></section>
    <Selector label="选择会话快照" placeholder="当前快照" hasClear value={historyHash??null} onChange={value=>setHistoryHash(value??undefined)} options={versions.data?.map(version=>({value:version.hash,label:`${new Date(version.observedAt).toLocaleString()} · ${version.messageCount}条`}))??[]}/>
    {historyHash&&historical.isPending?<p role="status">正在读取所选历史快照…</p>:null}{historical.error?<Banner role="alert" status="error" title={historical.error.message}/>:null}
    {versions.error?<Banner role="alert" status="warning" title="历史快照读取失败"/>:null}<h3>岗位 JD</h3>{jd?<pre>{jd}</pre>:<Banner role="alert" status="warning" title="未读取到完整 JD，请展开站点岗位后重新同步，或在下面手动补充。"/>}
    {row.manualJd&&!shown.jdText?<Badge label="JD 来源：手动补充"/>:<Badge label={`JD 来源：站点快照${shown.jdText?'':'（缺失）'}`}/>}
    <details><summary>手动补充 JD（保留站点快照原文）</summary><TextArea label="手动补充JD" rows={7} maxLength={12000} value={manualJd} onChange={value=>setManualJd(value)}/><Button isDisabled={manualJd.trim().length<20||saveJd.isPending} label="保存补充 JD" onClick={()=>saveJd.mutate()}/>{saveJd.error?<Banner role="alert" status="error" title={saveJd.error.message}/>:null}</details>
    <h3>沟通记录</h3><p>仅为已加载的可见窗口；旧快照可回看，不按相同文本合并消息。</p>{shown.messages.map((message,index)=><div className={`inbox-message ${message.direction}`} key={`${message.sourceId??'local'}-${index}`}><small>{({self:'我',recruiter:'招聘方',system:'系统',unknown:'方向未确认'})[message.direction]} · {message.timeLabel??'时间未显示'}</small><pre>{message.text}</pre></div>)}
    <h3>准备下一步</h3><CheckboxInput label="将下面的沟通摘要作为备题关注点" value={shareContext} onChange={checked=>setShareContext(checked)}/>{shareContext?<TextArea label="沟通关注点" placeholder="选取相关沟通要点，最多1000字" maxLength={1000} rows={3} value={context} onChange={value=>setContext(value)}/>:null}
    <p>进入准备页后才生成内容；启用模型生成时，JD、所选简历及勾选的摘要将发送给所选模型。不会把沟通内容当作已验证履历。</p>
    <div className="inbox-actions"><ConfirmAction title="删除这个会话及其历史快照？" description="同时取消本身份未完成的会话同步；已开始的面试保留。" okText="删除会话" cancelText="保留" onConfirm={()=>remove.mutateAsync()}><Button variant="destructive" isDisabled={remove.isPending} label="删除本地会话"/></ConfirmAction></div>
    <Dialog isOpen={Boolean(handoff)} width={720} onOpenChange={open=>{if(!open){setHandoff(null);setError('');}}}>
      <DialogHeader title={handoff==='practice'?'带入前确认 · 模拟面试':'带入前确认 · JD 备题'} onOpenChange={open=>{if(!open){setHandoff(null);setError('');}}}/>
      {handoff?<><dl className="inbox-handoff-preview"><dt>岗位</dt><dd>{shown.title}</dd><dt>公司</dt><dd>{shown.company}</dd><dt>JD</dt><dd><pre>{preview.text}{preview.bounded?'…':''}</pre><small>共 {preview.length} 字；带入时按原长度完整带入，不截断。</small></dd><dt>简历</dt><dd>{resumeId?(resumeLabel||'已选择的副本'):'未选择'}{handoff==='practice'?'（模拟面试必选）':''}</dd></dl>
        <p role="note">确认后会用本会话的岗位、公司、JD 与所选简历覆盖「{handoff==='practice'?'面试准备':'JD 备题'}」页尚未提交的输入；已生成的题单、已完成的面试与会话快照保留。取消不会写入任何草稿。</p>
        {blockers[handoff].length?<Banner role="alert" status="warning" title="还不能带入" description={<ul>{blockers[handoff].map(problem=><li key={problem}>{problem}</li>)}</ul>}/>:null}
        <div className="panel-actions">
          <Button label="取消带入" onClick={()=>{setHandoff(null);setError('');}}/>
          <Button variant="primary" isLoading={use.isPending} isDisabled={!handoff||blockers[handoff].length>0} label="确认带入" onClick={()=>{if(!handoff)return;void use.mutateAsync(handoff).then(()=>setHandoff(null)).catch(()=>{});}}/>
        </div>
      </>:null}
    </Dialog>
    {error?<Banner role="alert" status="error" title={error}/>:null}{remove.error?<Banner role="alert" status="error" title={remove.error.message}/>:null}
  </article>;
}
