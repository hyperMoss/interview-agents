import { mkdtemp,stat,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,describe,it,expect } from 'vitest';
import { migrateSqlite } from '../packages/database/src/migrate';
import { digest } from '../packages/career/src/domain';
import { evaluatePosting } from '../packages/career/src/filters';
import { CareerStore } from '../packages/career/src/store';
import { CareerService } from '../apps/api/src/career';
import { apiConfig } from './fixtures';
import { sqliteClient, Pool } from '../packages/database/src/sqlite';
import { readApiConfig } from '../packages/config/src/index';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
describe('native SQLite persistence',()=>{
  async function fixture(){const dir=await mkdtemp(join(tmpdir(),'sqlite-contract-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const url=`file:${dir}/app.sqlite`;await migrateSqlite(url,'app');const pool=new Pool({connectionString:url});cleanup.push(()=>pool.end());return{dir,url,pool};}
  it('is idempotent, private, WAL-enabled and enforces foreign keys on every connection',async()=>{
    const {url,pool,dir}=await fixture();await migrateSqlite(url,'app');
    expect((await stat(join(dir,'app.sqlite'))).mode&0o777).toBe(0o600);
    expect((await pool.query('PRAGMA journal_mode')).rows[0]?.journal_mode).toBe('wal');
    const c=await pool.connect();try{expect((await c.query('PRAGMA foreign_keys')).rows[0]?.foreign_keys).toBe(1);await expect(c.query("INSERT INTO app_interview_materials(session_id,questions) VALUES($1,'[]')",[crypto.randomUUID()])).rejects.toThrow('FOREIGN KEY');}finally{c.release();}
  });
  it('rolls back failed writes and persists accepted rows after reopen',async()=>{
    const {url,pool}=await fixture();const c=await pool.connect();
    try{await c.query('BEGIN');await c.query('INSERT INTO app_deletions(job_id) VALUES($1)',[crypto.randomUUID()]);await c.query('ROLLBACK');}finally{c.release();}
    expect((await pool.query('SELECT * FROM app_deletions')).rows).toEqual([]);
    const id=crypto.randomUUID();await pool.query('INSERT INTO app_deletions(job_id) VALUES($1)',[id]);
    const reopened=new Pool({connectionString:url});try{expect((await reopened.query('SELECT job_id FROM app_deletions')).rows[0]?.job_id).toBe(id);}finally{await reopened.end();}
  });
  it('yields while another connection holds a write transaction and resumes after commit',async()=>{
    const {pool}=await fixture();const left=await pool.connect(),right=await pool.connect();
    try{await left.query('BEGIN');let acquired=false;const pending=right.query('BEGIN').then(()=>{acquired=true;});await new Promise(resolve=>setTimeout(resolve,60));expect(acquired).toBe(false);await left.query('COMMIT');await pending;expect(acquired).toBe(true);await right.query('ROLLBACK');}finally{left.release();right.release();}
  });
  it('rejects two services sharing the same normalized file',()=>{
    expect(()=>readApiConfig({...process.env,DATABASE_URL:'file:/tmp/db.sqlite',AGENT_DATABASE_URL:'file:/tmp/./db.sqlite'})).toThrow('must differ');
  });
  it('keeps live work queued while paused, permits clearing, and fences recovered leases',async()=>{
    const {pool}=await fixture();const store=new CareerStore(pool);const owner=crypto.randomUUID();
    const open=crypto.randomUUID(),clear=crypto.randomUUID();
    await store.enqueueWork({id:open,owner,kind:'session',requestHash:open,payload:{action:'open'}});
    await store.enqueueWork({id:clear,owner,kind:'session',requestHash:clear,payload:{action:'clear'}});
    const first=await store.claimWork(['session'],120,'paused');expect(first?.id).toBe(clear);
    expect((await store.work(open))?.attempts).toBe(0);
    if(!first)throw new Error('Expected clear work');
    expect(first.lease_until?.getTime()).toBeGreaterThan(Date.now()+110000);
    expect(await store.renewLease(first.id,first.lease_generation,180)).toBe(true);
    expect(await store.holdWork(first.id,first.lease_generation,'wait',10)).toBe(true);
    expect(await store.claimWork(['session'],120,'paused')).toBeNull();
    await pool.query("UPDATE app_career_work SET lease_until='2000-01-01T00:00:00.000000Z' WHERE id=$1",[clear]);
    const recovered=await store.claimWork(['session'],120,'paused');expect(recovered?.lease_generation).toBe(first.lease_generation+1);
    expect(await store.finishWork(first.id,first.lease_generation,'completed')).toBe(false);
  });
  it('rejects session opening and checking at the API before enqueueing while paused',async()=>{
    const {pool,url,dir}=await fixture();
    const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'paused'});
    try{await expect(service.openSession(crypto.randomUUID())).rejects.toThrow('已暂停');await expect(service.checkSession(crypto.randomUUID())).rejects.toThrow('已暂停');expect((await pool.query('SELECT * FROM app_career_work')).rows).toEqual([]);}finally{await service.close();}
  });

  it('manual mode accepts session checks while never claiming scan or delivery work',async()=>{
    const {pool,url,dir}=await fixture();const store=new CareerStore(pool);const owner=crypto.randomUUID();
    const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'manual'});
    try{
      expect((await service.session(owner)).automationMode).toBe('manual');
      await expect(service.createTask(owner,{})).rejects.toThrow('自动搜索和投递未启用');
      for(const kind of ['scan','delivery','session'] as const){const id=crypto.randomUUID();await store.enqueueWork({id,owner,kind,requestHash:id,payload:kind==='session'?{action:'check'}:{}});}
      expect(await store.claimWork(['scan','delivery'],120,'manual')).toBeNull();
      const check=await store.claimWork(['session'],120,'manual');expect(check?.payload).toEqual({action:'check'});
    }finally{await service.close();}
  });

  it('search mode claims scans and checks while preserving queued deliveries',async()=>{
    const {pool,url,dir}=await fixture();const store=new CareerStore(pool),owner=crypto.randomUUID();
    for(const kind of ['delivery','scan','session'] as const){const id=crypto.randomUUID();await store.enqueueWork({id,owner,kind,requestHash:id,payload:kind==='session'?{action:'check'}:{}});}
    expect((await store.claimWork(['scan','delivery'],120,'search'))?.kind).toBe('scan');
    expect(await store.claimWork(['delivery'],120,'search')).toBeNull();
    expect((await store.claimWork(['session'],120,'search'))?.kind).toBe('session');
    const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'search'});
    try{await expect(service.approve(owner,crypto.randomUUID(),{})).rejects.toThrow('自动投递未启用');}finally{await service.close();}
  });

  it('creates and replays a preview with no resume or model, isolating owners',async()=>{
    const {url,dir,pool}=await fixture();
    const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'search'});
    const owner=crypto.randomUUID();
    const input={mode:'preview',requestId:crypto.randomUUID(),policy:{roleTargets:['fullstack'],cities:['广州'],salaryUpperMinCnyMonthly:18000,preferAiApplication:false,companyBlacklistKeywords:[]}};
    try {
      const first=await service.createTask(owner,input),second=await service.createTask(owner,input);
      expect(first.id).toBe(second.id);expect(first.mode).toBe('preview');
      expect(first.resumeVersionId).toBeNull();expect(first.model).toBeNull();
      expect((await pool.query("SELECT id FROM app_career_work WHERE task_id=$1 AND kind='scan'",[first.id])).rows).toHaveLength(1);
      expect(await service.listTasks(crypto.randomUUID())).toEqual([]);
      await expect(service.manualPreparation(owner,first.id,crypto.randomUUID())).rejects.toThrow('未绑定简历和模型');
      await expect(service.createTask(owner,{...input,policy:{...input.policy,cities:['深圳']}})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    } finally {await service.close();}
  });

  it('upgrades a populated legacy task table without losing children and is repeatable',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'sqlite-preview-upgrade-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const url=`file:${dir}/old.sqlite`;
    const db=sqliteClient(url);
    const sql=await readFile(new URL('../infra/sqlite/001-init.sql',import.meta.url),'utf8');
    const task=sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS app_career_tasks ('),sql.indexOf('CREATE INDEX IF NOT EXISTS career_tasks_owner'));
    const legacy=task.slice(0,task.indexOf(',\n  CHECK (('))+'\n);';
    db.exec(legacy.replace('resume_version_id text','resume_version_id text NOT NULL').replace('resume_text_sha256 text','resume_text_sha256 text NOT NULL').replace('attachment_sha256 text','attachment_sha256 text NOT NULL').replace('model_source text','model_source text NOT NULL'));
    db.exec('CREATE TABLE child_fixture (task_id text REFERENCES app_career_tasks(id) ON DELETE CASCADE)');
    const id=crypto.randomUUID();db.exec('PRAGMA foreign_keys=OFF');
    db.prepare("INSERT INTO app_career_tasks(id,owner,resume_version_id,resume_text_sha256,attachment_sha256,policy,model_source,phase,status) VALUES(?,?,?,?,?,?,?,'review','active')").run(id,'fixture-owner',crypto.randomUUID(),'a'.repeat(64),'b'.repeat(64),'{}','{}');
    db.prepare('INSERT INTO child_fixture VALUES(?)').run(id);
    // Create the referenced resume table and matching synthetic parent before checking FK integrity.
    db.exec('CREATE TABLE app_resume_versions (id text PRIMARY KEY, owner text, created_at text)');
    db.exec('INSERT INTO app_resume_versions(id) SELECT resume_version_id FROM app_career_tasks');
    db.close();
    await migrateSqlite(url,'app');await migrateSqlite(url,'app');
    const reopened=sqliteClient(url);try {
      expect(reopened.prepare('SELECT task_id FROM child_fixture').all()).toEqual([{task_id:id}]);
      expect(reopened.prepare('SELECT resume_text_sha256 FROM app_career_tasks').get()).toEqual({resume_text_sha256:'a'.repeat(64)});
      expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {reopened.close();}
  });

  it('binds a preview idempotently and approves a manual batch without AI preparation',async()=>{
    const {url,dir,pool}=await fixture();const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'enabled'});
    const owner=crypto.randomUUID();
    const policy={roleTargets:['fullstack'] as const,cities:['广州'] as const,salaryUpperMinCnyMonthly:18000,preferAiApplication:false,companyBlacklistKeywords:[]};
    try{
      const created=await service.createTask(owner,{mode:'preview',requestId:crypto.randomUUID(),policy});
      const upload=await service.store.createUpload(owner,{filename:'fixture.txt',text:'合成简历，只用于事务验证，不描述真实用户经历。',warnings:[],storageKey:'fixture.txt',sha256:'a'.repeat(64),byteSize:80,contentType:'text/plain'});
      const resume=await service.store.saveResumeVersion(owner,{requestId:crypto.randomUUID(),requestHash:'synthetic-resume',stagingId:upload.id,label:'fixture',text:'合成简历，只用于事务验证，不描述真实用户经历。',attachmentSha256:upload.sha256,byteSize:upload.byte_size,contentType:upload.content_type,originalName:upload.filename,storageKey:upload.storage_key,warnings:[],textSha256:'b'.repeat(64)});
      const bind={requestId:crypto.randomUUID(),expectedRevision:0,resumeVersionId:resume.id};
      await expect(service.bindResume(owner,created.id,bind)).rejects.toThrow('只有已完成');
      await pool.query("UPDATE app_career_work SET status='completed' WHERE task_id=$1",[created.id]);
      await service.store.setTaskState(created.id,{phase:'review'});
      const observed={site:'boss' as const,sitePostingId:'manual-fixture',url:'https://example.test/job_detail/manual-fixture.html',title:'全栈工程师',company:'合成自研公司',location:'广州',salaryRaw:'18-25K',jdText:'负责全栈应用开发，React 与 NestJS，项目公司直招。',companyProfileText:'公司直招，自有研发团队',identitySource:'detail_link' as const,nativeFilterEvidence:{method:'search_url' as const,searchKey:'fixture',controls:[{label:'city',selected:'广州',url:'https://example.test/'}]}};
      const postingId=await service.store.upsertPosting(owner,observed);const taskPostingId=crypto.randomUUID();const snapshotHash=digest(observed);const decision=evaluatePosting({policy:{...policy,roleTargets:[...policy.roleTargets],cities:[...policy.cities]},posting:observed});
      expect(decision.disposition).toBe('eligible');
      await service.store.upsertTaskPosting(owner,{id:taskPostingId,taskId:created.id,postingId,observed,snapshotHash,disposition:decision.disposition,decision,match:null,greeting:null,existingRevision:null});
      await expect(service.bindResume(crypto.randomUUID(),created.id,bind)).rejects.toThrow('TASK_NOT_FOUND');
      const bound=await service.bindResume(owner,created.id,bind);expect(bound.mode).toBe('manual');expect(bound.resumeVersionId).toBe(resume.id);
      expect((await service.bindResume(owner,created.id,bind)).revision).toBe(bound.revision);
      expect((await service.listPostings(owner,created.id))[0]?.snapshotHash).toBe(snapshotHash);
      const edited=await service.patchPosting(owner,created.id,taskPostingId,{requestId:crypto.randomUUID(),expectedRevision:0,greetingText:'您好，希望进一步了解贵公司这个全栈岗位，方便时期待与您沟通。'});
      expect(edited.greeting?.modelAttribution.kind).toBe('manual');
      await service.store.writeSession(owner,{state:'ready',engine:'patchright',accountMarker:null,reason:null});
      const current=await service.getTask(owner,created.id);
      const batch=await service.approve(owner,created.id,{requestId:crypto.randomUUID(),expectedTaskRevision:current.revision,resumeVersionId:resume.id,items:[{taskPostingId,postingSnapshotHash:snapshotHash,greetingDraftRevision:edited.greetingRevision,finalGreeting:edited.greeting?.text}]});
      expect(batch.model.kind).toBe('manual');expect(batch.items).toHaveLength(1);
      expect((await pool.query("SELECT id FROM app_career_work WHERE task_id=$1 AND kind='delivery'",[created.id])).rows).toHaveLength(1);
      expect((await pool.query('SELECT id FROM app_career_preparations WHERE task_id=$1',[created.id])).rows).toHaveLength(0);
    }finally{await service.close();}
  });

  it('freezes contact-only approval without a resume, rejects pending jobs and preserves unknown on cancellation',async()=>{
    const {url,dir,pool}=await fixture();const service=new CareerService({...apiConfig(),DATABASE_URL:url,CAREER_LOCAL_DATA_DIR:dir,BOSS_AUTOMATION:'contact'});
    const owner=crypto.randomUUID();
    const policy={roleTargets:['fullstack'],cities:['广州'],salaryUpperMinCnyMonthly:18000,preferAiApplication:false,companyBlacklistKeywords:[]};
    try{
      const created=await service.createTask(owner,{mode:'preview',requestId:crypto.randomUUID(),policy});
      await pool.query("UPDATE app_career_work SET status='completed' WHERE task_id=$1",[created.id]);await service.store.setTaskState(created.id,{phase:'review'});
      const task=await service.store.getTask(owner,created.id);if(!task)throw Error('MISSING_FIXTURE_TASK');
      const seed=async(id:string,direct:boolean)=>{
        const observed={site:'boss' as const,sitePostingId:id,url:`https://example.test/job_detail/${id}.html`,title:'全栈工程师',company:'合成科技',location:'广州',salaryRaw:'18-25K',jdText:'开发 React 与 NestJS 全栈应用，负责测试与部署。',companyProfileText:direct?'公司直招':'未说明雇佣关系',identitySource:'detail_link' as const,nativeFilterEvidence:{searchKey:'fixture',controls:[{label:'city',selected:'广州',url:'https://example.test'}]}};
        const postingId=await service.store.upsertPosting(owner,observed),idLocal=crypto.randomUUID();const decision=evaluatePosting({policy:task.policy,posting:observed});
        await service.store.upsertTaskPosting(owner,{id:idLocal,taskId:task.id,postingId,observed,snapshotHash:digest(observed),disposition:decision.disposition,decision,match:null,greeting:null,existingRevision:null});
        return{id:idLocal,postingId,hash:digest(observed)};
      };
      const eligible=await seed('eligible-contact',true),pending=await seed('pending-contact',false);
      await service.store.writeSession(owner,{state:'ready',engine:'patchright',accountMarker:null,reason:null});
      const command={requestId:crypto.randomUUID(),expectedTaskRevision:task.revision,items:[{taskPostingId:eligible.id,snapshotHash:eligible.hash}]};
      await expect(service.approveContacts(owner,task.id,{...command,items:[{taskPostingId:pending.id,snapshotHash:pending.hash}]})).rejects.toThrow('仅已通过筛选');
      await expect(service.approveContacts(crypto.randomUUID(),task.id,command)).rejects.toThrow('TASK_NOT_FOUND');
      await expect(service.approveContacts(owner,task.id,{...command,items:[{taskPostingId:eligible.id,snapshotHash:'f'.repeat(64)}]})).rejects.toThrow('岗位快照已更新');
      const approved=await service.approveContacts(owner,task.id,command);expect(approved.contacts).toHaveLength(1);expect(approved.contacts[0]?.mode).toBe('site_preset');
      expect((await service.approveContacts(owner,task.id,command)).approvalId).toBe(approved.approvalId);
      await expect(service.patchPosting(owner,task.id,eligible.id,{requestId:crypto.randomUUID(),expectedRevision:0,ownerReview:{decision:'excluded',note:'',source:''}})).rejects.toThrow('不能修改');
      const unrelated=crypto.randomUUID();await service.store.enqueueWork({id:unrelated,owner,kind:'delivery',requestHash:unrelated,payload:{action:'deliver'}});
      const work=await service.store.claimWork(['delivery'],120,'contact');if(!work)throw Error('NO_CONTACT_WORK');expect(work.payload.action).toBe('site_preset');
      expect(await service.store.claimWork(['delivery'],120,'contact')).toBeNull();
      const contact=await service.store.contact(owner,approved.contacts[0]!.id);if(!contact)throw Error('NO_CONTACT');
      expect(await service.store.beginContact({...work,lease_generation:work.lease_generation+1},contact)).toBe(false);
      expect(await service.store.beginContact(work,contact)).toBe(true);
      await service.cancelTask(owner,task.id);
      expect((await service.store.contact(owner,contact.id))?.state).toBe('unknown');
      expect(await service.store.settleContact(work,contact,{state:'confirmed',reason:null,evidence:[]})).toBe(false);
      expect(await service.store.applicationState(owner,eligible.postingId)).toBe('unknown');
      expect((await pool.query('SELECT id FROM app_career_preparations WHERE task_id=$1',[task.id])).rows).toEqual([]);
      expect((await pool.query("SELECT id FROM app_career_work WHERE task_id=$1 AND kind='delivery'",[task.id])).rows).toHaveLength(1);
    }finally{await service.close();}
  });

});
