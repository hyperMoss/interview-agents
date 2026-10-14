import type { Pool } from 'pg';
import { z } from 'zod';
import type { AgentConfig } from '../../../packages/config/src/index';
import { searchDraftSchema,searchProfileSchema,searchProviderSchema,searchSourceSchema,searchSnapshotSchema,type SearchDraft } from '../../../packages/contracts/src/search';
import { validateModelUrl,ModelAccessError } from './models';
import { ConnectionCipher } from './connection-cipher';

const rowSchema=z.object({id:z.uuid(),owner:z.uuid(),provider:searchProviderSchema,base_url:z.string(),encrypted_key:z.string(),expires_at:z.date(),remember:z.boolean()});
export function searchPolicy(config:AgentConfig){return{enabled:config.SEARCH_ACCESS==='on'||config.SEARCH_ACCESS==='auto'&&config.NODE_ENV!=='production',allowLocal:config.ALLOW_LOCAL_SEARCH==='on'||config.ALLOW_LOCAL_SEARCH==='auto'&&config.NODE_ENV!=='production'};}
async function validateSearchUrl(url:string,config:AgentConfig){
  if(!searchPolicy(config).enabled)throw new ModelAccessError('SEARCH_DISABLED',403,'部署方已关闭自定义联网搜索。');
  try{await validateModelUrl(url,{...config,CUSTOM_MODELS:config.SEARCH_ACCESS,MODEL_ALLOWED_HOSTS:config.SEARCH_ALLOWED_HOSTS,ALLOW_LOCAL_MODELS:config.ALLOW_LOCAL_SEARCH});}
  catch{throw new ModelAccessError('SEARCH_ADDRESS_FORBIDDEN',403,'搜索地址不满足部署方的主机、HTTPS 或本地访问规则。');}
}
export class SearchConnections {
  private readonly cipher:ConnectionCipher;
  constructor(readonly pool:Pool,readonly config:AgentConfig){this.cipher=new ConnectionCipher(config.INTERNAL_SERVICE_TOKEN,'interview-search-key-v1');}
  private profile(raw:unknown){const row=rowSchema.parse(raw);return searchProfileSchema.parse({id:row.id,provider:row.provider,baseUrl:row.base_url,hasKey:true,expiresAt:row.expires_at.toISOString(),remember:row.remember});}
  async settings(owner:string){const policy=searchPolicy(this.config);const result=policy.enabled?await this.pool.query('SELECT * FROM agent_runtime.search_connections WHERE owner=$1 AND active=true AND expires_at>now()',[owner]):null;return{...policy,active:result?.rows[0]?this.profile(result.rows[0]):null};}
  async describe(owner:string,id:string){return this.profile(await this.row(owner,id));}
  private async row(owner:string,id:string){if(!searchPolicy(this.config).enabled)throw new ModelAccessError('SEARCH_DISABLED',403,'联网搜索接入已关闭。');const result=await this.pool.query('SELECT * FROM agent_runtime.search_connections WHERE id=$1 AND owner=$2 AND expires_at>now()',[id,owner]);if(!result.rows[0])throw new ModelAccessError('SEARCH_CONNECTION_EXPIRED',409,'搜索连接已清除或过期，请重新启用或明确关闭搜索后重试。');return rowSchema.parse(result.rows[0]);}
  async save(owner:string,raw:unknown){const draft=searchDraftSchema.parse(raw);await validateSearchUrl(draft.baseUrl,this.config);const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+(draft.remember?30:1)*86400000);const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`search-owner:${owner}`]);await client.query('UPDATE agent_runtime.search_connections SET active=false WHERE owner=$1',[owner]);const result=await client.query('INSERT INTO agent_runtime.search_connections(id,owner,provider,base_url,encrypted_key,expires_at,remember) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,owner,draft.provider,draft.baseUrl,this.cipher.encrypt(draft.apiKey),expiresAt,draft.remember]);await client.query('COMMIT');return this.profile(result.rows[0]);}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async clear(owner:string){await this.pool.query('DELETE FROM agent_runtime.search_connections WHERE owner=$1',[owner]);return{cleared:true};}
  async purge(){await this.pool.query('DELETE FROM agent_runtime.search_connections WHERE expires_at<now()');}
  async search(owner:string,id:string,query:string,signal:AbortSignal){const row=await this.row(owner,id);let apiKey:string;try{apiKey=this.cipher.decrypt(row.encrypted_key);}catch{throw new ModelAccessError('SEARCH_KEY_UNAVAILABLE',409,'搜索密钥无法恢复，请重新启用连接。');}const sources=await searchProvider({provider:row.provider,baseUrl:row.base_url,apiKey,remember:row.remember},query,this.config,signal);return searchSnapshotSchema.parse({connectionId:id,query,fetchedAt:new Date().toISOString(),sources});}
}
export async function searchProvider(draft:SearchDraft,query:string,config:AgentConfig,signal:AbortSignal=AbortSignal.timeout(10000)){
  const parsed=z.string().trim().min(2).max(200).parse(query);if(parsed.includes(draft.apiKey))throw new ModelAccessError('SEARCH_QUERY_INVALID',400,'查询不能包含密钥。');await validateSearchUrl(draft.baseUrl,config);
  try{const response=await fetch(`${draft.baseUrl}/search`,{method:'POST',headers:{authorization:`Bearer ${draft.apiKey}`,'content-type':'application/json'},body:JSON.stringify(draft.provider==='tavily'?{query:parsed,max_results:5,search_depth:'basic',include_answer:false,include_raw_content:false}:{query:parsed,limit:5,sources:['web']}),signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),redirect:'error'});
    if(!response.ok)throw new ModelAccessError('SEARCH_UPSTREAM_FAILED',502,response.status===401||response.status===403?'搜索服务拒绝认证，请检查密钥和权限。':'搜索服务不可用或限流，请稍后重试。');
    const text=await response.text();if(text.length>1048576)throw new Error('large response');const raw:unknown=JSON.parse(text);
    const rows=draft.provider==='tavily'?z.object({results:z.array(z.object({title:z.string(),url:z.string(),content:z.string()})).max(100)}).parse(raw).results.map(row=>({...row,snippet:row.content})):z.object({success:z.literal(true),data:z.object({web:z.array(z.object({title:z.string(),url:z.string(),description:z.string().default('')})).max(100)})}).parse(raw).data.web.map(row=>({...row,snippet:row.description}));
    return rows.slice(0,5).flatMap(row=>{if(row.url.includes(draft.apiKey))return[];const clean=(s:string,max:number)=>s.split(draft.apiKey).join('[已隐藏]').slice(0,max);const parsed=searchSourceSchema.safeParse({title:clean(row.title,200),url:row.url,snippet:clean(row.snippet,1200)});return parsed.success?[parsed.data]:[];});
  }catch(error){if(error instanceof ModelAccessError)throw error;throw new ModelAccessError('SEARCH_UPSTREAM_FAILED',502,'搜索连接失败、超时或响应无效。可以重试或明确关闭本场搜索。');}
}
