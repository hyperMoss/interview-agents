import { readFile } from 'node:fs/promises';
import { digest } from '../../packages/career/src/domain';
import { join } from 'node:path';
import { migrateSqlite } from '../../packages/database/src/migrate';
import { CareerService } from '../../apps/api/src/career';
import { CareerWorker } from '../../apps/worker/src/career-worker';
import { apiConfig, workerConfig } from '../fixtures';
const [origin,directory,scenario]=process.argv.slice(2);
if(!origin||!directory||new URL(origin).hostname!=='127.0.0.1')throw Error('LOCAL_FIXTURE_ONLY');
const database=`file:${join(directory,'app.sqlite')}`;
await migrateSqlite(database,'app');
const common={DATABASE_URL:database,CAREER_LOCAL_DATA_DIR:directory,BOSS_AUTOMATION:'contact' as const,BOSS_SITE_ORIGIN:origin,BOSS_BROWSER_ENGINE:'patchright' as const,REDIS_URL:''};
const service=new CareerService({...apiConfig(),...common});
let agentCalls=0;
const worker=new CareerWorker({...workerConfig(),...common},{agent:{match:async()=>{agentCalls++;throw Error('PREVIEW_CALLED_AI');},prepare:async()=>{agentCalls++;throw Error('PREVIEW_CALLED_AI');},purgeReceipt:async()=>true}});
const owner=crypto.randomUUID();
try{
 process.stderr.write('stage:open\n');await service.openSession(owner);await worker.tick();process.stderr.write('stage:opened\n');
 const created=await service.createTask(owner,{mode:'preview',requestId:crypto.randomUUID(),policy:{roleTargets:scenario==='custom'?[]:['fullstack'],...(scenario==='custom'?{customRoleKeywords:['C++']}:{}),cities:['广州'],salaryUpperMinCnyMonthly:18000,preferAiApplication:false,companyBlacklistKeywords:[]}});
 process.stderr.write('stage:scan\n');await worker.tick();process.stderr.write('stage:scanned\n');
 let task=await service.getTask(owner,created.id);let postings=await service.listPostings(owner,created.id);
 let reinspected=false;
 if(task.state.status==='active'&&task.state.phase==='review'&&postings[0]){
  const request=await service.reinspectPosting(owner,task.id,postings[0].id,{requestId:crypto.randomUUID()});await worker.tick();
  const work=await service.store.work(request.workId);if(work?.status!=='completed')throw new Error(`REINSPECTION_FAILED:${work?.failure}`);
  task=await service.getTask(owner,created.id);postings=await service.listPostings(owner,created.id);reinspected=postings.some(posting=>posting.revision===1);
 }
 let resumeNameMatched=false;
 if(task.state.status==='active'&&task.state.phase==='review'){await service.inspectSiteResume(owner,{expectedName:'Fixture user'});await worker.tick();const evidence=JSON.parse(await readFile(join(directory,'observations',digest(owner).slice(0,32),'resume-controls.json'),'utf8'));resumeNameMatched=evidence.expectedNameMatched;}
 let contactState:string|null=null;
 if(task.state.status==='active'&&task.state.phase==='review'){
  const selected=postings.find(posting=>posting.decision.disposition==='eligible');
  if(!selected)throw Error('FIXTURE_ELIGIBLE_MISSING');
  const input={requestId:crypto.randomUUID(),expectedTaskRevision:task.revision,items:[{taskPostingId:selected.id,snapshotHash:selected.snapshotHash}]};
  const approval=await service.approveContacts(owner,task.id,input);
  const replay=await service.approveContacts(owner,task.id,input);if(replay.approvalId!==approval.approvalId)throw Error('CONTACT_REPLAY_MISMATCH');
  await worker.tick();contactState=(await service.listContacts(owner,task.id))[0]?.state??null;
  if(scenario==='retry_before_click'){
    if(contactState!=='failed')throw Error('FIXTURE_EXPECTED_PRECLICK_FAILURE');
    await fetch(`${origin}/fixture-enable-contact`,{method:'POST'});
    const failed=(await service.listContacts(owner,task.id))[0];if(!failed)throw Error('NO_FAILED_CONTACT');
    const retry={requestId:crypto.randomUUID(),expectedUpdatedAt:failed.updatedAt};
    await service.retryContact(owner,task.id,failed.id,retry);await service.retryContact(owner,task.id,failed.id,retry);
    await worker.tick();contactState=(await service.listContacts(owner,task.id))[0]?.state??null;
  }
  if(contactState==='unknown'){
    const uncertain=(await service.listContacts(owner,task.id))[0];if(!uncertain)throw Error('NO_UNCERTAIN_CONTACT');
    let blocked=false;try{await service.retryContact(owner,task.id,uncertain.id,{requestId:crypto.randomUUID(),expectedUpdatedAt:uncertain.updatedAt});}catch{blocked=true;}
    if(!blocked)throw Error('UNKNOWN_CONTACT_RETRY_ACCEPTED');
  }
  await worker.tick();const finalReplay=await service.approveContacts(owner,task.id,input);if(finalReplay.contacts[0]?.state!==contactState)throw Error('CONTACT_TERMINAL_CHANGED');
  await worker.tick();
 }
 process.stdout.write(JSON.stringify({task,postings,agentCalls,resumeNameMatched,reinspected,contactState})+'\n');
}finally{process.stderr.write('stage:close\n');await worker.close();await service.close();process.stderr.write('stage:closed\n');}
