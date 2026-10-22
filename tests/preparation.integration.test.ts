import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAgentServer } from '../apps/agent/src/server';
import { InterviewService } from '../apps/api/src/interviews';
import { GenerationWorker } from '../apps/worker/src/worker';
import { apiConfig, agentConfig, workerConfig, input, answer } from './fixtures';
import { startProviderFixture, serveFixture } from './provider-fixture';
import type { PreparationInput } from '../packages/contracts/src/preparation';
import { preparationBankDraft } from '../packages/interview/src/preparation';
import { demoPreparation } from '../apps/agent/src/preparation';

const preparationInput:PreparationInput={role:'前端工程师',jobDescription:'熟悉 React 与 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。',candidateLevel:'new_grad',round:'first',roleType:'technical',roleFamily:'frontend',questionCount:3,focus:'请求竞争'};
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('JD preparation across model protocol, owned bank and strict interviews',()=>{
  let api:InterviewService, runtime:Awaited<ReturnType<typeof createAgentServer>>, bridge:Awaited<ReturnType<typeof serveFixture>>, provider:Awaited<ReturnType<typeof startProviderFixture>>, runner:GenerationWorker;
  const owner=crypto.randomUUID(),other=crypto.randomUUID();
  beforeAll(async()=>{
    provider=await startProviderFixture();
    runtime=await createAgentServer({...agentConfig(),AGENT_DATABASE_URL:'postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test'});
    bridge=await serveFixture(request=>runtime.app.fetch(request));
    api=new InterviewService({...apiConfig(),DATABASE_URL:'postgresql://app:local-app-password@127.0.0.1:55440/interview_test',AGENT_URL:bridge.origin});
    runner=new GenerationWorker({...workerConfig(),DATABASE_URL:api.config.DATABASE_URL,AGENT_URL:bridge.origin});
  });
  afterEach(async()=>{
    provider.state.failure=false;provider.state.badPreparationEvidence=false;provider.state.rateLimited=false;
    await api.database.pool.query('DELETE FROM app.interviews WHERE owner=$1 OR owner=$2',[owner,other]);
    await api.database.pool.query('DELETE FROM app.bank_questions WHERE owner=$1 OR owner=$2',[owner,other]);
    await api.models.clear(owner);
  });
  afterAll(async()=>{await Promise.all([api.onModuleDestroy(),runner.close(),runtime.close()]);await bridge.close();await provider.close();});
  const model=()=>api.models.save(owner,{baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'fixture-alpha-key',remember:false,timeoutMs:10000});
  function batch(){const output=demoPreparation(preparationInput);return{questions:output.questions.map(question=>({requestId:crypto.randomUUID(),draft:preparationBankDraft(preparationInput,question,output.requirements)}))};}
  it('uses the selected real protocol model for JD-only output without creating an interview or bank entries',async()=>{
    const connection=await model();const before=await api.bank.list(owner);
    const result=await api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id});
    expect(result.modelMode).toBe('live');expect(result.model).toBe('coach-alpha');expect(result.questions).toHaveLength(3);
    expect(provider.calls.at(-1)?.content).toContain(preparationInput.jobDescription);
    expect(provider.calls.at(-1)?.content).not.toContain(input.resume);expect(JSON.stringify(result)).not.toContain('fixture-alpha-key');
    expect((await api.bank.list(owner)).length).toBe(before.length);expect(await api.list(owner)).toHaveLength(0);
    await expect(api.preparation.generate(other,{input:preparationInput,modelConnectionId:connection.id})).rejects.toThrow();
  });
  it('rejects fabricated model citations and exposes upstream failure without demo fallback',async()=>{
    const connection=await model();provider.state.badPreparationEvidence=true;
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id})).rejects.toMatchObject({response:{code:'INVALID_JD_PREPARATION'}});
    provider.state.badPreparationEvidence=false;provider.state.failure=true;
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id})).rejects.toThrow('备题生成失败');
    expect(await api.list(owner)).toHaveLength(0);
  });
  it('keeps authentication and rate-limit errors actionable',async()=>{
    const invalid=await api.models.save(owner,{baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'incorrect-fixture-key',remember:false,timeoutMs:10000});
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:invalid.id})).rejects.toMatchObject({response:{code:'MODEL_AUTH_FAILED'}});
    const connection=await model();provider.state.rateLimited=true;
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id})).rejects.toMatchObject({response:{code:'MODEL_RATE_LIMITED'}});
  });
  it('saves edited drafts atomically and idempotently with strict owner isolation',async()=>{
    const command=batch();const first=command.questions[0];if(!first)throw new Error('Missing draft');
    first.draft.content='编辑后的 JD 问题，请具体解释请求去重与乱序结果的验证方法。';
    const saved=await api.bank.createBatch(owner,command);const again=await api.bank.createBatch(owner,command);
    expect(again.map(question=>question.id)).toEqual(saved.map(question=>question.id));expect(saved[0]?.content).toBe(first.draft.content);
    expect(saved[0]?.jdRequirement).toEqual(first.draft.jdRequirement);
    expect((await api.bank.list(owner)).find(question=>question.id===first.requestId)?.jdRequirement?.quote).toBe(first.draft.jdRequirement?.quote);
    expect((await api.bank.list(owner)).filter(question=>question.editable)).toHaveLength(3);
    expect((await api.bank.list(other)).some(question=>saved.some(item=>item.id===question.id))).toBe(false);
    await expect(api.bank.createBatch(other,command)).rejects.toThrow('题目创建键已使用');
    const changed={questions:[{...first,draft:{...first.draft,title:'同一键更改内容'}}]};
    await expect(api.bank.createBatch(owner,changed)).rejects.toThrow('同一请求键');
  });
  it('rolls back the whole batch when the owner reaches capacity',async()=>{
    const initial=await api.bank.list(owner);const command=batch();const sample=command.questions[0];if(!sample)throw new Error('Missing draft');
    await api.database.pool.query("INSERT INTO app.bank_questions(id,owner,source,payload) SELECT gen_random_uuid(),$1,'custom',$2::jsonb FROM generate_series(1,$3)",[owner,JSON.stringify(sample.draft),499-initial.length]);
    await expect(api.bank.createBatch(owner,command)).rejects.toThrow('最多 500');
    expect(await api.bank.list(owner)).toHaveLength(499);
    expect((await api.bank.list(owner)).some(question=>command.questions.some(item=>item.requestId===question.id))).toBe(false);
  });
  it('presents the saved JD text in strict practice and preserves the frozen material',async()=>{
    const saved=await api.bank.createBatch(owner,batch());const ids=saved.map(question=>question.id);
    const session=await api.create(owner,{...input,role:preparationInput.role,jobDescription:preparationInput.jobDescription,planning:{durationMinutes:60,answerLength:'short',candidateLevel:preparationInput.candidateLevel,round:'first',practiceMode:'candidate',roleType:'technical',roleFamily:'frontend',codingRequested:false,bankMode:'strict',bankIds:ids}});
    await runner.tick();let current=await api.get(owner,session.id);
    for(let index=0;index<6&&current.status!=='completed';index++){
      if(current.status!=='awaiting_answer')throw new Error('Not ready');
      const question=current.question;
      if(question.stage==='qa')expect(saved.find(item=>item.id===question.bankId)?.content).toBe(question.text);
      await api.answer(owner,current.id,{answer,revision:current.revision,requestId:crypto.randomUUID()});await runner.tick();current=await api.get(owner,current.id);
    }
    expect(current.status).toBe('completed');expect(current.turns.filter(turn=>turn.question.stage==='qa')).toHaveLength(3);
  });
});
