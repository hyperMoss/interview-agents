import { type Session, type RuntimeRequest, type RuntimeResponse, type InterviewInput } from '../../contracts/src/index';
import type { ModelSource } from '../../contracts/src/models';
import { evaluationScore } from './planner';

export function newSession(input: InterviewInput, modelMode: 'demo' | 'live',modelSource:ModelSource={kind:'default'}): Session {
  return { id: crypto.randomUUID(), role: input.role, createdAt: new Date().toISOString(), input,
    turns: [], modelMode, modelSource,revision: 0, status: 'preparing' };
}

export function sessionBase(session:Session){const {id,role,createdAt,input,turns,modelMode,modelSource,revision}=session;return{id,role,createdAt,input,turns,modelMode,modelSource,revision,...(session.plan?{plan:session.plan}:{}),...(session.startedAt?{startedAt:session.startedAt}:{}),...(session.presentedAt?{presentedAt:session.presentedAt}:{}),...(session.search?{search:session.search}:{}),...(session.research?{research:session.research}:{})};}
export function applyGeneration(session: Session, result: RuntimeResponse, request: RuntimeRequest,now=new Date().toISOString()): Session {
  if (session.status !== 'preparing' && session.status !== 'evaluating') throw new Error('INVALID_STATE');
  if (result.modelMode !== session.modelMode) throw new Error('MODEL_MODE_MISMATCH');
  if(session.modelSource.kind==='default'&&session.modelSource.model&&result.model&&session.modelSource.model!==result.model)throw new Error('MODEL_CHANGED');
  const modelSource:ModelSource=session.modelSource.kind==='default'&&result.model?{...session.modelSource,model:result.model}:session.modelSource;
  if (Boolean(request.current) !== Boolean(result.assessment)) throw new Error('INVALID_ASSESSMENT');
  if (request.current && result.assessment && !request.current.answer.includes(result.assessment.evidence)) throw new Error('UNGROUNDED_EVIDENCE');
  if(request.plan&&result.question?.kind==='coding'&&!request.plan.codingEnabled)throw new Error('CODING_FORBIDDEN');
  if(request.next?.kind==='fixed'&&result.question&&JSON.stringify(result.question)!==JSON.stringify(request.next.question))throw new Error('BANK_QUESTION_CHANGED');
  const turns = request.current && result.assessment
    ? [...session.turns, { ...request.current, assessment: result.assessment,modelSource,...(result.research?{research:result.research}:{}) }] : session.turns;
  const plan=request.plan??session.plan;
  const expired=plan&&session.startedAt&&Date.parse(now)-Date.parse(session.startedAt)>=plan.options.durationMinutes*60000;
  const base = {...sessionBase(session),input:plan?{...session.input,planning:plan.options,questionCount:Math.max(1,plan.totalQuestions)}:session.input,
    turns,modelSource,revision:session.revision+1,...(plan?{plan,startedAt:session.startedAt??now,presentedAt:now}:{}),...(result.research?{research:result.research}:{})};
  if (plan?(request.next===null||expired):turns.length >= session.input.questionCount) {
    const dimensionTurns=turns.flatMap(turn=>turn.assessment.dimensions?[turn.assessment.dimensions]:[]);
    const dimensions=dimensionTurns.length?{relevance:Math.round(dimensionTurns.reduce((sum,d)=>sum+d.relevance,0)/dimensionTurns.length),depth:Math.round(dimensionTurns.reduce((sum,d)=>sum+d.depth,0)/dimensionTurns.length),clarity:Math.round(dimensionTurns.reduce((sum,d)=>sum+d.clarity,0)/dimensionTurns.length),evidence:Math.round(dimensionTurns.reduce((sum,d)=>sum+d.evidence,0)/dimensionTurns.length)}:undefined;
    const evaluations=turns.flatMap(turn=>turn.assessment.evaluation?[turn.assessment.evaluation]:[]);
    const technical=evaluations.flatMap(e=>e.technical===null?[]:[e.technical]);
    const evaluation=evaluations.length?{technical:technical.length?Math.round(technical.reduce((sum,n)=>sum+n,0)/technical.length):null,communication:Math.round(evaluations.reduce((sum,e)=>sum+e.communication,0)/evaluations.length),overallQuality:Math.round(evaluations.reduce((sum,e)=>sum+e.overallQuality,0)/evaluations.length),rationale:{technical:technical.length?'汇总本次适用题目的技术表现。':null,communication:'汇总已完成答案的沟通结构与表达。',overallQuality:'汇总已完成答案的职责、判断和协作证据。'}}:undefined;
    const completedPlan=plan?{...plan,totalQuestions:turns.length,remainingQuestions:0,stages:plan.stages.map(s=>({...s,questions:s.completed}))}:undefined;
    return { ...base,input:{...base.input,questionCount:Math.max(1,turns.length)},...(completedPlan?{plan:completedPlan}:{}), status: 'completed', report: {
      overallScore: evaluation?evaluationScore(evaluation):turns.length?Math.round(turns.reduce((sum, turn) => sum + turn.assessment.score, 0) / turns.length):0,
      summary: session.modelMode === 'demo' ? '规则演示报告，仅用于验证流程，不代表专业能力评价。' : '根据本次作答生成的练习反馈，不作为招聘决策依据。',
      strengths: [...new Set(turns.flatMap(turn => turn.assessment.strengths))].slice(0, 6),
      improvements: [...new Set(turns.flatMap(turn => turn.assessment.improvements))].slice(0, 6),
      ...(dimensions?{dimensions}:{}),
      ...(evaluation?{evaluation}:{}),
    } };
  }
  if (!result.question) throw new Error('MISSING_NEXT_QUESTION');
  return { ...base, status: 'awaiting_answer', question: result.question };
}

export function cancelSession(session: Session): Session {
  if (session.status === 'completed' || session.status === 'cancelled') return session;
  return {...sessionBase(session),revision:session.revision+1,status:'cancelled'};
}
