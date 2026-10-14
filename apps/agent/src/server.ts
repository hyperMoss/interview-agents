import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { MastraServer, type HonoBindings, type HonoVariables } from '@mastra/hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { runtimeRequestSchema, runtimeResponseSchema,type RuntimeRequest } from '../../../packages/contracts/src/index';
import { createEvaluator } from './evaluator';
import { ModelConnections,modelPolicy,listModels,probeModel,ModelAccessError,defaultModelReference } from './models';
import type { AgentConfig } from '../../../packages/config/src/index';
import { SearchConnections,searchProvider } from './search';
import { searchProbeSchema } from '../../../packages/contracts/src/search';

export async function createAgentServer(config: AgentConfig) {
  const pool = new Pool({ connectionString: config.AGENT_DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
  const settingsPool=new Pool({connectionString:config.AGENT_DATABASE_URL,max:5,connectionTimeoutMillis:5000});
  const evaluator = createEvaluator(config);
  await evaluator.storage.init();
  const connections=new ModelConnections(settingsPool,config);
  const searchConnections=new SearchConnections(settingsPool,config);
  const cleanup=setInterval(()=>{void Promise.all([connections.purge(),searchConnections.purge()]).catch(()=>{});},60000);
  const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
  app.get('/health', async c => { await pool.query('SELECT 1'); return c.json({ status: 'ok', modelMode: config.MODEL_MODE }); });
  app.use('*', bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  app.use('*', async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const expected = config.INTERNAL_SERVICE_TOKEN;
    if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return c.json({ error: 'UNAUTHORIZED' }, 401);
    await next();
  });
  app.get('/internal/v1/models/:owner',async c=>{
    const owner=z.uuid().parse(c.req.param('owner'));const policy=modelPolicy(config);
    return c.json({enabled:policy.enabled,allowLocal:policy.allowLocal,mode:config.MODEL_MODE,defaultModel:config.LLM_MODEL,defaultReference:defaultModelReference(config),active:policy.enabled?await connections.active(owner):null});
  });
  app.get('/internal/v1/models/:owner/:id',async c=>c.json(await connections.describe(z.uuid().parse(c.req.param('owner')),z.uuid().parse(c.req.param('id')))));
  app.post('/internal/v1/models/:owner',async c=>c.json(await connections.save(z.uuid().parse(c.req.param('owner')),await c.req.json())));
  app.delete('/internal/v1/models/:owner',async c=>c.json(await connections.clear(z.uuid().parse(c.req.param('owner')))));
  app.post('/internal/v1/model-list',async c=>c.json(await listModels(await c.req.json(),config)));
  app.post('/internal/v1/model-probe',async c=>c.json(await probeModel(await c.req.json(),config)));
  app.get('/internal/v1/search-settings/:owner',async c=>c.json(await searchConnections.settings(z.uuid().parse(c.req.param('owner')))));
  app.get('/internal/v1/search-settings/:owner/:id',async c=>c.json(await searchConnections.describe(z.uuid().parse(c.req.param('owner')),z.uuid().parse(c.req.param('id')))));
  app.post('/internal/v1/search-settings/:owner',async c=>c.json(await searchConnections.save(z.uuid().parse(c.req.param('owner')),await c.req.json())));
  app.delete('/internal/v1/search-settings/:owner',async c=>c.json(await searchConnections.clear(z.uuid().parse(c.req.param('owner')))));
  app.post('/internal/v1/search-probe',async c=>{const input=searchProbeSchema.parse(await c.req.json());return c.json({ok:true,sources:await searchProvider(input.draft,input.query,config)});});
  app.post('/internal/v1/generate', async c => {
    const parsed = runtimeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'INVALID_REQUEST' }, 400);
    const request = parsed.data;
    if(!request.modelConnectionId&&request.defaultModelReference&&request.defaultModelReference!==defaultModelReference(config))return c.json({error:'MODEL_DEFAULT_CHANGED'},409);
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='65s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [request.jobId]);
      const deleted=await client.query('SELECT 1 FROM agent_runtime.deleted_jobs WHERE job_id=$1',[request.jobId]);
      if(deleted.rows.length){await client.query('ROLLBACK');return c.json({error:'DELETED'},410);}
      const prior = await client.query('SELECT input_hash,response FROM agent_runtime.receipts WHERE job_id=$1', [request.jobId]);
      const existing = prior.rows[0];
      if (existing) {
        if (existing.input_hash !== digest) { await client.query('ROLLBACK'); return c.json({ error: 'IDEMPOTENCY_CONFLICT' }, 409); }
        await client.query('COMMIT'); return c.json(runtimeResponseSchema.parse(existing.response));
      }
      const signal = AbortSignal.any([AbortSignal.timeout(55000), c.req.raw.signal]);
      let custom:ReturnType<typeof createEvaluator>|undefined;
      let response;
      try{
        const research=request.research?.kind==='fetch'
          ?request.ownerId?await searchConnections.search(request.ownerId,request.research.connectionId,request.research.query,signal):undefined
          :request.research?.kind==='snapshot'?request.research.value:undefined;
        if(request.research?.kind==='fetch'&&!request.ownerId)throw new ModelAccessError('SEARCH_OWNER_REQUIRED',400,'缺少搜索连接归属。');
        const context:RuntimeRequest=research?{...request,research:{kind:'snapshot',value:research}}:request;
        if(request.modelConnectionId){if(!request.ownerId)throw new ModelAccessError('MODEL_OWNER_REQUIRED',400,'缺少模型归属。');
          const connection=await connections.resolve(request.ownerId,request.modelConnectionId);
          custom=createEvaluator({...config,MODEL_MODE:'live'},connection,evaluator.storage);
          response=await custom.generate(context,AbortSignal.any([signal,AbortSignal.timeout(connection.timeoutMs)]));
        }else response=await evaluator.generate(context,signal);
        if(research)response={...response,research};
      }finally{if(custom)await custom.close();}
      await client.query('INSERT INTO agent_runtime.receipts (job_id,input_hash,response) VALUES ($1,$2,$3)', [request.jobId, digest, JSON.stringify(response)]);
      await client.query('COMMIT');
      return c.json(response);
    } catch(error) {
      await client.query('ROLLBACK');
      if(error instanceof ModelAccessError)return c.json({error:error.code,message:error.message},error.status===403?403:error.status===409?409:503);
      const providerStatus=z.object({statusCode:z.number()}).safeParse(error);if(providerStatus.success&&(providerStatus.data.statusCode===401||providerStatus.data.statusCode===403))return c.json({error:'MODEL_AUTH_FAILED'},503);if(providerStatus.success&&providerStatus.data.statusCode===429)return c.json({error:'MODEL_RATE_LIMITED'},503);
      return c.json({ error: 'GENERATION_FAILED' }, 503);
    } finally { client.release(); }
  });
  app.delete('/internal/v1/receipts/:id',async c=>{
    const parsed=z.uuid().safeParse(c.req.param('id'));if(!parsed.success)return c.json({error:'INVALID_ID'},400);
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[parsed.data]);
      await client.query('INSERT INTO agent_runtime.deleted_jobs(job_id) VALUES($1) ON CONFLICT DO NOTHING',[parsed.data]);
      await client.query('DELETE FROM agent_runtime.receipts WHERE job_id=$1',[parsed.data]);await client.query('COMMIT');return c.json({deleted:true});
    }catch{await client.query('ROLLBACK');return c.json({error:'DELETE_FAILED'},503);}finally{client.release();}
  });
  const server = new MastraServer({ app, mastra: evaluator.mastra, prefix: '/mastra' });
  await server.init();
  app.onError((error,c)=>{if(error instanceof ModelAccessError)return c.json({error:error.code,message:error.message},error.status===403?403:error.status===409?409:502);if(error instanceof z.ZodError)return c.json({error:'INVALID_REQUEST',message:'配置或请求字段无效。'},400);return c.json({error:'RUNTIME_ERROR',message:'模型服务暂时不可用，请稍后重试。'},503);});
  return { app, close: async () => {clearInterval(cleanup);await Promise.all([pool.end(),settingsPool.end(),evaluator.close()]);} };
}
