import { createCipheriv,createDecipheriv,createHash,createHmac,randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Pool } from 'pg';
import { z } from 'zod';
import { modelDraftSchema,modelAccessSchema,modelProfileSchema,saveModelSchema,type ModelDraft } from '../../../packages/contracts/src/models';
import type { AgentConfig } from '../../../packages/config/src/index';

export function modelFailure(error:unknown){
  const parsed=z.object({statusCode:z.number()}).safeParse(error);
  if(parsed.success&&(parsed.data.statusCode===401||parsed.data.statusCode===403))return{error:'MODEL_AUTH_FAILED',message:'模型鉴权失败，请检查 API Key 与模型权限。'};
  if(parsed.success&&parsed.data.statusCode===429)return{error:'MODEL_RATE_LIMITED',message:'模型服务请求过于频繁或额度不足，请稍后重试或检查供应商额度。'};
  return null;
}
export class ModelAccessError extends Error {
  constructor(readonly code:string,readonly status:number,message:string){super(message);}
}
export function defaultModelReference(config:AgentConfig){return createHmac('sha256',config.INTERNAL_SERVICE_TOKEN).update(JSON.stringify({mode:config.MODEL_MODE,model:config.LLM_MODEL,url:config.LLM_BASE_URL,key:config.LLM_API_KEY})).digest('hex');}
export function modelPolicy(config:AgentConfig){
  return{enabled:config.CUSTOM_MODELS==='on'||(config.CUSTOM_MODELS==='auto'&&config.NODE_ENV!=='production'),
    allowLocal:config.ALLOW_LOCAL_MODELS==='on'||(config.ALLOW_LOCAL_MODELS==='auto'&&config.NODE_ENV!=='production'),
    allowedHosts:config.MODEL_ALLOWED_HOSTS.split(',').map(host=>host.trim().toLowerCase()).filter(Boolean)};
}
function privateAddress(address:string){
  if(isIP(address)===6){const value=address.toLowerCase();return value==='::'||value==='::1'||value.startsWith('fc')||value.startsWith('fd')||value.startsWith('fe80:')||value.startsWith('::ffff:');}
  const bytes=address.split('.').map(Number);const first=bytes[0]??0,second=bytes[1]??0;
  return first===0||first===10||first===127||first===169&&second===254||first===172&&second>=16&&second<=31||first===192&&second===168||first===100&&second>=64&&second<=127||first>=224||first===198&&(second===18||second===19);
}
export async function validateModelUrl(raw:string,config:AgentConfig){
  const policy=modelPolicy(config);if(!policy.enabled)throw new ModelAccessError('CUSTOM_MODELS_DISABLED',403,'部署方已关闭自定义模型接入。');
  const url=new URL(raw);const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new ModelAccessError('INVALID_MODEL_URL',400,'模型地址格式无效。');
  if(config.NODE_ENV==='production'&&!policy.allowedHosts.includes(host))throw new ModelAccessError('MODEL_HOST_FORBIDDEN',403,'此模型域名不在部署方允许列表中。');
  if(!policy.allowLocal){
    if(url.protocol!=='https:')throw new ModelAccessError('MODEL_HTTPS_REQUIRED',403,'部署要求模型接口使用 HTTPS。');
    const addresses=await lookup(host,{all:true}).catch(()=>{throw new ModelAccessError('MODEL_DNS_FAILED',503,'无法解析模型服务域名，请检查地址。');});
    if(!addresses.length||addresses.some(entry=>privateAddress(entry.address)))throw new ModelAccessError('MODEL_PRIVATE_ADDRESS',403,'部署方未允许访问本地或私网模型。');
  }
}
export function modelFetch(config:AgentConfig):typeof fetch{return async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  await validateModelUrl(url,config);return fetch(input,{...init,redirect:'error'});
};}
const storedSchema=z.object({id:z.uuid(),owner:z.uuid(),base_url:z.string(),model:z.string(),encrypted_key:z.string(),has_key:z.boolean(),timeout_ms:z.number(),remember:z.boolean(),expires_at:z.date()});
export class ModelConnections {
  private readonly key:Buffer;
  constructor(readonly pool:Pool,readonly config:AgentConfig){this.key=createHash('sha256').update('interview-model-key-v1\0'+config.INTERNAL_SERVICE_TOKEN).digest();}
  private encrypt(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),value:ciphertext.toString('base64')});}
  private decrypt(raw:string){try{const data=z.object({iv:z.string(),tag:z.string(),value:z.string()}).parse(JSON.parse(raw));const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(data.iv,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data.value,'base64')),decipher.final()]).toString('utf8');}catch{throw new ModelAccessError('MODEL_KEY_UNAVAILABLE',409,'模型密钥无法恢复，请重新启用连接后重试。');}}
  async active(owner:string){const result=await this.pool.query('SELECT * FROM agent_runtime.model_connections WHERE owner=$1 AND active=true AND expires_at>now()',[owner]);return result.rows[0]?this.profile(storedSchema.parse(result.rows[0])):null;}
  private profile(row:z.infer<typeof storedSchema>){return modelProfileSchema.parse({id:row.id,baseUrl:row.base_url,model:row.model,hasKey:row.has_key,expiresAt:row.expires_at.toISOString(),remember:row.remember});}
  async save(owner:string,raw:unknown){
    const draft=saveModelSchema.parse(raw);await validateModelUrl(draft.baseUrl,this.config);
    const id=crypto.randomUUID();const expiresAt=new Date(Date.now()+(draft.remember?30:1)*86400000);
    const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`model-owner:${owner}`]);
      await client.query('UPDATE agent_runtime.model_connections SET active=false WHERE owner=$1',[owner]);
      await client.query('INSERT INTO agent_runtime.model_connections(id,owner,base_url,model,encrypted_key,timeout_ms,remember,expires_at,active,has_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)',[id,owner,draft.baseUrl,draft.model,this.encrypt(draft.apiKey),draft.timeoutMs,draft.remember,expiresAt,draft.apiKey.length>0]);
      await client.query('COMMIT');return modelProfileSchema.parse({id,baseUrl:draft.baseUrl,model:draft.model,hasKey:draft.apiKey.length>0,expiresAt:expiresAt.toISOString(),remember:draft.remember});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async describe(owner:string,id:string){if(!modelPolicy(this.config).enabled)throw new ModelAccessError('CUSTOM_MODELS_DISABLED',403,'部署方已关闭自定义模型接入。');const row=await this.row(owner,id);return this.profile(row);}
  private async row(owner:string,id:string){const result=await this.pool.query('SELECT * FROM agent_runtime.model_connections WHERE id=$1 AND owner=$2 AND expires_at>now()',[id,owner]);if(!result.rows[0])throw new ModelAccessError('MODEL_CONNECTION_EXPIRED',409,'模型连接已清除或过期，请重新启用后重试。');return storedSchema.parse(result.rows[0]);}
  async resolve(owner:string,id:string):Promise<ModelDraft>{if(!modelPolicy(this.config).enabled)throw new ModelAccessError('CUSTOM_MODELS_DISABLED',403,'自定义模型接入已关闭。');const row=await this.row(owner,id);await validateModelUrl(row.base_url,this.config);return{baseUrl:row.base_url,model:row.model,apiKey:this.decrypt(row.encrypted_key),timeoutMs:row.timeout_ms};}
  async clear(owner:string){await this.pool.query('DELETE FROM agent_runtime.model_connections WHERE owner=$1',[owner]);return{cleared:true};}
  async purge(){await this.pool.query('DELETE FROM agent_runtime.model_connections WHERE expires_at<now()');}
}
function providerFailure(status:number){if(status===401||status===403)return new ModelAccessError('MODEL_AUTH_FAILED',502,'模型服务拒绝认证，请检查密钥与模型权限。');if(status===429)return new ModelAccessError('MODEL_RATE_LIMITED',503,'模型服务限流，请稍后重试。');return new ModelAccessError('MODEL_UPSTREAM_FAILED',502,`模型服务返回 HTTP ${status}，请检查接口协议或稍后重试。`);}
async function modelRequest(path:string,draft:z.infer<typeof modelAccessSchema>,config:AgentConfig,body?:unknown){
  try{const response=await modelFetch(config)(`${draft.baseUrl}${path}`,{method:body?'POST':'GET',headers:{...(draft.apiKey?{authorization:`Bearer ${draft.apiKey}`}:{ }),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.min(draft.timeoutMs,20000))});
    if(!response.ok)throw providerFailure(response.status);const text=await response.text();if(text.length>1048576)throw new ModelAccessError('MODEL_RESPONSE_TOO_LARGE',502,'模型服务返回内容过大。');return JSON.parse(text);
  }catch(error){if(error instanceof ModelAccessError)throw error;throw new ModelAccessError('MODEL_CONNECTION_FAILED',502,'模型连接失败或响应无效，请检查服务地址、网络与超时。');}
}
export async function listModels(raw:unknown,config:AgentConfig){const draft=modelAccessSchema.parse(raw);const parsed=z.object({data:z.array(z.object({id:z.string().min(1).max(200)})).max(10000)}).safeParse(await modelRequest('/models',draft,config));if(!parsed.success)throw new ModelAccessError('MODEL_INVALID_RESPONSE',502,'模型列表响应格式无效，仍可手动填写模型名。');return{models:[...new Set(parsed.data.data.map(model=>model.id).filter(id=>!draft.apiKey||!id.includes(draft.apiKey)))].slice(0,500)};}
export async function probeModel(raw:unknown,config:AgentConfig){const draft=modelDraftSchema.parse(raw);const started=Date.now();const result=z.object({choices:z.array(z.object({message:z.object({content:z.string().min(1)})})).min(1)}).safeParse(await modelRequest('/chat/completions',draft,config,{model:draft.model,messages:[{role:'user',content:'Reply only OK.'}],max_tokens:16}));if(!result.success)throw new ModelAccessError('MODEL_INVALID_RESPONSE',502,'模型没有返回有效的 Chat Completions 内容。');return{ok:true satisfies true,latencyMs:Date.now()-started,message:'连接成功。此测试未验证面试评分质量。'};}
