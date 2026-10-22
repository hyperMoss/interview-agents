import { z } from 'zod';
import { errorSchema, sessionSchema, sessionListSchema, type InterviewInput } from '../../../packages/contracts/src/index';
import { modelSettingsSchema,modelProfileSchema,modelListSchema,modelProbeSchema,type ModelDraft,saveModelSchema,modelAccessSchema,defaultModeSchema } from '../../../packages/contracts/src/models';
import { planningOptionsSchema,planSchema,replanSchema } from '../../../packages/contracts/src/planning';
import { bankListSchema,bankQuestionSchema,bankDraftSchema,bankImportResultSchema } from '../../../packages/contracts/src/bank';
import { searchSettingsSchema,searchProfileSchema,searchDraftSchema,searchChoiceSchema,searchProbeResultSchema } from '../../../packages/contracts/src/search';
import { preparationRequestSchema, preparationResultSchema, savePreparationSchema, savedPreparationSchema } from '../../../packages/contracts/src/preparation';
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers: { ...(init?.body instanceof FormData?{}:{'content-type': 'application/json'}), ...init?.headers } });
  const body: unknown = await response.json().catch(()=>null);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new Error(error.success ? error.data.message : '连接暂时不可用，请稍后重试。');
  }
  return schema.parse(body);
}
export const api = {
  identity:()=>request('/identity',z.object({ready:z.literal(true)})),
  prepare:(body:z.infer<typeof preparationRequestSchema>)=>request('/preparations/generate',preparationResultSchema,{method:'POST',body:JSON.stringify(body)}),
  savePreparation:(body:z.infer<typeof savePreparationSchema>)=>request('/question-bank/import/preparation',savedPreparationSchema,{method:'POST',body:JSON.stringify(body)}),
  list: () => request('/interviews', sessionListSchema),
  get: (id: string) => request(`/interviews/${id}`, sessionSchema),
  create: (input: InterviewInput,modelConnectionId:string|null=null,search:z.infer<typeof searchChoiceSchema>={kind:'off'}) => request('/interviews', sessionSchema, { method: 'POST', body: JSON.stringify({input,modelConnectionId,search}) }),
  answer: (id: string, input: { answer: string; revision: number; requestId: string }) => request(`/interviews/${id}/answers`, sessionSchema, { method: 'POST', body: JSON.stringify(input) }),
  cancel: (id: string) => request(`/interviews/${id}/cancel`, sessionSchema, { method: 'POST', body: '{}' }),
  remove: (id: string) => request(`/interviews/${id}`, z.object({ deleted: z.boolean() }), { method: 'DELETE' }),
  capabilities: () => request('/capabilities', z.object({ installed: z.array(z.string()), modelMode:defaultModeSchema })),
  retry:(id:string,input:{requestId:string;revision:number;modelConnectionId?:string|null;searchConnectionId?:string|null})=>request(`/interviews/${id}/retry`,sessionSchema,{method:'POST',body:JSON.stringify(input)}),
  modelSettings:()=>request('/models/settings',modelSettingsSchema),
  saveModel:(draft:z.infer<typeof saveModelSchema>)=>request('/models/settings',modelProfileSchema,{method:'POST',body:JSON.stringify(draft)}),
  clearModel:()=>request('/models/settings',z.object({cleared:z.boolean()}),{method:'DELETE'}),
  modelList:(draft:z.infer<typeof modelAccessSchema>)=>request('/models/list',modelListSchema,{method:'POST',body:JSON.stringify(draft)}),
  modelProbe:(draft:ModelDraft)=>request('/models/probe',modelProbeSchema,{method:'POST',body:JSON.stringify(draft)}),
  previewPlan:(options:z.infer<typeof planningOptionsSchema>)=>request('/interviews/plan',planSchema,{method:'POST',body:JSON.stringify({options})}),
  replan:(id:string,input:z.infer<typeof replanSchema>)=>request(`/interviews/${id}/replan`,sessionSchema,{method:'POST',body:JSON.stringify(input)}),
  importResume:(file:File)=>{const body=new FormData();body.set('file',file);return request('/resumes/import',z.object({filename:z.string(),text:z.string(),warnings:z.array(z.string())}),{method:'POST',body});},
  bankList:()=>request('/question-bank',bankListSchema),
  bankCreate:(requestId:string,draft:z.infer<typeof bankDraftSchema>)=>request('/question-bank',bankQuestionSchema,{method:'POST',body:JSON.stringify({requestId,draft})}),
  bankUpdate:(id:string,revision:number,draft:z.infer<typeof bankDraftSchema>)=>request(`/question-bank/${id}`,bankQuestionSchema,{method:'PATCH',body:JSON.stringify({revision,draft})}),
  bankRemove:(id:string)=>request(`/question-bank/${id}`,z.object({deleted:z.literal(true)}),{method:'DELETE'}),
  importLeetCode:(url:string)=>request('/question-bank/import/leetcode',bankImportResultSchema,{method:'POST',body:JSON.stringify({url})}),
  importBankJson:(body:unknown)=>request('/question-bank/import/json',bankImportResultSchema,{method:'POST',body:JSON.stringify(body)}),
  searchSettings:()=>request('/search/settings',searchSettingsSchema),
  saveSearch:(draft:z.infer<typeof searchDraftSchema>)=>request('/search/settings',searchProfileSchema,{method:'POST',body:JSON.stringify(draft)}),
  clearSearch:()=>request('/search/settings',z.object({cleared:z.literal(true)}),{method:'DELETE'}),
  probeSearch:(draft:z.infer<typeof searchDraftSchema>,query:string)=>request('/search/probe',searchProbeResultSchema,{method:'POST',body:JSON.stringify({draft,query})}),
};
