import {useState,useEffect} from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {PreparationHistory} from '../../../packages/contracts/src/preparation-history';
import type {Route} from './navigation';
import {api} from './api';
import {categoryLabels,difficultyLabels} from './labels';
import {preparationAnswerSteps,preparationMarkdown} from '../../../packages/interview/src/preparation';
import {MarkdownShare} from './ui/markdown-share';
import {PdfExport} from './ui/pdf-export';
import {ConfirmAction} from './ui/confirm-action';
import './preparation.css';
const statusLabels={generating:'正在生成',ready:'已完成',failed:'生成失败'};
export function PreparationHistoryPanel({route,navigate,onUse,onModelSettings}:{route:Route;navigate:(route:Route)=>void;onUse:(record:PreparationHistory)=>void;onModelSettings:()=>void}){
  const cache=useQueryClient();
  const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]);
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  useEffect(()=>setRequestId(crypto.randomUUID()),[route.preparationId]);
  const list=useQuery({queryKey:['preparation-history',cursors.at(-1)],queryFn:()=>api.preparationHistory(cursors.at(-1)),refetchInterval:query=>query.state.data?.items.some(item=>item.status==='generating')?1500:false});
  const detail=useQuery({queryKey:['preparation-record',route.preparationId],queryFn:()=>api.preparationRecord(route.preparationId??''),enabled:Boolean(route.preparationId),refetchInterval:query=>query.state.data?.outcome.status==='generating'?1500:false});
  const settings=useQuery({queryKey:['model-settings'],queryFn:api.modelSettings});
  const retry=useMutation({mutationFn:()=>api.retryPreparation(route.preparationId??'',{requestId,modelConnectionId:settings.data?.active?.id??null}),onSuccess:record=>{
    setRequestId(crypto.randomUUID());navigate({page:'preparationHistory',preparationId:record.id});
  },onSettled:()=>{void cache.invalidateQueries({queryKey:['preparation-history']});void cache.invalidateQueries({queryKey:['preparation-record']});}});
  const row=detail.data;
  return <section className="preparation-history"><div className="panel-heading"><div><h1>备题历史</h1><p>保存每次生成的原输入与结果。重试建立新记录，旧题单保留。</p></div><Button label="返回 JD 备题" onClick={()=>navigate({page:'preparation'})}/></div>
    {list.error?<Banner role="alert" status="error" title={list.error.message} endContent={<Button label="重试读取" onClick={()=>void list.refetch()}/>}/>:null}
    <div className="preparation-history-layout"><aside aria-label="备题历史列表">{list.data?.items.map(item=><Button className="preparation-history-row" key={item.id} variant={route.preparationId===item.id?'primary':'secondary'} label={`${item.role} · ${statusLabels[item.status]}`} onClick={()=>navigate({page:'preparationHistory',preparationId:item.id})}><strong>{item.role}</strong><span>{statusLabels[item.status]} · {item.questionCount} 道 · {new Date(item.createdAt).toLocaleString()}</span></Button>)}{list.data&&!list.data.items.length?<EmptyState title="还没有备题记录，生成题单后会自动保存"/>:null}<div className="panel-actions"><Button label="上一页" isDisabled={cursors.length===1} onClick={()=>setCursors(current=>current.slice(0,-1))}/><Button label="下一页" isDisabled={!list.data?.nextBefore} onClick={()=>{const next=list.data?.nextBefore;if(next)setCursors(current=>[...current,next]);}}/></div></aside>
    <article className="preparation-history-detail">{detail.error?<Banner role="alert" status="error" title={detail.error.message}/>:row?<>
      <h2>{row.input.role}</h2><Badge label={statusLabels[row.outcome.status]}/><p>{new Date(row.createdAt).toLocaleString()} · {({intern:'实习',new_grad:'校招',experienced:'社招'})[row.input.candidateLevel]} · {({first:'一面',second:'二面',hr:'HR 面'})[row.input.round]} · {row.input.questionCount} 道</p>
      {row.parentId?<Button variant="ghost" label="查看重试来源" onClick={()=>navigate({page:'preparationHistory',preparationId:row.parentId??undefined})}/>:null}
      <details><summary>查看本次 JD 与关注点</summary><pre>{row.input.jobDescription}</pre>{row.input.focus?<p>关注点：{row.input.focus}</p>:null}</details>
      {row.outcome.status==='failed'?<Banner role="alert" status="error" title={row.outcome.message} description={`错误编号：${row.outcome.code}`}/>:null}
      {row.outcome.status==='generating'?<p role="status">正在生成，输入已保存。完成后可查看题单；服务中断时可从此记录重试。</p>:null}
      <p>重试使用当前模型：{settings.data?.active?.model??(settings.data?.mode==='demo'?'规则演示':settings.data?.defaultModel??'读取中')}。此记录的 JD 与参数将发送给该模型。</p>
      <div className="panel-actions"><Button variant="primary" label="重试生成" isLoading={retry.isPending} isDisabled={!settings.data||Boolean(settings.error)||row.outcome.status==='generating'} onClick={()=>retry.mutate()}/><Button label="检查或切换模型" onClick={onModelSettings}/><ConfirmAction title="载入这条备题记录？" description="替换当前备题输入；成功记录同时载入原题单。历史记录保留。" okText="载入记录" cancelText="保留当前" onConfirm={()=>onUse(row)}><Button label={row.outcome.status==='ready'?'载入题单继续编辑':'修改输入后再生成'} isDisabled={retry.isPending}/></ConfirmAction></div>
      {retry.error?<Banner role="alert" status="error" title={retry.error.message}/>:null}
      {row.outcome.status==='ready'?<><p>生成模型：{row.outcome.result.model}{row.outcome.result.modelMode==='demo'?' · 规则演示':''}</p><div className="preparation-exports"><MarkdownShare content={preparationMarkdown(row.input,row.outcome.result)} /><PdfExport key={row.id} generate={()=>api.preparationHistoryPdf(row.id)} /></div>{row.outcome.result.questions.map((question,index)=><div className="preparation-card" key={index}><h3>{index+1}. {question.title}</h3><p>{categoryLabels[question.category]} · {difficultyLabels[question.difficulty]}</p><p>{question.text}</p><blockquote>{row.outcome.status==='ready'?row.outcome.result.requirements[question.requirementIndex]?.quote:''}</blockquote><h4>参考回答</h4><ol>{preparationAnswerSteps(question.answerOutline).map((line,i)=><li key={i}>{line}</li>)}</ol><h4>追问</h4><ul>{question.followUps.map((line,i)=><li key={i}>{line}</li>)}</ul></div>)}</>:null}
    </>:<EmptyState title={detail.isFetching?'正在读取备题记录…':'选择记录，查看原输入和题单'}/>}</article></div>
  </section>;
}
