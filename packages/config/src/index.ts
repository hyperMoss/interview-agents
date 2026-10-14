import { z } from 'zod';
import { defaultModeSchema } from '../../contracts/src/models';
export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(4111),
  WEB_ORIGIN: z.url().default('http://localhost:5173'), DATABASE_URL: z.url(), AGENT_DATABASE_URL: z.url(),
  REDIS_URL: z.url(), AGENT_URL: z.url(), INTERNAL_SERVICE_TOKEN: z.string().min(32), COOKIE_SECRET: z.string().min(32),
  MODEL_MODE: defaultModeSchema.default('demo'), LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.string().default(''), LLM_API_KEY: z.string().default(''),
  CUSTOM_MODELS:z.enum(['auto','on','off']).default('auto'),MODEL_ALLOWED_HOSTS:z.string().default(''),ALLOW_LOCAL_MODELS:z.enum(['auto','on','off']).default('auto'),
  SEARCH_ACCESS:z.enum(['auto','on','off']).default('auto'),SEARCH_ALLOWED_HOSTS:z.string().default(''),ALLOW_LOCAL_SEARCH:z.enum(['auto','on','off']).default('auto'),
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
const apiSchema=baseConfigSchema.pick({NODE_ENV:true,API_PORT:true,WEB_ORIGIN:true,DATABASE_URL:true,REDIS_URL:true,AGENT_URL:true,INTERNAL_SERVICE_TOKEN:true,COOKIE_SECRET:true,MODEL_MODE:true}).superRefine((value,ctx)=>{
  if(value.NODE_ENV==='production'){
    if(value.MODEL_MODE==='demo'||!value.WEB_ORIGIN.startsWith('https://')||value.COOKIE_SECRET.startsWith('local-only')||value.INTERNAL_SERVICE_TOKEN.startsWith('local-only'))ctx.addIssue({code:'custom',message:'Invalid production API configuration'});
  }
});
const workerSchema=baseConfigSchema.pick({NODE_ENV:true,DATABASE_URL:true,REDIS_URL:true,AGENT_URL:true,INTERNAL_SERVICE_TOKEN:true}).superRefine((value,ctx)=>{if(value.NODE_ENV==='production'&&value.INTERNAL_SERVICE_TOKEN.startsWith('local-only'))ctx.addIssue({code:'custom',message:'Replace local Worker token'});});
const agentSchema=baseConfigSchema.pick({NODE_ENV:true,AGENT_PORT:true,AGENT_DATABASE_URL:true,INTERNAL_SERVICE_TOKEN:true,MODEL_MODE:true,LLM_MODEL:true,LLM_BASE_URL:true,LLM_API_KEY:true,CUSTOM_MODELS:true,MODEL_ALLOWED_HOSTS:true,ALLOW_LOCAL_MODELS:true,SEARCH_ACCESS:true,SEARCH_ALLOWED_HOSTS:true,ALLOW_LOCAL_SEARCH:true}).superRefine((value,ctx)=>{
  if(value.MODEL_MODE==='live'&&(!value.LLM_API_KEY||!value.LLM_MODEL.includes('/')))ctx.addIssue({code:'custom',message:'Live Agent requires provider/model and key'});
  if(value.LLM_BASE_URL&&!z.url().safeParse(value.LLM_BASE_URL).success)ctx.addIssue({code:'custom',message:'Invalid LLM_BASE_URL'});
  if(value.NODE_ENV==='production'&&(value.MODEL_MODE==='demo'||value.INTERNAL_SERVICE_TOKEN.startsWith('local-only')))ctx.addIssue({code:'custom',message:'Invalid production Agent configuration'});
});
function parseConfig<T>(schema:z.ZodType<T>,env:NodeJS.ProcessEnv):T{const result=schema.safeParse(env);if(!result.success)throw new Error(`CONFIG_INVALID: ${result.error.issues.map(issue=>issue.message).join('; ')}`);return result.data;}
export const readApiConfig=(env=process.env)=>parseConfig(apiSchema,env);
export const readWorkerConfig=(env=process.env)=>parseConfig(workerSchema,env);
export const readAgentConfig=(env=process.env)=>parseConfig(agentSchema,env);
export type ApiConfig=z.infer<typeof apiSchema>;
export type WorkerConfig=z.infer<typeof workerSchema>;
export type AgentConfig=z.infer<typeof agentSchema>;
