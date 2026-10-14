import { z } from 'zod';
export const endpointSchema=z.string().trim().min(1).max(2048).transform((raw,ctx)=>{
  try{const url=new URL(raw);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error();
    url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');return url.toString().replace(/\/$/,'');
  }catch{ctx.addIssue({code:'custom',message:'填写有效的 http/https API 根地址，不含账号、查询参数或片段。'});return z.NEVER;}
});
export const modelAccessSchema=z.strictObject({baseUrl:endpointSchema,apiKey:z.string().trim().max(4096),timeoutMs:z.number().int().min(5000).max(60000).default(45000)}).superRefine((value,ctx)=>{if(value.apiKey&&value.baseUrl.includes(value.apiKey))ctx.addIssue({code:'custom',message:'API Key 请填写在密钥栏，不要放入地址。'});});
export const modelDraftSchema=modelAccessSchema.safeExtend({model:z.string().trim().min(1).max(200)}).superRefine((value,ctx)=>{if(value.apiKey&&value.model.includes(value.apiKey))ctx.addIssue({code:'custom',message:'模型名不能包含 API Key。'});});
export const saveModelSchema=modelDraftSchema.safeExtend({remember:z.boolean().default(false)});
export type ModelDraft=z.infer<typeof modelDraftSchema>;
export const modelProfileSchema=z.strictObject({id:z.uuid(),baseUrl:z.string(),model:z.string(),hasKey:z.boolean(),expiresAt:z.iso.datetime(),remember:z.boolean()});
export type ModelProfile=z.infer<typeof modelProfileSchema>;
export const modelSourceSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('default'),model:z.string().optional(),reference:z.string().regex(/^[0-9a-f]{64}$/).optional()}),
  z.strictObject({kind:z.literal('custom'),connectionId:z.uuid(),model:z.string(),baseUrl:z.string()}),
]);
export type ModelSource=z.infer<typeof modelSourceSchema>;
export const defaultModeSchema=z.enum(['demo','live','disabled']);
export const modelSettingsSchema=z.strictObject({enabled:z.boolean(),allowLocal:z.boolean(),mode:defaultModeSchema,defaultModel:z.string(),defaultReference:z.string().regex(/^[0-9a-f]{64}$/),active:modelProfileSchema.nullable()});
export const modelListSchema=z.strictObject({models:z.array(z.string()).max(500)});
export const modelProbeSchema=z.strictObject({ok:z.literal(true),latencyMs:z.number().nonnegative(),message:z.string()});
