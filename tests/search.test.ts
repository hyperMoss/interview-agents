import { describe,it,expect,beforeAll,afterAll,afterEach } from 'vitest';
import { Pool } from 'pg';
import { SearchConnections,searchProvider,searchPolicy } from '../apps/agent/src/search';
import { agentConfig } from './fixtures';
import { serveFixture } from './provider-fixture';
import type { SearchDraft } from '../packages/contracts/src/search';
describe('search deployment policy',()=>{it('production defaults close access',()=>{expect(searchPolicy({...agentConfig(),NODE_ENV:'production'}).enabled).toBe(false);});});
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('encrypted search connections and real HTTP protocol',()=>{
  let pool:Pool,store:SearchConnections,fixture:Awaited<ReturnType<typeof serveFixture>>;
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),key='fixture-search-private-key';const received:Array<{query:string;authorization:string|null}>=[];
  let failure=false;
  beforeAll(async()=>{
    pool=new Pool({connectionString:'postgresql://agent:local-agent-password@127.0.0.1:55440/interview_test'});store=new SearchConnections(pool,agentConfig());
    fixture=await serveFixture(async request=>{const body=await request.json();received.push({query:body.query,authorization:request.headers.get('authorization')});if(failure)return Response.json({error:'fixture unavailable'},{status:503});if(body.max_results)return Response.json({results:[{title:'接口设计资料',url:'https://example.test/guide',content:`岗位研究资料。${key}`}]});return Response.json({success:true,data:{web:[{title:'系统资料',url:'https://example.test/system',description:'公开系统设计资料。'}]}});});
  });
  afterEach(async()=>{failure=false;await store.clear(owner);await store.clear(other);});
  afterAll(async()=>{await pool.end();await fixture.close();});
  const draft=(provider:'tavily'|'firecrawl'='tavily'):SearchDraft=>({provider,baseUrl:fixture.origin,apiKey:key,remember:false});
  it('save exposes metadata only and owner IDs cannot cross connections',async()=>{const profile=await store.save(owner,draft());expect(JSON.stringify(profile)).not.toContain(key);const result=await pool.query('SELECT encrypted_key FROM agent_runtime.search_connections WHERE id=$1',[profile.id]);expect(result.rows[0].encrypted_key).not.toContain(key);await expect(store.describe(other,profile.id)).rejects.toThrow('过期');});
  it('queries only the supplied keywords and uses the selected bearer credential',async()=>{const profile=await store.save(owner,draft());const snapshot=await store.search(owner,profile.id,'后端岗位公开资料',AbortSignal.timeout(2000));expect(received.at(-1)).toEqual({query:'后端岗位公开资料',authorization:`Bearer ${key}`});expect(snapshot.sources[0]?.url).toBe('https://example.test/guide');expect(JSON.stringify(snapshot)).not.toContain(key);});
  it('supports the Firecrawl v2 response contract',async()=>{const sources=await searchProvider(draft('firecrawl'),'后端系统设计',agentConfig());expect(sources[0]?.title).toBe('系统资料');});
  it('changing active settings preserves the old immutable connection',async()=>{const a=await store.save(owner,draft());const b=await store.save(owner,draft('firecrawl'));expect((await store.settings(owner)).active?.id).toBe(b.id);expect((await store.search(owner,a.id,'后端岗位',AbortSignal.timeout(2000))).sources[0]?.title).toBe('接口设计资料');});
  it('clear and expiry reject old IDs without a silent search fallback',async()=>{const profile=await store.save(owner,draft());await pool.query("UPDATE agent_runtime.search_connections SET expires_at=now()-interval '1 second' WHERE id=$1",[profile.id]);await expect(store.describe(owner,profile.id)).rejects.toThrow('过期');await store.clear(owner);expect((await store.settings(owner)).active).toBeNull();});
  it('upstream failure is visible and never substitutes generated search sources',async()=>{const profile=await store.save(owner,draft());failure=true;await expect(store.search(owner,profile.id,'岗位资料',AbortSignal.timeout(2000))).rejects.toThrow('不可用');});
  it('business database role cannot read search credentials',async()=>{const app=new Pool({connectionString:'postgresql://app:local-app-password@127.0.0.1:55440/interview_test'});try{await expect(app.query('SELECT encrypted_key FROM agent_runtime.search_connections')).rejects.toThrow('permission denied');}finally{await app.end();}});
});
