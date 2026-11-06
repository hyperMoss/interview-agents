import { bossAutomationModeSchema } from '../../contracts/src/career';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defaultModeSchema } from '../../contracts/src/models';
export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(4111),
  WEB_ORIGIN: z.url().default('http://localhost:5173'), DATABASE_URL: z.string().startsWith('file:').default('file:.local/app.sqlite'), AGENT_DATABASE_URL: z.string().startsWith('file:').default('file:.local/agent.sqlite'),
  REDIS_URL: z.string().default(''), AGENT_URL: z.url(), INTERNAL_SERVICE_TOKEN: z.string().min(32), COOKIE_SECRET: z.string().min(32),
  MODEL_MODE: defaultModeSchema.default('demo'), LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.string().default(''), LLM_API_KEY: z.string().default(''),
  CUSTOM_MODELS:z.enum(['auto','on','off']).default('auto'),MODEL_ALLOWED_HOSTS:z.string().default(''),ALLOW_LOCAL_MODELS:z.enum(['auto','on','off']).default('auto'),
  SEARCH_ACCESS:z.enum(['auto','on','off']).default('auto'),SEARCH_ALLOWED_HOSTS:z.string().default(''),ALLOW_LOCAL_SEARCH:z.enum(['auto','on','off']).default('auto'),
  CAREER_LOCAL_DATA_DIR:z.string().optional(),
  BOSS_AUTOMATION:bossAutomationModeSchema.default('enabled'),
  BOSS_BROWSER_ENGINE:z.enum(['patchright','moli','playwright']).default('patchright'),
  BOSS_MOLI_EXECUTABLE:z.string().default('moli'),
  BOSS_SITE_ORIGIN:z.url().default('https://www.zhipin.com'),
  BOSS_HEADED_FALLBACK:z.enum(['on','off']).default('on'),
});
export const configSchema=baseConfigSchema.superRefine((value, ctx) => {
  if (value.MODEL_MODE === 'live' && (!value.LLM_MODEL || !value.LLM_API_KEY)) ctx.addIssue({code:'custom',message:'Live mode requires LLM_MODEL and LLM_API_KEY'});
  if(value.MODEL_MODE==='live'&&!value.LLM_MODEL.includes('/'))ctx.addIssue({code:'custom',message:'LLM_MODEL must be provider/model'});
  if (value.LLM_BASE_URL && !z.url().safeParse(value.LLM_BASE_URL).success) ctx.addIssue({code:'custom',message:'Invalid LLM_BASE_URL'});
  if (value.NODE_ENV === 'production') {
    if (value.MODEL_MODE === 'demo') ctx.addIssue({code:'custom',message:'Production cannot use demo model'});
    if (!value.WEB_ORIGIN.startsWith('https://')) ctx.addIssue({code:'custom',message:'Production requires HTTPS origin'});
    if (value.COOKIE_SECRET.startsWith('local-only') || value.INTERNAL_SERVICE_TOKEN.startsWith('local-only')) ctx.addIssue({code:'custom',message:'Replace local development secrets'});
  }
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
  return parsed.data;
}
export type Config = z.infer<typeof configSchema>;
const apiSchema=baseConfigSchema.pick({NODE_ENV:true,API_PORT:true,WEB_ORIGIN:true,DATABASE_URL:true,REDIS_URL:true,AGENT_URL:true,INTERNAL_SERVICE_TOKEN:true,COOKIE_SECRET:true,MODEL_MODE:true,CAREER_LOCAL_DATA_DIR:true,BOSS_SITE_ORIGIN:true,BOSS_AUTOMATION:true,BOSS_BROWSER_ENGINE:true}).superRefine((value,ctx)=>{
  if(value.NODE_ENV==='production'){
    if(value.MODEL_MODE==='demo'||!value.WEB_ORIGIN.startsWith('https://')||value.COOKIE_SECRET.startsWith('local-only')||value.INTERNAL_SERVICE_TOKEN.startsWith('local-only'))ctx.addIssue({code:'custom',message:'Invalid production API configuration'});
    if(!value.BOSS_SITE_ORIGIN.startsWith('https://'))ctx.addIssue({code:'custom',message:'Production career origin must use HTTPS'});
  }
  if(value.CAREER_LOCAL_DATA_DIR&&!value.CAREER_LOCAL_DATA_DIR.startsWith('/'))ctx.addIssue({code:'custom',message:'CAREER_LOCAL_DATA_DIR must be absolute'});
});
const workerSchema=baseConfigSchema.pick({NODE_ENV:true,DATABASE_URL:true,REDIS_URL:true,AGENT_URL:true,INTERNAL_SERVICE_TOKEN:true,CAREER_LOCAL_DATA_DIR:true,BOSS_AUTOMATION:true,BOSS_BROWSER_ENGINE:true,BOSS_MOLI_EXECUTABLE:true,BOSS_SITE_ORIGIN:true,BOSS_HEADED_FALLBACK:true}).superRefine((value,ctx)=>{
  if(value.NODE_ENV==='production'&&value.INTERNAL_SERVICE_TOKEN.startsWith('local-only'))ctx.addIssue({code:'custom',message:'Replace local Worker token'});
  if(value.NODE_ENV==='production'&&!value.BOSS_SITE_ORIGIN.startsWith('https://'))ctx.addIssue({code:'custom',message:'Production career origin must use HTTPS'});
  if(value.CAREER_LOCAL_DATA_DIR&&!value.CAREER_LOCAL_DATA_DIR.startsWith('/'))ctx.addIssue({code:'custom',message:'CAREER_LOCAL_DATA_DIR must be absolute'});
});
const agentSchema=baseConfigSchema.pick({NODE_ENV:true,AGENT_PORT:true,AGENT_DATABASE_URL:true,INTERNAL_SERVICE_TOKEN:true,MODEL_MODE:true,LLM_MODEL:true,LLM_BASE_URL:true,LLM_API_KEY:true,CUSTOM_MODELS:true,MODEL_ALLOWED_HOSTS:true,ALLOW_LOCAL_MODELS:true,SEARCH_ACCESS:true,SEARCH_ALLOWED_HOSTS:true,ALLOW_LOCAL_SEARCH:true}).superRefine((value,ctx)=>{
  if(value.MODEL_MODE==='live'&&(!value.LLM_API_KEY||!value.LLM_MODEL.includes('/')))ctx.addIssue({code:'custom',message:'Live Agent requires provider/model and key'});
  if(value.LLM_BASE_URL&&!z.url().safeParse(value.LLM_BASE_URL).success)ctx.addIssue({code:'custom',message:'Invalid LLM_BASE_URL'});
  if(value.NODE_ENV==='production'&&(value.MODEL_MODE==='demo'||value.INTERNAL_SERVICE_TOKEN.startsWith('local-only')))ctx.addIssue({code:'custom',message:'Invalid production Agent configuration'});
});
function parseConfig<T>(schema:z.ZodType<T>,env:NodeJS.ProcessEnv):T{if(env.DATABASE_URL?.startsWith('file:')&&env.AGENT_DATABASE_URL?.startsWith('file:')){const local=(url:string)=>url.startsWith('file:/')?fileURLToPath(url):resolve(url.slice(5));if(local(env.DATABASE_URL)===local(env.AGENT_DATABASE_URL))throw new Error('CONFIG_INVALID: SQLite business and Agent files must differ');}const result=schema.safeParse(env);if(!result.success)throw new Error(`CONFIG_INVALID: ${result.error.issues.map(issue=>issue.message).join('; ')}`);return result.data;}
export const readApiConfig=(env=process.env)=>parseConfig(apiSchema,env);
export const readWorkerConfig=(env=process.env)=>parseConfig(workerSchema,env);
export const readAgentConfig=(env=process.env)=>parseConfig(agentSchema,env);
export type ApiConfig=z.infer<typeof apiSchema>;
export type WorkerConfig=z.infer<typeof workerSchema>;
export type AgentConfig=z.infer<typeof agentSchema>;
