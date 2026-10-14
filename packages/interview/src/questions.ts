import type { BankQuestion } from '../../contracts/src/bank';
import type { InterviewPlan } from '../../contracts/src/planning';
import type { QuestionDirective,Turn } from '../../contracts/src/index';
import { nextStage } from './planner';
function difficultyAllowed(plan:InterviewPlan,q:BankQuestion){return plan.options.bankMode==='adaptive'||plan.difficulty==='hard'||plan.difficulty==='medium'&&q.difficulty!=='hard'||q.difficulty==='easy';}
export function eligibleCoding(plan:InterviewPlan,pool:BankQuestion[]){return pool.filter(q=>q.category==='coding'&&difficultyAllowed({...plan,options:{...plan.options,bankMode:'strict'}},q)&&(q.roleFamilies.includes('general')||q.roleFamilies.includes(plan.options.roleFamily)));}
export function eligibleQa(plan:InterviewPlan,pool:BankQuestion[],turns:Turn[]){const used=new Set(turns.flatMap(turn=>turn.question.bankId?[turn.question.bankId]:[]));return pool.filter(q=>!used.has(q.id)&&difficultyAllowed(plan,q)&&q.category===(plan.options.round==='hr'||plan.options.roleType==='nontechnical'?'behavioral':'technical')&&(q.roleFamilies.includes('general')||q.roleFamilies.includes(plan.options.roleFamily)));}
export function questionDirective(plan:InterviewPlan,turns:Turn[],pool:BankQuestion[],id:string,role:string):QuestionDirective|null{
  const stage=nextStage(plan);if(!stage)return null;
  const used=new Set(turns.flatMap(turn=>turn.question.bankId?[turn.question.bankId]:[]));
  const candidates=(stage==='qa'?eligibleQa(plan,pool,turns):pool.filter(q=>q.category===stage&&!used.has(q.id)&&(stage!=='coding'||difficultyAllowed({...plan,options:{...plan.options,bankMode:'strict'}},q))&&(q.roleFamilies.includes('general')||q.roleFamilies.includes(plan.options.roleFamily))));
  const ranks={easy:1,medium:2,hard:3};const selected=candidates.toSorted((a,b)=>Math.abs(ranks[a.difficulty]-ranks[plan.difficulty])-Math.abs(ranks[b.difficulty]-ranks[plan.difficulty])||a.id.localeCompare(b.id))[0];
  const kind=stage==='intro'?'opening':stage==='coding'?'coding':stage==='reverse'||plan.options.round==='hr'||plan.options.roleType==='nontechnical'?'behavioral':'technical';
  const fallback=stage==='intro'?`请介绍你与「${role}」最相关的经历和职责。`:stage==='reverse'?'请提出一个你希望向目标团队了解的问题，并说明它为什么影响你的选择。':`请结合真实经历，解释与你申请的「${role}」相关的一项技术或协作决策。`;
  const exact=plan.options.bankMode==='strict'||stage!=='qa'||plan.options.bankMode==='mixed'&&plan.progress.completed.qa%2===0;
  if(!selected&&(stage==='coding'||plan.options.bankMode==='strict'))throw new Error('QUESTION_BANK_INSUFFICIENT');
  const question:QuestionDirective['question']={id,text:selected?.content??fallback,competency:selected?.title.slice(0,100).replace(/[\uD800-\uDBFF]$/,'')??(stage==='intro'?'自我介绍':stage==='reverse'?'反问与岗位匹配':'岗位能力'),kind,stage,difficulty:exact&&selected?selected.difficulty:plan.difficulty,bankMode:plan.options.bankMode,provenance:exact&&selected?'bank':selected?'adapted':'generated',...(selected?{bankId:selected.id}:{})};
  if(exact&&selected)return{kind:'fixed',question,expectedAnswer:selected.expectedAnswer};
  return{kind:'generate',question,anchor:selected??null};
}
