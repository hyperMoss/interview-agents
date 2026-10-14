import { describe,it,expect,beforeAll,afterAll,afterEach } from 'vitest';
import { Pool } from 'pg';
import { ModelConnections,modelPolicy,validateModelUrl,defaultModelReference } from '../apps/agent/src/models';
import { createAgentServer } from '../apps/agent/src/server';
import { InterviewService } from '../apps/api/src/interviews';
import { GenerationWorker } from '../apps/worker/src/worker';
import { endpointSchema,modelDraftSchema } from '../packages/contracts/src/models';
import { agentConfig,apiConfig,workerConfig,input,answer } from './fixtures';
import { startProviderFixture,serveFixture } from './provider-fixture';
import { reportMarkdown } from '../packages/interview/src/report';
import type { AgentConfig } from '../packages/config/src/index';
describe('model configuration boundary',()=>{
  it('normalizes roots, trailing slashes and complete Chat Completions URLs',()=>{
    expect(endpointSchema.parse('https://example.test/v1/chat/completions/')).toBe('https://example.test/v1');expect(endpointSchema.parse('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1');
  });
  it('refuses credential URLs, fragments, queries and a key placed in a model field',()=>{
    for(const url of ['https://user:pass@example.test/v1','https://example.test/v1?key=x','https://example.test/v1#x','file:///tmp/model'])expect(endpointSchema.safeParse(url).success).toBe(false);
    expect(modelDraftSchema.safeParse({baseUrl:'https://example.test/v1',model:'fixture-private-token',apiKey:'fixture-private-token'}).success).toBe(false);
  });
  it('deployment switch blocks both private and public URLs',async()=>{const config:AgentConfig={...agentConfig(),CUSTOM_MODELS:'off'};await expect(validateModelUrl('http://127.0.0.1:11434/v1',config)).rejects.toThrow('关闭');});
  it('production defaults close custom access and require an explicit allowed host when enabled',async()=>{
    const config:AgentConfig={...agentConfig(),NODE_ENV:'production'};expect(modelPolicy(config).enabled).toBe(false);
    await expect(validateModelUrl('https://example.test/v1',{...config,CUSTOM_MODELS:'on'})).rejects.toThrow('允许列表');
  });
});
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('real model configuration → API → worker → Mastra → provider → report',()=>{
  let provider:Awaited<ReturnType<typeof startProviderFixture>>;let runtime:Awaited<ReturnType<typeof createAgentServer>>;let bridge:Awaited<ReturnType<typeof serveFixture>>;let api:InterviewService;let runner:GenerationWorker;let agentPool:Pool;let store:ModelConnections;
  const owner=crypto.randomUUID(),other=crypto.randomUUID();
  beforeAll(async()=>{
    provider=await startProviderFixture();const config={...agentConfig(),AGENT_DATABASE_URL:'postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test'};
    runtime=await createAgentServer(config);bridge=await serveFixture(request=>runtime.app.fetch(request));
    api=new InterviewService({...apiConfig(),DATABASE_URL:'postgresql://app:local-app-password@127.0.0.1:55440/interview_test',AGENT_URL:bridge.origin});
    runner=new GenerationWorker({...workerConfig(),DATABASE_URL:api.config.DATABASE_URL,AGENT_URL:bridge.origin});
    agentPool=new Pool({connectionString:config.AGENT_DATABASE_URL});store=new ModelConnections(agentPool,config);
  });
  afterEach(async()=>{provider.state.failure=false;provider.state.badEvidence=false;await api.database.pool.query('DELETE FROM app.interviews WHERE owner=$1 OR owner=$2',[owner,other]);await store.clear(owner);await store.clear(other);});
  afterAll(async()=>{await Promise.all([api.onModuleDestroy(),runner.close(),runtime.close(),agentPool.end()]);await bridge.close();await provider.close();});
  const draft=(model='coach-alpha')=>({baseUrl:provider.baseUrl,model,apiKey:model==='coach-alpha'?'fixture-alpha-key':'fixture-beta-key',remember:false,timeoutMs:5000});
  it('reads model lists without a known model, probes briefly and returns no key',async()=>{
    const listed=await api.models.list({baseUrl:provider.baseUrl,apiKey:'fixture-alpha-key'});expect(listed.models).toEqual(['coach-alpha','coach-beta']);
    const result=await api.models.probe(modelDraftSchema.parse({baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'fixture-alpha-key',timeoutMs:5000}));expect(result.ok).toBe(true);expect(JSON.stringify(result)).not.toContain('fixture-alpha-key');
  });
  it('encrypts credentials at rest, only exposes metadata and isolates owners',async()=>{
    const profile=await api.models.save(owner,draft());const row=await agentPool.query('SELECT encrypted_key FROM agent_runtime.model_connections WHERE id=$1',[profile.id]);
    expect(row.rows[0].encrypted_key).not.toContain('fixture-alpha-key');expect(JSON.stringify(profile)).not.toContain('fixture-alpha-key');expect((await store.resolve(owner,profile.id)).apiKey).toBe('fixture-alpha-key');
    await expect(store.resolve(other,profile.id)).rejects.toThrow('过期');expect((await api.models.settings(other)).active).toBeNull();
    await expect(api.database.pool.query('SELECT encrypted_key FROM agent_runtime.model_connections')).rejects.toThrow('permission denied');
  });
  it('saves a custom model and completes a real SDK interview instead of the deployment demo',async()=>{
    const profile=await api.models.save(owner,draft());let session=await api.create(owner,{...input,focus:'系统设计与故障恢复'},profile.id);
    expect(session.modelMode).toBe('live');await runner.tick();session=await api.get(owner,session.id);
    for(let index=0;index<3;index++){expect(session.status).toBe('awaiting_answer');await api.answer(owner,session.id,{answer,revision:session.revision,requestId:crypto.randomUUID()});await runner.tick();session=await api.get(owner,session.id);}
    expect(session.status).toBe('completed');if(session.status!=='completed')throw new Error('Not completed');expect(session.report.overallScore).toBe(78);expect(session.report.dimensions?.depth).toBe(75);
    expect(provider.calls.at(-1)?.authorization).toBe('Bearer fixture-alpha-key');expect(provider.calls.at(-1)?.content).toContain('系统设计与故障恢复');expect(session.turns.every(turn=>turn.modelSource.model==='coach-alpha')).toBe(true);
    expect(JSON.stringify(session)).not.toContain('fixture-alpha-key');expect(reportMarkdown(session)).not.toContain('fixture-alpha-key');
  });
  it('switching the active connection does not alter an existing interview snapshot',async()=>{
    const a=await api.models.save(owner,draft());const session=await api.create(owner,input,a.id);await runner.tick();const ready=await api.get(owner,session.id);
    const b=await api.models.save(owner,draft('coach-beta'));await api.answer(owner,session.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()});await runner.tick();expect(provider.calls.at(-1)?.model).toBe('coach-alpha');
    const next=await api.create(owner,input,b.id);await runner.tick();expect((await api.get(owner,next.id)).modelSource.model).toBe('coach-beta');expect(provider.calls.at(-1)?.authorization).toBe('Bearer fixture-beta-key');
  });
  it('failed generation preserves the submitted answer; explicit retry does not duplicate turns',async()=>{
    const profile=await api.models.save(owner,draft());const created=await api.create(owner,input,profile.id);await runner.tick();const ready=await api.get(owner,created.id);
    await api.answer(owner,created.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()});provider.state.failure=true;await runner.tick();await runner.tick();const failed=await api.get(owner,created.id);
    expect(failed.status).toBe('failed');if(failed.status!=='failed')throw new Error('Not failed');expect(failed.recovery?.answer).toBe(answer);
    provider.state.failure=false;const command={requestId:crypto.randomUUID(),revision:failed.revision,modelConnectionId:profile.id};await api.retry(owner,created.id,command);await api.retry(owner,created.id,command);await runner.tick();
    const recovered=await api.get(owner,created.id);expect(recovered.turns).toHaveLength(1);expect(recovered.turns[0]?.answer).toBe(answer);
  });
  it('clear removes all owner keys, blocks old IDs and restores deployment defaults',async()=>{
    const profile=await api.models.save(owner,draft());await api.models.clear(owner);expect((await api.models.settings(owner)).active).toBeNull();await expect(api.create(owner,input,profile.id)).rejects.toThrow('过期');
    expect((await api.create(owner,input)).modelMode).toBe('demo');
  });
  it('explicitly returning to a live default removes the old custom connection from the retry job',async()=>{
    const profile=await api.models.save(owner,draft());const created=await api.create(owner,input,profile.id);await runner.tick();const ready=await api.get(owner,created.id);
    await api.answer(owner,created.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()});provider.state.failure=true;await runner.tick();await runner.tick();const failed=await api.get(owner,created.id);
    const liveApi=new InterviewService({...api.config,MODEL_MODE:'live'});
    try{
      const command={requestId:crypto.randomUUID(),revision:failed.revision,modelConnectionId:null};
      await liveApi.retry(owner,created.id,command);
      const result=await api.database.pool.query('SELECT payload FROM app.jobs WHERE id=$1',[command.requestId]);
      expect(result.rows[0].payload.modelConnectionId).toBeUndefined();expect(result.rows[0].payload.current.answer).toBe(answer);
      await expect(liveApi.retry(owner,created.id,{requestId:command.requestId,revision:command.revision})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    }finally{await liveApi.onModuleDestroy();}
  });
  it('expired connections and disabled custom access fail without a fallback',async()=>{
    const profile=await api.models.save(owner,draft());await agentPool.query("UPDATE agent_runtime.model_connections SET expires_at=now()-interval '1 second' WHERE id=$1",[profile.id]);await expect(store.resolve(owner,profile.id)).rejects.toThrow('过期');
    const disabled=new ModelConnections(agentPool,{...store.config,CUSTOM_MODELS:'off'});await expect(disabled.save(other,draft())).rejects.toThrow('关闭');
  });
  it('a changed deployment URL or credential blocks old default tasks before any provider call',async()=>{
    const config:AgentConfig={...store.config,MODEL_MODE:'live',LLM_MODEL:'openai/coach-alpha',LLM_BASE_URL:provider.baseUrl,LLM_API_KEY:'fixture-alpha-key'};
    const reference=defaultModelReference(config);const changed=await createAgentServer({...config,LLM_API_KEY:'fixture-beta-key'});
    const count=provider.calls.length;
    try{const response=await changed.app.request('/internal/v1/generate',{method:'POST',headers:{authorization:`Bearer ${config.INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({jobId:crypto.randomUUID(),input,turns:[],current:null,defaultModelReference:reference})});expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'MODEL_DEFAULT_CHANGED'});expect(provider.calls).toHaveLength(count);expect(defaultModelReference({...config,LLM_BASE_URL:provider.baseUrl+'/changed'})).not.toBe(reference);}
    finally{await changed.close();}
  });
  it('forged evidence cannot advance an interview',async()=>{
    const profile=await api.models.save(owner,draft());const session=await api.create(owner,input,profile.id);await runner.tick();const ready=await api.get(owner,session.id);
    provider.state.badEvidence=true;await api.answer(owner,session.id,{answer,revision:ready.revision,requestId:crypto.randomUUID()});await runner.tick();await runner.tick();const failed=await api.get(owner,session.id);expect(failed.status).toBe('failed');expect(failed.turns).toHaveLength(0);
  });
});
