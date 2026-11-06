import { z } from 'zod';
import { resumeDraftSchema, resumeDraftSummarySchema, type ResumeDocument } from '../../../packages/contracts/src/resume-document';
import { errorSchema, sessionSchema, sessionListSchema, type InterviewInput } from '../../../packages/contracts/src/index';
import { modelSettingsSchema,modelProfileSchema,modelListSchema,modelProbeSchema,type ModelDraft,saveModelSchema,modelAccessSchema,defaultModeSchema } from '../../../packages/contracts/src/models';
import { planningOptionsSchema,planSchema,replanSchema } from '../../../packages/contracts/src/planning';
import { bankListSchema,bankQuestionSchema,bankDraftSchema,bankImportResultSchema } from '../../../packages/contracts/src/bank';
import { searchSettingsSchema,searchProfileSchema,searchDraftSchema,searchChoiceSchema,searchProbeResultSchema } from '../../../packages/contracts/src/search';
import { preparationRequestSchema, preparationResultSchema, savePreparationSchema, savedPreparationSchema } from '../../../packages/contracts/src/preparation';
import { interviewHistoryPageSchema, type InterviewHistoryQuery } from '../../../packages/contracts/src/history';
import {
  bossSessionViewSchema, careerApprovalSchema, careerItemReconcileSchema, careerItemResumeAttachmentSchema, careerItemRetrySchema,
  careerBatchViewSchema, careerCancelSchema, careerDeleteTaskSchema, careerPostingPatchSchema, careerResumeCommandSchema,
  careerContactRetrySchema, careerContactApprovalSchema, careerContactApprovalViewSchema, careerContactViewSchema, careerBindResumeSchema, careerRetryGenerationSchema, careerTaskCreateSchema, careerTaskPostingViewSchema, careerTaskViewSchema, resumeUploadSchema,
  resumeVersionListSchema, resumeVersionSaveSchema, resumeVersionSchema,
} from '../../../packages/contracts/src/career';
import { careerPreparationViewSchema, careerSaveToBankSchema, personalizedPreparationPatchSchema } from '../../../packages/contracts/src/preparation';
import type { CareerPreparationView } from '../../../packages/contracts/src/preparation';
export type { CareerPreparationView };

/** HTTP failure carrying the status code so the UI can distinguish 409 conflicts from other errors. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}
async function failure(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  const error = errorSchema.safeParse(body);
  return new ApiError(error.success ? error.data.message : '连接暂时不可用，请稍后重试。', response.status, error.success ? error.data.code : undefined);
}
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers: { ...(init?.body instanceof FormData?{}:{'content-type': 'application/json'}), ...init?.headers } });
  const body: unknown = await response.json().catch(()=>null);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new ApiError(error.success ? error.data.message : '连接暂时不可用，请稍后重试。', response.status, error.success ? error.data.code : undefined);
  }
  return schema.parse(body);
}
function attachmentName(header: string | null) {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (utf8) return decodeURIComponent(utf8);
  return /filename="?([^";]+)"?/i.exec(header ?? '')?.[1] ?? 'download';
}
async function download(path: string, fallback: string) {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!response.ok) throw await failure(response);
  return { filename: attachmentName(response.headers.get('content-disposition')) || fallback, body: await response.blob() };
}

// The career preparation view is assembled by the API from the shared personalized schema; parse it once here.
const sessionCommandSchema = z.strictObject({ workId: z.uuid(), session: bossSessionViewSchema });
const workOnlySchema = z.strictObject({ workId: z.uuid() });
const resumeDeleteResultSchema = z.strictObject({ deleted: z.literal(true), cancelledTaskIds: z.array(z.uuid()), pendingCleanup: z.boolean() });

export const api = {
  identity:()=>request('/identity',z.object({ready:z.literal(true)})),
  prepare:(body:z.infer<typeof preparationRequestSchema>)=>request('/preparations/generate',preparationResultSchema,{method:'POST',body:JSON.stringify(body)}),
  savePreparation:(body:z.infer<typeof savePreparationSchema>)=>request('/question-bank/import/preparation',savedPreparationSchema,{method:'POST',body:JSON.stringify(body)}),
  list: () => request('/interviews', sessionListSchema),
  history: (input: Partial<InterviewHistoryQuery> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value));
    return request(`/interviews/history?${query}`, interviewHistoryPageSchema);
  },
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
  resumeDrafts: () => request('/resume-drafts', z.array(resumeDraftSummarySchema)),
  resumeDraft: (id: string) => request(`/resume-drafts/${id}`, resumeDraftSchema),
  createResumeDraft: (input: { id: string; label: string; document: ResumeDocument }) => request('/resume-drafts', resumeDraftSchema, { method: 'POST', body: JSON.stringify(input) }),
  updateResumeDraft: (id: string, input: { label: string; document: ResumeDocument; revision: number }) => request(`/resume-drafts/${id}`, resumeDraftSchema, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteResumeDraft: (id: string, revision: number) => request(`/resume-drafts/${id}`, z.object({ deleted: z.literal(true) }), { method: 'DELETE', body: JSON.stringify({ revision }) }),
  resumeDraftPdf: (id: string, revision: number) => download(`/resume-drafts/${id}/pdf?revision=${revision}`, 'resume.pdf'),
  resumeVersions: () => request('/resume-versions', resumeVersionListSchema),
  resumeVersion: (id: string) => request(`/resume-versions/${id}`, resumeVersionSchema),
  resumeUpload: (file: File) => { const body = new FormData(); body.set('file', file); return request('/resume-versions/uploads', resumeUploadSchema, { method: 'POST', body }); },
  resumeSave: (draft: z.infer<typeof resumeVersionSaveSchema>) => request('/resume-versions', resumeVersionSchema, { method: 'POST', body: JSON.stringify(draft) }),
  resumeOriginal: (id: string) => download(`/resume-versions/${id}/original`, 'resume'),
  resumeDelete: (id: string, body: z.infer<typeof careerCancelSchema> & { confirmed: true }) => request(`/resume-versions/${id}`, resumeDeleteResultSchema, { method: 'DELETE', body: JSON.stringify(body) }),
  bossSession: () => request('/career/boss/session', bossSessionViewSchema),
  openBossSession: (body: z.infer<typeof careerCancelSchema>) => request('/career/boss/session/open', sessionCommandSchema, { method: 'POST', body: JSON.stringify(body) }),
  checkBossSession: (body: z.infer<typeof careerCancelSchema>) => request('/career/boss/session/check', sessionCommandSchema, { method: 'POST', body: JSON.stringify(body) }),
  clearBossSession: (body: { requestId: string; confirmed: true }) => request('/career/boss/session', sessionCommandSchema, { method: 'DELETE', body: JSON.stringify(body) }),
  careerTasks: () => request('/career/tasks', z.array(careerTaskViewSchema)),
  careerTask: (id: string) => request(`/career/tasks/${id}`, careerTaskViewSchema),
  reinspectCareerPosting: (taskId:string,postingId:string) => request(`/career/tasks/${taskId}/postings/${postingId}/reinspect`,z.object({workId:z.uuid()}),{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID()})}),
  bindCareerResume: (taskId: string, body: z.infer<typeof careerBindResumeSchema>) => request(`/career/tasks/${taskId}/bind-resume`, careerTaskViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  retryCareerContact: (taskId:string,contactId:string,body:z.infer<typeof careerContactRetrySchema>) => request(`/career/tasks/${taskId}/contacts/${contactId}/retry`,z.array(careerContactViewSchema),{method:'POST',body:JSON.stringify(body)}),
  careerContacts: (taskId:string) => request(`/career/tasks/${taskId}/contacts`,z.array(careerContactViewSchema)),
  approveCareerContacts: (taskId:string,body:z.infer<typeof careerContactApprovalSchema>) => request(`/career/tasks/${taskId}/contacts`,careerContactApprovalViewSchema,{method:'POST',body:JSON.stringify(body)}),
  createCareerTask: (body: z.infer<typeof careerTaskCreateSchema>) => request('/career/tasks', careerTaskViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  careerPostings: (taskId: string) => request(`/career/tasks/${taskId}/postings`, z.array(careerTaskPostingViewSchema)),
  patchCareerPosting: (taskId: string, postingId: string, body: z.infer<typeof careerPostingPatchSchema>) => request(`/career/tasks/${taskId}/postings/${postingId}`, careerTaskPostingViewSchema, { method: 'PATCH', body: JSON.stringify(body) }),
  approveCareerTask: (taskId: string, body: z.infer<typeof careerApprovalSchema>) => request(`/career/tasks/${taskId}/approve`, careerBatchViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  resumeCareerTask: (taskId: string, body: z.infer<typeof careerResumeCommandSchema>) => request(`/career/tasks/${taskId}/resume`, careerTaskViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  retryCareerGeneration: (taskId: string, body: z.infer<typeof careerRetryGenerationSchema>) => request(`/career/tasks/${taskId}/retry-generation`, careerTaskViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  cancelCareerTask: (taskId: string, body: z.infer<typeof careerCancelSchema>) => request(`/career/tasks/${taskId}/cancel`, careerTaskViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  deleteCareerTask: (taskId: string, body: z.infer<typeof careerDeleteTaskSchema>) => request(`/career/tasks/${taskId}`, z.object({ deleted: z.literal(true), pendingCleanup: z.boolean() }), { method: 'DELETE', body: JSON.stringify(body) }),
  careerBatch: (id: string) => request(`/career/batches/${id}`, careerBatchViewSchema),
  resumeCareerBatch: (id: string, body: z.infer<typeof careerResumeCommandSchema>) => request(`/career/batches/${id}/resume`, careerBatchViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  cancelCareerBatch: (id: string, body: z.infer<typeof careerCancelSchema>) => request(`/career/batches/${id}/cancel`, careerBatchViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  retryCareerItem: (batchId: string, itemId: string, body: z.infer<typeof careerItemRetrySchema>) => request(`/career/batches/${batchId}/items/${itemId}/retry`, workOnlySchema, { method: 'POST', body: JSON.stringify(body) }),
  reconcileCareerItem: (batchId: string, itemId: string, body: z.infer<typeof careerItemReconcileSchema>) => request(`/career/batches/${batchId}/items/${itemId}/reconcile`, workOnlySchema, { method: 'POST', body: JSON.stringify(body) }),
  resumeCareerAttachment: (batchId: string, itemId: string, body: z.infer<typeof careerItemResumeAttachmentSchema>) => request(`/career/batches/${batchId}/items/${itemId}/resume-attachment`, workOnlySchema, { method: 'POST', body: JSON.stringify(body) }),
  careerPreparation: (id: string) => request(`/career/preparations/${id}`, careerPreparationViewSchema),
  createCareerPreparation: (taskId: string, postingId: string) => request(`/career/tasks/${taskId}/postings/${postingId}/preparations`, careerPreparationViewSchema, { method: 'POST', body: '{}' }),
  patchCareerPreparation: (id: string, body: z.infer<typeof personalizedPreparationPatchSchema>) => request(`/career/preparations/${id}`, careerPreparationViewSchema, { method: 'PATCH', body: JSON.stringify(body) }),
  retryCareerPreparation: (id: string, body: { requestId: string; modelConnectionId?: string }) => request(`/career/preparations/${id}/retry`, careerPreparationViewSchema, { method: 'POST', body: JSON.stringify(body) }),
  exportCareerPreparation: (id: string, format: 'markdown' | 'json') => download(`/career/preparations/${id}/export?format=${format}`, `career-preparation.${format === 'markdown' ? 'md' : 'json'}`),
  saveCareerPreparationToBank: (id: string, body: z.infer<typeof careerSaveToBankSchema>) => request(`/career/preparations/${id}/save-to-bank`, z.array(bankQuestionSchema).min(1).max(10), { method: 'POST', body: JSON.stringify(body) }),
};
