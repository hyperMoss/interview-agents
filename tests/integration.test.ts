import { describe,it,expect,beforeAll,afterAll,afterEach } from 'vitest';
import { InterviewService } from '../apps/api/src/interviews';
import { GenerationWorker } from '../apps/worker/src/worker';
import { createAgentServer } from '../apps/agent/src/server';
import { apiConfig,agentConfig,workerConfig,input,answer } from './fixtures';
import { runtimeResponseSchema,runtimeRequestSchema, type RuntimeResponse } from '../packages/contracts/src/index';
import { demoGenerate,createEvaluator } from '../apps/agent/src/evaluator';
import { createServer } from 'node:http';
import { serveFixture } from './provider-fixture';
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('real PostgreSQL ownership, execution and runtime contracts',()=>{
  let api:InterviewService;let runner:GenerationWorker;let runtime:Awaited<ReturnType<typeof createAgentServer>>;
  let bridge:Awaited<ReturnType<typeof serveFixture>>;
  const owner=crypto.randomUUID();
  beforeAll(async()=>{
    const db='postgresql://app:local-app-password@127.0.0.1:55440/interview_test';
    const agentDb='postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test';
    runtime=await createAgentServer({...agentConfig(),AGENT_DATABASE_URL:agentDb});
    bridge=await serveFixture(request=>runtime.app.fetch(request));
    api=new InterviewService({...apiConfig(),DATABASE_URL:db,AGENT_URL:bridge.origin});
    runner=new GenerationWorker({...workerConfig(),DATABASE_URL:db},async request=>{
      const response=await runtime.app.request('/internal/v1/generate',{method:'POST',headers:{authorization:`Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(request)});
      if(!response.ok)throw new Error(`runtime ${response.status}`);return runtimeResponseSchema.parse(await response.json());
    });
  });
  afterEach(async()=>{await api.database.pool.query('DELETE FROM app.interviews WHERE owner=$1',[owner]);});
  afterAll(async()=>{await Promise.all([api.onModuleDestroy(),runner.close(),runtime.close()]);await bridge.close();});
  it('persists a full interview and reads the same terminal report after reconnect',async()=>{
    let session=await api.create(owner,input);await runner.tick();session=await api.get(owner,session.id);
    for(let index=0;index<3;index++){
      expect(session.status).toBe('awaiting_answer');
      await api.answer(owner,session.id,{answer,revision:session.revision,requestId:crypto.randomUUID()});await runner.tick();session=await api.get(owner,session.id);
    }
    expect(session.status).toBe('completed');expect((await api.get(owner,session.id))).toEqual(session);
  });
  it('accepts a valid thirty-question history with long Chinese questions and answers',async()=>{
    const question={text:'题'.repeat(16000),competency:'长题面与答案',kind:'technical' as const};const longAnswer='答'.repeat(12000);
    const turn={question,answer:longAnswer,assessment:{score:60,evidence:longAnswer.slice(0,80),feedback:'这是合成历史记录。',strengths:[],improvements:['这是测试改进项。']}};
    const payload=runtimeRequestSchema.parse({jobId:crypto.randomUUID(),input:{...input,questionCount:30},turns:Array.from({length:29},()=>turn),current:{question,answer:longAnswer}});
    const body=JSON.stringify(payload);expect(Buffer.byteLength(body)).toBeGreaterThan(2*1024*1024);
    const response=await runtime.app.request('/internal/v1/generate',{method:'POST',headers:{authorization:`Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'},body});expect(response.status).toBe(200);expect(runtimeResponseSchema.parse(await response.json()).question).toBeNull();
  });
  it('denies cross-owner reads, writes, deletion and identity spoofing',async()=>{
    const session=await api.create(owner,input);const other=crypto.randomUUID();
    await expect(api.get(other,session.id)).rejects.toThrow('not found');await expect(api.cancel(other,session.id)).rejects.toThrow('not found');await expect(api.remove(other,session.id)).rejects.toThrow('not found');
    expect(await api.list(other)).toEqual([]);expect((await api.get(owner,session.id)).status).toBe('preparing');
  });
  it('same request retry is idempotent; another input for its key conflicts',async()=>{
    const session=await api.create(owner,input);await runner.tick();const ready=await api.get(owner,session.id);
    const command={answer,revision:ready.revision,requestId:crypto.randomUUID()};await Promise.all([api.answer(owner,session.id,command),api.answer(owner,session.id,command)]);
    const count=await api.database.pool.query('SELECT count(*)::int AS count FROM app.jobs WHERE id=$1',[command.requestId]);expect(count.rows[0].count).toBe(1);
    await expect(api.answer(owner,session.id,{...command,answer:answer+'不同'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('concurrent different requests accept exactly one answer',async()=>{
    const session=await api.create(owner,input);await runner.tick();const ready=await api.get(owner,session.id);
    const results=await Promise.allSettled([api.answer(owner,session.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()}),api.answer(owner,session.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()})]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  });
  it('cancel stores a terminal state and blocks a running late model result',async()=>{
    const session=await api.create(owner,input);let release:(result:RuntimeResponse)=>void=()=>{};let started:()=>void=()=>{};
    const waiting=new Promise<void>(resolve=>{started=resolve;});
    const delayed=new GenerationWorker(runner.config,request=>new Promise(resolve=>{release=resolve;started();}));
    const work=delayed.tick();await waiting;await api.cancel(owner,session.id);
    release(demoGenerate({jobId:crypto.randomUUID(),input,turns:[],current:null}));await work;await delayed.close();
    expect((await api.get(owner,session.id)).status).toBe('cancelled');
  });
  it('a new worker recovers expired processing jobs',async()=>{
    const session=await api.create(owner,input);await api.database.pool.query("UPDATE app.jobs SET status='processing',attempts=1,lease_until=now()-interval '1 second' WHERE session_id=$1",[session.id]);
    await runner.tick();expect((await api.get(owner,session.id)).status).toBe('awaiting_answer');
  });
  it('expired lease generation cannot overwrite the succeeding newer worker result',async()=>{
    const session=await api.create(owner,input);let release:(result:RuntimeResponse)=>void=()=>{};let started:()=>void=()=>{};
    const waiting=new Promise<void>(resolve=>{started=resolve;});
    const stale=new GenerationWorker(runner.config,_request=>new Promise(resolve=>{release=resolve;started();}));const work=stale.tick();await waiting;
    await api.database.pool.query("UPDATE app.jobs SET lease_until=now()-interval '1 second' WHERE session_id=$1",[session.id]);await runner.tick();
    const committed=await api.get(owner,session.id);release(demoGenerate({jobId:crypto.randomUUID(),input,turns:[],current:null}));await work;await stale.close();
    expect(await api.get(owner,session.id)).toEqual(committed);expect(committed.revision).toBe(1);
  });
  it('runtime failure has bounded retries and a persistent visible failure',async()=>{
    const session=await api.create(owner,input);const failing=new GenerationWorker(runner.config,async()=>{throw new Error('provider fixture failure');});
    await failing.tick();await failing.tick();expect((await api.get(owner,session.id)).status).toBe('failed');await failing.close();
    const result=await api.database.pool.query('SELECT attempts,status FROM app.jobs WHERE session_id=$1',[session.id]);expect(result.rows[0]).toMatchObject({attempts:2,status:'failed'});
  });
  it('runtime denies missing service token and rejects bad request fields',async()=>{
    expect((await runtime.app.request('/internal/v1/generate',{method:'POST',body:'{}'})).status).toBe(401);
    expect((await runtime.app.request('/internal/v1/generate',{method:'POST',headers:{authorization:`Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}`},body:'{}'})).status).toBe(400);
  });
  it('runtime caches a job id and rejects key reuse with different input',async()=>{
    const request={jobId:crypto.randomUUID(),input,turns:[],current:null};const headers={authorization:`Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'};
    const a=await runtime.app.request('/internal/v1/generate',{method:'POST',headers,body:JSON.stringify(request)});const b=await runtime.app.request('/internal/v1/generate',{method:'POST',headers,body:JSON.stringify(request)});
    expect(a.status).toBe(200);expect(await b.json()).toEqual(await a.json());
    expect((await runtime.app.request('/internal/v1/generate',{method:'POST',headers,body:JSON.stringify({...request,input:{...input,role:'另一个岗位'}})})).status).toBe(409);
  });
  it('delete tombstone purges receipts and blocks late recreation',async()=>{
    const request={jobId:crypto.randomUUID(),input,turns:[],current:null};const headers={authorization:`Bearer ${agentConfig().INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'};
    await runtime.app.request('/internal/v1/generate',{method:'POST',headers,body:JSON.stringify(request)});
    expect((await runtime.app.request(`/internal/v1/receipts/${request.jobId}`,{method:'DELETE',headers})).status).toBe(200);
    expect((await runtime.app.request('/internal/v1/generate',{method:'POST',headers,body:JSON.stringify(request)})).status).toBe(410);
  });
  it('business deletion queues runtime cleanup before removing context and jobs',async()=>{
    const session=await api.create(owner,input);await runner.tick();const row=await api.database.pool.query('SELECT id FROM app.jobs WHERE session_id=$1',[session.id]);
    await api.remove(owner,session.id);await expect(api.get(owner,session.id)).rejects.toThrow('not found');
    expect((await api.database.pool.query('SELECT 1 FROM app.deletions WHERE job_id=$1',[row.rows[0].id])).rowCount).toBe(1);
  });
  it('Agent database role cannot read business context',async()=>{
    const {Pool}=await import('pg');const pool=new Pool({connectionString:'postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test'});
    await expect(pool.query('SELECT * FROM app.interviews')).rejects.toThrow('permission denied');await pool.end();
  });
  it('live Mastra adapter accepts OpenAI-compatible JSON and fails on provider failure without demo fallback',async()=>{
    let reject=false;let calls=0;
    const server=createServer((_req,res)=>{
      calls++;
      if(reject){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture unavailable'}}));return;}
      const object={modelMode:'live',question:{text:'请说明你在项目中负责的技术决策。',competency:'技术决策',kind:'opening'},assessment:null};
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'coach',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(object)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');
    const evaluator=createEvaluator({...agentConfig(),AGENT_DATABASE_URL:'postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test',MODEL_MODE:'live',LLM_MODEL:'fixture/coach',LLM_BASE_URL:`http://127.0.0.1:${address.port}/v1`,LLM_API_KEY:'fixture-only-not-a-real-key'});
    const request={jobId:crypto.randomUUID(),input,turns:[],current:null};
    try{expect((await evaluator.generate(request,AbortSignal.timeout(10000))).modelMode).toBe('live');reject=true;
      await expect(evaluator.generate({...request,jobId:crypto.randomUUID()},AbortSignal.timeout(10000))).rejects.toThrow();expect(calls).toBe(2);
    }finally{await evaluator.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
});
