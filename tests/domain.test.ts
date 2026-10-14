import { describe,it,expect } from 'vitest';
import { input,answer } from './fixtures';
import { newSession,applyGeneration,cancelSession } from '../packages/interview/src/domain';
import { demoGenerate } from '../apps/agent/src/evaluator';
import { createInterviewSchema,sessionSchema,runtimeRequestSchema } from '../packages/contracts/src/index';
import { readConfig,readApiConfig,readWorkerConfig,readAgentConfig } from '../packages/config/src/index';
describe('interview behavior',()=>{
  it('completes bounded question/answer practice with grounded feedback and report',()=>{
    let session=newSession(input,'demo');
    let request=runtimeRequestSchema.parse({jobId:crypto.randomUUID(),input,turns:[],current:null});
    session=applyGeneration(session,demoGenerate(request),request);
    for(let index=0;index<input.questionCount;index++){
      expect(session.status).toBe('awaiting_answer');if(session.status!=='awaiting_answer')throw new Error('not awaiting');
      request={jobId:crypto.randomUUID(),input,turns:session.turns,current:{question:session.question,answer}};
      const evaluating=sessionSchema.parse({...session,status:'evaluating'});
      session=applyGeneration(evaluating,demoGenerate(request),request);
    }
    expect(session.status).toBe('completed');expect(session.turns).toHaveLength(3);
    if(session.status==='completed')expect(session.report.summary).toContain('规则演示');
    expect(session.turns.every(turn=>turn.answer.includes(turn.assessment.evidence))).toBe(true);
  });
  it('cancel is a terminal state and rejects late generation',()=>{
    const initial=newSession(input,'demo');const cancelled=cancelSession(initial);
    expect(cancelSession(cancelled)).toEqual(cancelled);
    const req={jobId:crypto.randomUUID(),input,turns:[],current:null};
    expect(()=>applyGeneration(cancelled,demoGenerate(req),req)).toThrow('INVALID_STATE');
  });
  it('rejects fabricated assessment evidence',()=>{
    const req={jobId:crypto.randomUUID(),input,turns:[],current:null};const initial=applyGeneration(newSession(input,'demo'),demoGenerate(req),req);
    if(initial.status!=='awaiting_answer')throw new Error('not awaiting');
    const nextReq={...req,current:{question:initial.question,answer}};const generated=demoGenerate(nextReq);
    if(!generated.assessment)throw new Error('missing assessment');
    const assessment=generated.assessment;
    expect(()=>applyGeneration({...initial,status:'evaluating'},{...generated,assessment:{...assessment,evidence:'不存在的经历'}},nextReq)).toThrow('UNGROUNDED_EVIDENCE');
  });
  it('rejects oversized context, unknown identity and excessive rounds',()=>{
    expect(createInterviewSchema.safeParse({...input,owner:'forged'}).success).toBe(false);
    expect(createInterviewSchema.safeParse({...input,questionCount:99}).success).toBe(false);
    expect(createInterviewSchema.safeParse({...input,resume:'x'.repeat(16001)}).success).toBe(false);
  });
});
describe('configuration ownership',()=>{
  it('API and worker do not receive model key through parsed configuration',()=>{
    expect(Object.hasOwn(readApiConfig(),'LLM_API_KEY')).toBe(false);
    expect(Object.hasOwn(readWorkerConfig(),'LLM_API_KEY')).toBe(false);
    expect(Object.hasOwn(readAgentConfig(),'DATABASE_URL')).toBe(false);
  });
  it('production rejects demonstration mode and sample secrets',()=>{
    expect(()=>readConfig({...process.env,NODE_ENV:'production'})).toThrow('Production');
    expect(()=>readAgentConfig({...process.env,NODE_ENV:'production'})).toThrow('production');
  });
  it('live configuration requires provider/model and credentials',()=>{
    expect(()=>readAgentConfig({...process.env,MODEL_MODE:'live',LLM_MODEL:'invalid',LLM_API_KEY:''})).toThrow('provider/model');
  });
});
