import type { Turn } from '../../contracts/src/index';
import type { InterviewPlan,PlanProgress } from '../../contracts/src/planning';
import { emptyProgress } from './planner';
import type { z } from 'zod';
import type { stageSchema } from '../../contracts/src/bank';
export function acceptedProgress(turns:Array<Pick<Turn,'question'|'durationSeconds'>>,startedAt:string|undefined,now:number):PlanProgress{
  const progress=emptyProgress();progress.elapsedSeconds=startedAt?Math.min(7200,Math.max(0,(now-Date.parse(startedAt))/1000)):0;
  for(const turn of turns){const stage=turn.question.stage;if(stage){progress.completed[stage]++;if(stage==='qa')progress.qaSeconds.push(Math.min(7200,turn.durationSeconds??0));}}
  return progress;
}
export function pinCurrentQuestion(plan:InterviewPlan,stage:z.infer<typeof stageSchema>){
  const stages=plan.stages.map(item=>({...item}));
  const currentIndex=stages.findIndex(item=>item.kind===stage);
  for(const [index,item]of stages.entries()){if(item.kind===stage)item.questions=Math.max(item.questions,item.completed+1);if(index<currentIndex)item.questions=item.completed;}
  const totalQuestions=stages.reduce((sum,item)=>sum+item.questions,0),completed=stages.reduce((sum,item)=>sum+item.completed,0);
  return{...plan,stages,totalQuestions,remainingQuestions:totalQuestions-completed};
}
