import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAgentServer } from '../apps/agent/src/server';
import { InterviewService } from '../apps/api/src/interviews';
import { GenerationWorker } from '../apps/worker/src/worker';
import { apiConfig, agentConfig, workerConfig, input, answer } from './fixtures';
import { startProviderFixture, serveFixture } from './provider-fixture';
import {PREPARATION_TIMEOUT_MS,type PreparationInput} from '../packages/contracts/src/preparation';
import { preparationBankDraft } from '../packages/interview/src/preparation';
import { demoPreparation } from '../apps/agent/src/preparation';

const preparationInput:PreparationInput={role:'前端工程师',jobDescription:'熟悉 React 与 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。',candidateLevel:'new_grad',round:'first',roleType:'technical',roleFamily:'frontend',questionCount:3,focus:'请求竞争'};
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('JD preparation across model protocol, owned bank and strict interviews',()=>{
  let api:InterviewService, runtime:Awaited<ReturnType<typeof createAgentServer>>, bridge:Awaited<ReturnType<typeof serveFixture>>, provider:Awaited<ReturnType<typeof startProviderFixture>>, runner:GenerationWorker;
  const owner=crypto.randomUUID(),other=crypto.randomUUID();
  beforeAll(async()=>{
    provider=await startProviderFixture();
    runtime=await createAgentServer({...agentConfig(),AGENT_DATABASE_URL:(process.env.SQLITE_TEST_AGENT_URL ?? "file:/tmp/interview-tests-agent.sqlite")});
    bridge=await serveFixture(request=>runtime.app.fetch(request));
    api=new InterviewService({...apiConfig(),DATABASE_URL:(process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite"),AGENT_URL:bridge.origin});
    runner=new GenerationWorker({...workerConfig(),DATABASE_URL:api.config.DATABASE_URL,AGENT_URL:bridge.origin});
  });
  afterEach(async()=>{
    provider.state.failure=false;provider.state.badPreparationEvidence=false;provider.state.rateLimited=false;provider.state.requirePreparationSchema=false;provider.state.invalidPreparationOnce=false;provider.state.preparationResponse='valid';
    await api.database.pool.query("DELETE FROM app_interviews WHERE owner=$1 OR owner=$2",[owner,other]);
    await api.database.pool.query("DELETE FROM app_bank_questions WHERE owner=$1 OR owner=$2",[owner,other]);
    await api.models.clear(owner);
    await api.database.pool.query("DELETE FROM app_preparation_history WHERE owner=$1 OR owner=$2",[owner,other]);
  });
  afterAll(async()=>{await Promise.all([api.onModuleDestroy(),runner.close(),runtime.close()]);await bridge.close();await provider.close();});
  const model=()=>api.models.save(owner,{baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'fixture-alpha-key',remember:false,timeoutMs:10000});
  it('supplies the full output contract even when the provider does not enforce response_format',async()=>{
    const connection=await model();provider.state.requirePreparationSchema=true;
    const result=await api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id});
    expect(result.questions).toHaveLength(3);expect(result.requirements[0]?.competency).toBeTruthy();
  });
  it('corrects one malformed output without accepting invalid evidence or looping',async()=>{
    const connection=await model();provider.state.invalidPreparationOnce=true;const before=provider.calls.length;
    const result=await api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id});
    expect(result.questions).toHaveLength(3);expect(provider.calls.length-before).toBe(2);
    provider.state.badPreparationEvidence=true;const invalidStart=provider.calls.length;
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id})).rejects.toMatchObject({response:{code:'INVALID_JD_PREPARATION'}});
    expect(provider.calls.length-invalidStart).toBe(2);
  });
  it('repairs truncated and malformed JSON responses once instead of returning a generic failure',async()=>{
    const connection=await model();
    for(const kind of ['invalid_json_once','truncated_once'] satisfies (typeof provider.state.preparationResponse)[]){
      provider.state.preparationResponse=kind;const before=provider.calls.length;
      const result=await api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id});
      expect(result.questions).toHaveLength(3);expect(provider.calls.length-before).toBe(2);
    }
    provider.state.preparationResponse='truncated';
    await expect(api.preparation.generate(owner,{input:preparationInput,modelConnectionId:connection.id})).rejects.toMatchObject({response:{code:'PREPARATION_OUTPUT_LIMIT'}});
  });
  it('persists owned success and failure history, retries into a new immutable record and replays request IDs',async()=>{
    const connection=await model();const requestId=crypto.randomUUID();const request={requestId,input:preparationInput,modelConnectionId:connection.id};
    const before=provider.calls.length;const result=await api.preparation.generate(owner,request);
    expect(await api.preparation.generate(owner,request)).toEqual(result);expect(provider.calls.length-before).toBe(1);
    const original=await api.preparation.get(owner,requestId);expect(original.outcome.status).toBe('ready');
    await expect(api.preparation.generate(owner,{...request,input:{...preparationInput,focus:'changed'}})).rejects.toThrow('同一请求编号');
    await expect(api.preparation.get(other,requestId)).rejects.toThrow('不存在');
    await expect(api.preparation.retry(other,requestId,{requestId:crypto.randomUUID(),modelConnectionId:connection.id})).rejects.toThrow('不存在');
    provider.state.badPreparationEvidence=true;const failedId=crypto.randomUUID();
    await expect(api.preparation.generate(owner,{...request,requestId:failedId})).rejects.toThrow();
    const failed=await api.preparation.get(owner,failedId);expect(failed.outcome).toMatchObject({status:'failed',code:'INVALID_JD_PREPARATION'});expect(failed.input).toEqual(preparationInput);
    provider.state.badPreparationEvidence=false;const retryId=crypto.randomUUID();
    const retry=await api.preparation.retry(owner,failedId,{requestId:retryId,modelConnectionId:connection.id});
    expect(retry).toMatchObject({id:retryId,parentId:failedId,outcome:{status:'ready'},input:preparationInput});
    expect(await api.preparation.get(owner,failedId)).toEqual(failed);expect(await api.preparation.get(owner,requestId)).toEqual(original);
    const retryCalls=provider.calls.length;expect(await api.preparation.retry(owner,failedId,{requestId:retryId,modelConnectionId:connection.id})).toEqual(retry);expect(provider.calls.length).toBe(retryCalls);
    const first=await api.preparation.history(owner,{limit:2});expect(first.items).toHaveLength(2);expect(first.nextBefore).toBeTruthy();
    const next=await api.preparation.history(owner,{limit:2,before:first.nextBefore??undefined});expect(next.items).toHaveLength(1);expect(new Set([...first.items,...next.items].map(row=>row.id)).size).toBe(3);
    expect(JSON.stringify(first)).not.toContain(preparationInput.jobDescription);expect(JSON.stringify(retry)).not.toContain('fixture-alpha-key');expect((await api.preparation.history(other,{limit:20})).items).toEqual([]);
  });
  it('marks stale generating records interrupted and can retry their saved input',async()=>{
    const connection=await model();const id=crypto.randomUUID(),then=new Date(Date.now()-PREPARATION_TIMEOUT_MS-20000).toISOString();
    const activeAt=new Date(Date.now()-90000).toISOString();
    const record={id,parentId:null,input:preparationInput,modelConnectionId:connection.id,createdAt:activeAt,updatedAt:activeAt,outcome:{status:'generating'}};
    await api.database.pool.query('INSERT INTO app_preparation_history(id,owner,request_hash,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[id,owner,'synthetic-interrupted',JSON.stringify(record),activeAt]);
    expect((await api.preparation.get(owner,id)).outcome.status).toBe('generating');
    await expect(api.preparation.retry(owner,id,{requestId:crypto.randomUUID(),modelConnectionId:connection.id})).rejects.toThrow('仍在生成');
    await api.database.pool.query("UPDATE app_preparation_history SET created_at=$1,payload=json_set(payload,'$.createdAt',$1) WHERE id=$2",[then,id]);
    expect((await api.preparation.get(owner,id)).outcome).toMatchObject({status:'failed',code:'PREPARATION_INTERRUPTED'});
    expect((await api.preparation.retry(owner,id,{requestId:crypto.randomUUID(),modelConnectionId:connection.id})).outcome.status).toBe('ready');
  });
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
    await api.database.pool.query("WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<$3) INSERT INTO app_bank_questions(id,owner,source,payload) SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),$1,'custom',$2 FROM sequence WHERE n<=$3",[owner,JSON.stringify(sample.draft),499-initial.length]);
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
