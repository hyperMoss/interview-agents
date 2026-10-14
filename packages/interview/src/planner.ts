import type { InterviewPlan,PlanningOptions,PlanProgress } from '../../contracts/src/planning';

export function emptyProgress():PlanProgress{return{elapsedSeconds:0,completed:{intro:0,qa:0,coding:0,reverse:0},qaSeconds:[]};}
export function planInterview(options:PlanningOptions,progress:PlanProgress=emptyProgress(),availableQa:number|null=null,revision=0):InterviewPlan{
  const durationMinutes=options.round==='hr'?Math.min(30,options.durationMinutes):options.durationMinutes;
  const normalized={...options,durationMinutes};
  const codingEnabled=options.codingRequested&&options.practiceMode==='candidate'&&options.roleType==='technical'&&options.round!=='hr';
  const codingReason=!options.codingRequested?'未选择编程题':options.round==='hr'?'HR 面禁用编程题':options.practiceMode!=='candidate'?'编程题仅限求职者模式':options.roleType!=='technical'?'非技术岗不安排编程题':'从符合岗位的题库选择编程题';
  const difficulty=options.candidateLevel==='intern'?'easy':options.candidateLevel==='experienced'||options.round==='second'?'hard':'medium';
  const totalSeconds=durationMinutes*60;
  const introSeconds=Math.min(180,totalSeconds*.2),reverseSeconds=Math.min(180,totalSeconds*.2);
  const codingSeconds=codingEnabled?Math.min({intern:600,new_grad:900,experienced:1200}[options.candidateLevel],totalSeconds*.4):0;
  const baseSeconds={short:120,medium:180,long:300}[options.answerLength]/{intern:1.3,new_grad:1.1,experienced:.8}[options.candidateLevel]/{first:1.2,second:.7,hr:1}[options.round];
  const recent=progress.qaSeconds.slice(-3);const observed=recent.length?recent.reduce((sum,value)=>sum+value,0)/recent.length:baseSeconds;
  const perQa=Math.max(60,Math.min(600,Math.max(baseSeconds*.65,Math.min(baseSeconds*1.5,observed))));
  const c=progress.completed;
  const reserved=(c.intro?0:introSeconds)+(c.coding?0:codingSeconds)+(c.reverse?0:reverseSeconds);
  const qaBudget=Math.max(0,totalSeconds-progress.elapsedSeconds-reserved);
  const completedTotal=c.intro+c.qa+c.coding+c.reverse;
  const pendingFixed=(c.intro?0:1)+(codingEnabled&&!c.coding?1:0)+(c.reverse?0:1);
  let remainingQa=Math.min(Math.max(0,30-completedTotal-pendingFixed),Math.floor(qaBudget/perQa));
  if(options.bankMode==='strict'&&availableQa!==null)remainingQa=Math.min(remainingQa,availableQa);
  if(c.coding||c.reverse)remainingQa=0;
  const qaQuestions=c.qa+remainingQa;
  const stages:InterviewPlan['stages']=[
    {kind:'intro' satisfies 'intro',seconds:introSeconds,questions:Math.max(1,c.intro),completed:c.intro},
    {kind:'qa' satisfies 'qa',seconds:Math.max(0,totalSeconds-introSeconds-codingSeconds-reverseSeconds),questions:qaQuestions,completed:c.qa},
    {kind:'coding' satisfies 'coding',seconds:codingSeconds,questions:Math.max(c.coding,codingEnabled?1:0),completed:c.coding},
    {kind:'reverse' satisfies 'reverse',seconds:reverseSeconds,questions:Math.max(1,c.reverse),completed:c.reverse},
  ];
  if(progress.elapsedSeconds>=totalSeconds||c.reverse>0||(options.bankMode==='strict'&&availableQa===0&&completedTotal===0))for(const stage of stages)stage.questions=stage.completed;
  const totalQuestions=stages.reduce((sum,stage)=>sum+stage.questions,0);
  return{version:2,revision,options:normalized,codingEnabled,codingReason,difficulty,stages,totalQuestions,remainingQuestions:Math.max(0,totalQuestions-completedTotal),progress,availableQa};
}
export function nextStage(plan:InterviewPlan){return plan.stages.find(stage=>stage.completed<stage.questions)?.kind??null;}
export function evaluationScore(value:{technical:number|null;communication:number;overallQuality:number}){const scores=[value.technical,value.communication,value.overallQuality].filter(value=>value!==null);return Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length);}
