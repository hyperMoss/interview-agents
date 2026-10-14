import { describe,it,expect,afterEach } from 'vitest';
import { mkdtemp,readFile,writeFile,rm,mkdir,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { baseSpec } from './fixtures';
import { checkReferenceRuntime } from '../packages/factory/src/runtime-check';
import { resolveSpec } from '../packages/factory/src/resolver';
import { compile,writeGenerated,digest } from '../packages/factory/src/compiler';
import { recordEvidence,proposeLearning,promoteLearning,activeLearning,rollbackLearning } from '../packages/factory/src/learning';
const dirs:string[]=[];async function temp(){const dir=await mkdtemp(join(tmpdir(),'interview-factory-test-'));dirs.push(dir);return dir;}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const selected=(spec:unknown)=>resolveSpec(spec).capabilities.map(c=>c.id);
describe('deterministic capability assembly',()=>{
  it('reference application runtime registry matches its real spec',async()=>{await expect(checkReferenceRuntime()).resolves.toBeUndefined();});
  it('business base needs no AI, Redis, storage or model key',()=>{
    const plan=resolveSpec(baseSpec);expect(selected(baseSpec)).toEqual(['core.platform']);expect(plan.services).toEqual(['api','postgres','web']);
    expect(JSON.stringify(plan.env)).not.toContain('LLM');
  });
  it('interview pulls in agent, durable jobs and model, without optional SDK services',()=>{
    const plan=resolveSpec({...baseSpec,blueprint:'interview-practice'});expect(plan.services).toEqual(['agent','api','postgres','redis','web','worker']);expect(plan.services).not.toContain('rustfs');
  });
  it('semantic RAG conflicts with explicitly disabled embedding',()=>{
    expect(()=>resolveSpec({...baseSpec,capabilities:{'rag.knowledge':true,'ai.embedding':false},options:{rag_mode:'semantic'}})).toThrow('ai.embedding');
  });
  it('lexical RAG needs no embedding or MinerU',()=>{const ids=selected({...baseSpec,capabilities:{'rag.knowledge':true}});expect(ids).toContain('retrieval.lexical');expect(ids).not.toContain('ai.embedding');expect(ids).not.toContain('documents.parse');});
  it('pgvector only never adds Elasticsearch',()=>{expect(resolveSpec({...baseSpec,capabilities:{'rag.knowledge':true},options:{rag_mode:'semantic'}}).services).not.toContain('elasticsearch');});
  it('TTS only neither adds ASR nor storage',()=>{const ids=selected({...baseSpec,capabilities:{'speech.tts':true}});expect(ids).not.toContain('speech.asr');expect(ids).not.toContain('files.object-storage');});
  it('realtime ASR has no file dependency and file ASR requires storage and jobs',()=>{
    expect(selected({...baseSpec,capabilities:{'speech.asr':true}})).not.toContain('files.manage');
    expect(selected({...baseSpec,capabilities:{'speech.asr':true},options:{asr_mode:'file'}})).toEqual(expect.arrayContaining(['files.manage','files.object-storage','jobs.async']));
  });
  it('internet search does not install storage or document parser',()=>{const plan=resolveSpec({...baseSpec,capabilities:{'web.search':true}});expect(plan.services).not.toContain('rustfs');expect(selected(plan.spec)).not.toContain('documents.parse');});
  it('mixed web providers retain both API keys regardless of which implements search',()=>{
    for(const providers of [{'web.search':'firecrawl','web.extract':'tavily'},{'web.search':'tavily','web.extract':'firecrawl'}])expect(resolveSpec({...baseSpec,capabilities:{'web.search':true,'web.extract':true},providers}).env.api).toEqual(expect.arrayContaining(['TAVILY_API_KEY','FIRECRAWL_API_KEY']));
  });
  it('rejects unknown capability, unknown property and invalid provider',()=>{
    expect(()=>resolveSpec({...baseSpec,capabilities:{'rag.knowladge':true}})).toThrow();expect(()=>resolveSpec({...baseSpec,typo:true})).toThrow();
    expect(()=>resolveSpec({...baseSpec,capabilities:{'web.search':true},providers:{'web.search':'mineru'}})).toThrow('Provider');
  });
  it('refuses credential values before compiling public artifacts',()=>{expect(()=>resolveSpec({...baseSpec,business:{...baseSpec.business,summary:'配置 API_KEY=sk-private-fixture-credential 作为模型凭据。'}})).toThrow('SPEC_CONTAINS_SECRET');});
  it('rejects cloud parsing policy and disabled email dependency',()=>{
    expect(()=>resolveSpec({...baseSpec,capabilities:{'documents.parse':true},providers:{'documents.parse':'mineru-cloud'},policy:{allow_cloud_processing:false}})).toThrow('Cloud');
    expect(()=>resolveSpec({...baseSpec,capabilities:{'mail.delivery':false},options:{require_email_verification:true}})).toThrow('mail.delivery');
  });
  it('refuses unselected requirements and repeated requirement IDs',()=>{
    expect(()=>resolveSpec({...baseSpec,business:{...baseSpec.business,requirements:[{...baseSpec.business.requirements[0],capabilities:['speech.tts']}]}})).toThrow('unselected');
    expect(()=>resolveSpec({...baseSpec,business:{...baseSpec.business,requirements:[...baseSpec.business.requirements,...baseSpec.business.requirements]}})).toThrow('Duplicate');
  });
  it('same spec renders exactly the same artifact and contains only selected module context',()=>{
    const plan=resolveSpec(baseSpec);expect(compile(plan)).toEqual(compile(plan));const context=JSON.parse(compile(plan).outputs['docs/context/index.json']??'');
    expect(Object.keys(context.tasks)).toEqual(['implement-core.platform']);
  });
});
describe('managed output',()=>{
  it('repeated generation makes no changes',async()=>{const dir=await temp();const bundle=compile(resolveSpec(baseSpec));expect((await writeGenerated(dir,bundle)).changed.length).toBeGreaterThan(0);expect((await writeGenerated(dir,bundle)).changed).toEqual([]);});
  it('user edits stop the full generation before any overwrite',async()=>{
    const dir=await temp();await writeGenerated(dir,compile(resolveSpec(baseSpec)));const path=join(dir,'docs/generated/00-PROJECT-BRIEF.md');await writeFile(path,'human edit');
    await expect(writeGenerated(dir,compile(resolveSpec({...baseSpec,project:{...baseSpec.project,display_name:'Changed'}})))).rejects.toThrow('GENERATED_CONFLICT');expect(await readFile(path,'utf8')).toBe('human edit');
  });
  it('refuses symlink output and path traversal in a forged lock',async()=>{
    const dir=await temp();const elsewhere=await temp();await symlink(elsewhere,join(dir,'docs'));
    await expect(writeGenerated(dir,compile(resolveSpec(baseSpec)))).rejects.toThrow('Symlink');
    const clean=await temp();const bundle=compile(resolveSpec(baseSpec));await writeFile(join(clean,'factory.lock.json'),JSON.stringify({...bundle.lock,outputs:{'../victim':'abc'}}));
    await expect(writeGenerated(clean,bundle)).rejects.toThrow('unmanaged');
  });
  it('disabling a capability removes only managed docs and records retirement',async()=>{
    const dir=await temp();await writeGenerated(dir,compile(resolveSpec({...baseSpec,capabilities:{'speech.tts':true}})));
    const result=await writeGenerated(dir,compile(resolveSpec(baseSpec)));expect(result.retirement).toContain('speech.tts');expect(result.changed).toContain('docs/generated/modules/speech.tts.md');
  });
});
describe('cross-project evidence and reversible learning (synthetic fixtures)',()=>{
  async function project(id:string){
    const dir=await temp();const sourceRevision=digest(id);await writeFile(join(dir,'app.spec.yaml'),stringify({...baseSpec,project:{id,display_name:id}}));
    await mkdir(join(dir,'evidence'));await writeFile(join(dir,'evidence/result.json'),JSON.stringify({projectId:id,sourceRevision,check:'OWNER_ISOLATION',result:'passed',fixture:true}));
    const manifestPath=join(dir,'manifest.json');await writeFile(manifestPath,JSON.stringify({schemaVersion:1,projectId:id,sourceRevision,status:'completed',checks:[{id:'OWNER_ISOLATION',result:'passed',artifact:'evidence/result.json'}]}));return{projectDir:dir,manifestPath};
  }
  it('requires two project IDs, promotes scope-specific guidance and retains rollback history',async()=>{
    const store=await temp();const a=await project('fixture-a');const b=await project('fixture-b');
    const ra=await recordEvidence(store,a.projectDir,a.manifestPath);const rb=await recordEvidence(store,b.projectDir,b.manifestPath);
    const proposal={id:'owner-boundary',lesson:'读取和修改资源都验证可信身份与归属，并保留跨用户负向测试。',capability:'core.platform',requiredCheck:'OWNER_ISOLATION',recordIds:[ra.recordId,rb.recordId]};
    await expect(proposeLearning(store,{...proposal,recordIds:[ra.recordId,ra.recordId]})).rejects.toThrow('TWO_INDEPENDENT');
    await proposeLearning(store,proposal);await promoteLearning(store,proposal.id,'synthetic-test-reviewer',[a,b]);
    expect((await activeLearning(store)).rules).toHaveLength(1);expect((await activeLearning(store,0)).rules).toEqual([]);
    expect(compile(resolveSpec(baseSpec),(await activeLearning(store)).rules,1).outputs['docs/generated/AGENTS.generated.md']).toContain('owner-boundary');
    await rollbackLearning(store,0,'synthetic-test-reviewer');expect((await activeLearning(store)).rules).toEqual([]);expect((await activeLearning(store,1)).rules).toHaveLength(1);
  });
  it('rejects secret artifacts and a mismatched spec project',async()=>{
    const store=await temp();const a=await project('fixture-a');await writeFile(join(a.projectDir,'evidence/result.json'),'api_key=sk-long-secret-fixture-value');
    await expect(recordEvidence(store,a.projectDir,a.manifestPath)).rejects.toThrow('CONTAINS_SECRET');
    await writeFile(a.manifestPath,JSON.stringify({schemaVersion:1,projectId:'other-app',sourceRevision:digest('x'),status:'completed',checks:[{id:'OWNER_ISOLATION',result:'passed',artifact:'evidence/result.json'}]}));
    await expect(recordEvidence(store,a.projectDir,a.manifestPath)).rejects.toThrow('PROJECT_ID_MISMATCH');
  });
});
