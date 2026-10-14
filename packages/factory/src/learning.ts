import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { digest, readOptional, safePath, type ActiveRule } from './compiler';
import { capabilitySchema, resolveSpec } from './resolver';
import { parse } from 'yaml';

const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/), sourceRevision: z.string().regex(/^[0-9a-f]{40,64}$/),
  status: z.literal('completed'), specPath: z.string().default('app.spec.yaml'),
  checks: z.array(z.strictObject({ id:z.string().regex(/^[A-Za-z0-9_-]{2,100}$/), result:z.enum(['passed','failed']), artifact:z.string() })).min(1),
});
const recordSchema = evidenceSchema.extend({ recordId:z.string().regex(/^[0-9a-f]{64}$/), capabilities:z.array(capabilitySchema), artifacts:z.record(z.string(),z.string()), specHash:z.string() });
const proposalSchema = z.strictObject({ id:z.string().regex(/^[a-z][a-z0-9-]{1,62}$/), lesson:z.string().min(10).max(800), capability:capabilitySchema,
  requiredCheck:z.string().regex(/^[A-Za-z0-9_-]{2,100}$/), recordIds:z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(2), });
const ruleSchema=z.strictObject({id:z.string(),capability:z.string(),lesson:z.string(),requiredCheck:z.string()});
const versionSchema=z.strictObject({version:z.number().int().nonnegative(), parent:z.number().int().nonnegative(), action:z.enum(['promote','rollback']),
  proposalHash:z.string(), reviewer:z.string(), rules:z.array(ruleSchema), records:z.array(z.string())});
function sanitized(text: string) {
  if (/-----BEGIN .*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|password|authorization)\s*[=:]\s*["']?[^\s"']{8,}/i.test(text)) throw new Error('EVIDENCE_CONTAINS_SECRET: sanitize artifact before recording');
  return text;
}
function json(value:unknown){return JSON.stringify(value,null,2)+'\n';}
async function withStore<T>(store:string, fn:()=>Promise<T>) {
  await mkdir(store,{recursive:true}); const fs=await import('node:fs/promises');
  const handle=await fs.open(resolve(store,'.write.lock'),'wx');
  try { return await fn(); } finally { await handle.close(); await unlink(resolve(store,'.write.lock')); }
}
async function immutable(store:string,path:string,value:unknown) {
  const target=await safePath(store,path);await mkdir(resolve(target,'..'),{recursive:true});
  const text=json(value);const existing=await readOptional(target);
  if(existing!==null){if(existing!==text)throw new Error('IMMUTABLE_RECORD_CONFLICT');return;}
  await writeFile(target,text,{flag:'wx',mode:0o600});
}
export async function activeLearning(store:string, pinned?:number):Promise<{version:number;rules:ActiveRule[]}> {
  const latestText=await readOptional(resolve(store,'head.json'));
  const head=latestText?z.strictObject({version:z.number().int().nonnegative()}).parse(JSON.parse(latestText)).version:0;
  const version=pinned??head;
  if(version===0)return{version:0,rules:[]};
  const entry=versionSchema.parse(JSON.parse(await readFile(await safePath(store,`versions/${version}.json`),'utf8')));
  return{version:entry.version,rules:entry.rules};
}
export async function recordEvidence(store:string,projectDir:string,manifestPath:string) {
  const manifest=evidenceSchema.parse(JSON.parse(await readFile(manifestPath,'utf8')));
  const specText=await readFile(await safePath(projectDir,manifest.specPath),'utf8');
  const plan=resolveSpec(parse(specText));
  if(plan.spec.project.id!==manifest.projectId)throw new Error('PROJECT_ID_MISMATCH');
  const artifacts:Record<string,string>={};
  for(const check of manifest.checks){
    if(check.artifact.split(/[\\/]/).some(part=>part.startsWith('.env')))throw new Error('SECRET_FILE_REFUSED');
    artifacts[check.artifact]=digest(sanitized(await readFile(await safePath(projectDir,check.artifact),'utf8')));
  }
  if(!manifest.checks.some(check=>check.result==='passed'))throw new Error('NO_PASSING_EVIDENCE');
  const payload={...manifest,capabilities:plan.capabilities.map(c=>c.id),artifacts,specHash:digest(specText)};
  const recordId=digest(json(payload)); const record={...payload,recordId};
  await withStore(store,()=>immutable(store,`records/${recordId}.json`,record));
  return record;
}
export async function proposeLearning(store:string,raw:unknown) {
  const proposal=proposalSchema.parse(raw);sanitized(proposal.lesson);
  const projects=new Set<string>();
  for(const id of new Set(proposal.recordIds)){
    const record=recordSchema.parse(JSON.parse(await readFile(await safePath(store,`records/${id}.json`),'utf8')));
    const {recordId,...payload}=record;if(recordId!==id||digest(json(payload))!==id)throw new Error('EVIDENCE_HASH_MISMATCH');
    if(!record.capabilities.includes(proposal.capability))throw new Error('LESSON_NOT_APPLICABLE');
    if(!record.checks.some(check=>check.id===proposal.requiredCheck&&check.result==='passed'))throw new Error('REQUIRED_REGRESSION_NOT_PASSED');
    projects.add(record.projectId);
  }
  if(projects.size<2)throw new Error('TWO_INDEPENDENT_PROJECTS_REQUIRED');
  await withStore(store,()=>immutable(store,`proposals/${proposal.id}.json`,proposal));return proposal;
}
export async function promoteLearning(store:string,id:string,reviewer:string,replay:{projectDir:string;manifestPath:string}[]) {
  if(!reviewer.trim())throw new Error('REVIEWER_REQUIRED');sanitized(reviewer);
  const text=await readFile(await safePath(store,`proposals/${id}.json`),'utf8');const proposal=proposalSchema.parse(JSON.parse(text));
  const records: Array<Awaited<ReturnType<typeof recordEvidence>>> = [];
  for(const entry of replay)records.push(await recordEvidence(store,entry.projectDir,entry.manifestPath));
  if(new Set(records.map(record=>record.projectId)).size<2)throw new Error('TWO_FRESH_PROJECT_REPLAYS_REQUIRED');
  for(const record of records){
    if(!record.capabilities.includes(proposal.capability)||!record.checks.some(check=>check.id===proposal.requiredCheck&&check.result==='passed'))throw new Error('REPLAY_REGRESSION_NOT_PASSED');
    if(record.checks.some(check=>check.result==='failed'))throw new Error('REPLAY_HAS_FAILURES');
  }
  return withStore(store,async()=>{
    const current=await activeLearning(store);
    if(current.rules.some(rule=>rule.id===id))throw new Error('ALREADY_PROMOTED');
    const rule={id,capability:proposal.capability,lesson:proposal.lesson,requiredCheck:proposal.requiredCheck};
    const version={version:current.version+1,parent:current.version,action:'promote' satisfies 'promote',proposalHash:digest(text),reviewer,
      rules:[...current.rules,rule].sort((a,b)=>a.id.localeCompare(b.id)),records:records.map(record=>record.recordId)};
    await immutable(store,`versions/${version.version}.json`,version);await updateHead(store,version.version);return version;
  });
}
export async function rollbackLearning(store:string,target:number,reviewer:string) {
  if(!reviewer.trim())throw new Error('REVIEWER_REQUIRED');
  return withStore(store,async()=>{
    const current=await activeLearning(store);if(target>=current.version)throw new Error('ROLLBACK_REQUIRES_OLDER_VERSION');
    const previous=await activeLearning(store,target);
    const version={version:current.version+1,parent:current.version,action:'rollback' satisfies 'rollback',proposalHash:'',reviewer:sanitized(reviewer),rules:previous.rules,records:[]};
    await immutable(store,`versions/${version.version}.json`,version);await updateHead(store,version.version);return version;
  });
}
async function updateHead(store:string,version:number){const tmp=resolve(store,`head-${crypto.randomUUID()}.tmp`);await writeFile(tmp,json({version}),{flag:'wx',mode:0o600});await rename(tmp,resolve(store,'head.json'));}
