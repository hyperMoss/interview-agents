import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Input, Popconfirm, Progress, Select } from 'antd';
import { useMutation } from '@tanstack/react-query';
import type { Session, Turn } from '../../../packages/contracts/src/index';
import { reportMarkdown } from '../../../packages/interview/src/report';
import { api } from './api';
import { readSession, writeSession } from './storage';
import { PlanSummary, ReplanPanel, EvaluationBars } from './planning-panel';
import { stageLabels, difficultyLabels } from './labels';
import { statusLabels } from './navigation';
import { ReportPriorities } from './report-priorities';

export function Interview({ session, onUpdate,connectionId,searchConnectionId,onModelSettings,onSearchSettings,onRepeat }: { session: Session; onUpdate: (session: Session) => void;connectionId:string|undefined;searchConnectionId:string|undefined;onModelSettings:()=>void;onSearchSettings:()=>void;onRepeat:()=>void }) {
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
      {!terminal ? <Popconfirm title="取消这场练习？" description="不再继续出题，已完成回答保留。" okText="确认取消" cancelText="继续练习" onConfirm={() => cancel.mutate()}><Button disabled={cancel.isPending}>取消练习</Button></Popconfirm> : null}</div>
    <Progress aria-label="练习进度" percent={Math.min(100,session.turns.length / Math.max(1,session.input.questionCount) * 100)} showInfo={false} status={session.status==='completed'?'success':'normal'} />
    <p className="session-model">本次模型：{session.modelSource.model??(session.modelMode==='demo'?'规则演示':'部署方默认模型')}</p>
    {session.plan?<PlanSummary plan={session.plan}/>:null}
    {session.plan&&session.status==='awaiting_answer'?<ReplanPanel session={session} onUpdate={onUpdate}/>:null}
    {session.research?<details className="research-sources"><summary>本场联网资料 · {session.research.sources.length} 条</summary><p>查询 {session.research.query}。资料只用于理解岗位，评分依据仍来自你的答案。</p>{session.research.sources.map(source=><article key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p>{source.snippet}</p></article>)}</details>:null}
    {session.turns.length ? <details className="completed-answers" open={terminal}><summary>已完成 QA · {session.turns.length} 题</summary>{session.turns.map((turn, index) => <Feedback key={index} turn={turn} index={index} demo={session.modelMode === 'demo'} />)}</details> : null}
    {pending ? <div className="pending-box" role="status"><span className="pulse"/><div><strong>{session.status === 'preparing' ? '正在准备第一道问题' : '正在阅读你的回答'}</strong><p>任务已保存。刷新页面后仍可继续查看结果。</p></div></div> : null}
    {session.status === 'awaiting_answer' ? <div className="question-panel"><span className="question-label">第 {session.turns.length + 1} 题 · {session.question.competency}</span><h2>{session.question.text}</h2>
      <p className="question-origin">{stageLabels[session.question.stage??'qa']} · {session.question.difficulty?difficultyLabels[session.question.difficulty]:'按题面'} · {session.question.provenance==='bank'?'题库原题':session.question.provenance==='adapted'?'按题库改编':'生成题'}</p>
      <form onSubmit={send}><label htmlFor="answer">你的回答</label><Input.TextArea id="answer" className={session.question.kind==='coding'?'code-answer':''} disabled={submit.isPending} required minLength={10} maxLength={12000} value={answer} onChange={e => setAnswer(e.target.value)} rows={session.question.kind==='coding'?12:7} placeholder={session.question.kind==='coding'?'填写代码、思路、边界与复杂度。代码不会在服务端执行。':'把问题、你的行动与结果说清楚。可以先写下要点，再组织成完整回答。'}/><div className="answer-footer"><span>{answer.length} / 12000 字 · 草稿自动保存到本机</span><Button type="primary" disabled={submit.isPending || answer.trim().length < 10} htmlType="submit">{submit.isPending ? '正在提交…' : '提交回答'}</Button></div></form></div> : null}
    {session.status === 'completed' ? <div className="report" aria-label="练习报告"><div className="report-top"><div><span>{session.modelMode === 'demo' ? '规则演示评分' : '本次练习评分'}</span><strong className="score">{session.report.overallScore}<small>/ 100</small></strong></div><div><h2>练习完成，可以开始复盘了。</h2><p>{session.report.summary}</p></div></div>
      <ReportPriorities session={session}/>
      {session.report.evaluation?<EvaluationBars evaluation={session.report.evaluation}/>:session.report.dimensions?<Dimensions dimensions={session.report.dimensions}/>:null}
      <div className="report-columns"><div><h3>可保留的表达</h3><ul>{session.report.strengths.map(text => <li key={text}>{text}</li>)}</ul></div><div><h3>下一次练习的重点</h3><ul>{session.report.improvements.map(text => <li key={text}>{text}</li>)}</ul></div></div><div className="report-actions"><Select aria-label="导出格式" value={exportFormat} onChange={setExportFormat} options={[{value:'markdown',label:'Markdown 复盘报告'},{value:'json',label:'JSON 原始记录'}]} /><Button onClick={download}>导出本次记录</Button><Button type="primary" onClick={onRepeat}>用相同资料再练一次</Button></div></div> : null}
    {session.status === 'failed' ? <div className="recovery-panel"><p className="error" role="alert">{session.error}</p>{session.recovery?<><h3>{session.recovery.question.text}</h3><p className="answer-text">{session.recovery.answer}</p></>:null}<div className="panel-actions"><Button onClick={onModelSettings}>检查模型设置</Button>{session.search?.kind==='on'?<><Button onClick={onSearchSettings}>检查搜索设置</Button><Button disabled={noSearchRetry.isPending} onClick={()=>noSearchRetry.mutate()}>关闭本场搜索并重试</Button></>:null}<Button type="primary" disabled={retry.isPending} onClick={()=>retry.mutate()}>{retry.isPending?'提交重试中…':session.search?.kind==='on'?'使用当前模型和搜索重试本轮':connectionId?'用当前模型重试本轮':'重试本轮'}</Button></div></div> : null}
    {session.status === 'cancelled' ? <p className="cancelled">练习已取消，已完成的回答保留在上方。你可以从左侧开始新的练习。</p> : null}
    {submit.error || cancel.error||retry.error||noSearchRetry.error ? <p className="error" role="alert">{submit.error?.message || cancel.error?.message||retry.error?.message||noSearchRetry.error?.message}。可重新读取或重试。</p> : null}
  </section>;
}
function Feedback({ turn, index, demo }: { turn: Turn; index: number; demo: boolean }) {
  return <details className="feedback" id={`qa-${index}`}><summary><span className="turn-index">{index + 1}</span><span>{turn.question.competency}<small>{turn.question.text}</small></span><strong>{turn.assessment.score}<small>{demo ? '演示分' : '分'}</small></strong></summary>
    <div className="feedback-body"><p className="session-model">第 {index+1} 题 QA · 评分模型 {turn.modelSource.model??'部署方默认模型'}</p><h3>你的回答</h3><p className="answer-text">{turn.answer}</p><h3>回答依据</h3><blockquote>{turn.assessment.evidence}</blockquote><p>{turn.assessment.feedback}</p>{turn.assessment.evaluation?<EvaluationBars evaluation={turn.assessment.evaluation}/>:turn.assessment.dimensions?<Dimensions dimensions={turn.assessment.dimensions}/>:null}<h3>改进方向</h3><ul>{turn.assessment.improvements.map(text => <li key={text}>{text}</li>)}</ul></div>
  </details>;
}
function Dimensions({dimensions}:{dimensions:NonNullable<Turn['assessment']['dimensions']>}){const labels={relevance:'岗位相关',depth:'技术深度',clarity:'表达结构',evidence:'结果证据'};return <div className="dimension-bars" aria-label="分维度反馈">{Object.entries(labels).map(([key,label])=>{const parsed=z.enum(['relevance','depth','clarity','evidence']).parse(key);return <div key={key}><span>{label}</span><meter aria-label={label} min={0} max={100} value={dimensions[parsed]}/><strong>{dimensions[parsed]}</strong></div>;})}</div>;}
