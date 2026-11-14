import 'reflect-metadata';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BossInboxService} from '../apps/api/src/boss-inbox';
import {migrateSqlite} from '../packages/database/src/migrate';
import type {BossConversation} from '../packages/contracts/src/boss-inbox';
import {normalizeWorkspaceValue,isSensitiveWorkspaceKey} from '../packages/contracts/src/workspace';
let directory:string;let service:BossInboxService;
const owner=crypto.randomUUID(),stranger=crypto.randomUUID();
const snapshot:BossConversation={accountKey:'synthetic-account',conversationKey:'synthetic-chat',postingId:'synthetic-job',company:'合成测试公司',title:'全栈工程师',jdText:'负责 React 与 NestJS 业务开发，设计可靠接口并进行自动化测试。',postingUrl:null,exchangeEvidence:'已交换简历',sourceUrl:'https://www.zhipin.com/web/geek/chat',observedAt:new Date().toISOString(),scope:'visible_window',messages:[{sourceId:'msg-1',direction:'recruiter',text:'请准备项目架构与自动化测试的案例。',timeLabel:'今天 10:00'}]};
beforeAll(async()=>{directory=await mkdtemp(join(tmpdir(),'boss-inbox-'));const DATABASE_URL=`file:${directory}/app.sqlite`;await migrateSqlite(DATABASE_URL,'app');service=new BossInboxService({DATABASE_URL,BOSS_AUTOMATION:'manual'});});
afterAll(async()=>{await service?.onModuleDestroy();if(directory)await rm(directory,{recursive:true,force:true});});
it('updates idempotently, keeps previous visible windows and isolates owners/accounts',async()=>{
  const first=await service.store.save(owner,snapshot);if(!first)throw Error('Missing row');
  const replay=await service.store.save(owner,{...snapshot,observedAt:new Date().toISOString()});expect(replay?.revision).toBe(1);
  const changed=await service.store.save(owner,{...snapshot,messages:[...snapshot.messages,{sourceId:'msg-2',direction:'self',text:'好的，我会准备。',timeLabel:null}]});expect(changed?.id).toBe(first.id);expect(changed?.revision).toBe(2);
  expect(await service.store.snapshots(owner,first.id)).toHaveLength(2);
  expect(await service.store.get(stranger,first.id)).toBeNull();expect(await service.store.list(stranger)).toEqual([]);expect(await service.store.snapshots(stranger,first.id)).toEqual([]);
  expect(await service.store.save(owner,{...snapshot,accountKey:'different-account'})).not.toMatchObject({id:first.id});
  expect(await service.store.updateJd(owner,first.id,1,'这是一份足够长的手动补充岗位说明，明确原文来源。')).toBeNull();
  const manual=await service.store.updateJd(owner,first.id,2,'这是一份足够长的手动补充岗位说明，明确原文来源。');expect(manual?.manualJd).toContain('手动补充');expect(manual?.snapshot.jdText).toBe(snapshot.jdText);
  await expect(service.remove(stranger,first.id,3)).rejects.toThrow();
  await expect(service.remove(owner,first.id,2)).rejects.toThrow();
  await service.remove(owner,first.id,3);expect(await service.store.snapshots(owner,first.id)).toEqual([]);
});
it('uses durable read-only session work and fences cancelled, stale and changed-session results',async()=>{
  await expect(service.sync(owner,crypto.randomUUID())).rejects.toThrow();
  await service.career.writeSession(owner,{state:'ready',humanWindow:'open',accountMarker:'synthetic-account'});
  const id=crypto.randomUUID();const job=await service.sync(owner,id,'first_ten');
  await expect(service.sync(owner,id,'current')).rejects.toThrow('不能更改同步范围');
  const payload=await service.database.pool.query('SELECT payload FROM app_career_work WHERE id=$1',[id]);expect(payload.rows[0]?.payload).toMatchObject({inboxMode:'first_ten'});expect(job.status).toBe('queued');expect((await service.sync(owner,id,'first_ten')).id).toBe(id);
  await expect(service.sync(owner,crypto.randomUUID())).rejects.toThrow('已有');
  await expect(service.job(stranger,id)).rejects.toThrow();
  const work=await service.career.claimWork(['session'],120,'manual');if(!work)throw Error('Missing work');
  const session=await service.career.session(owner);if(!session)throw Error('Missing session');
  await service.cancel(owner,id);
  await expect(service.store.save(owner,snapshot,{id,leaseGeneration:work.lease_generation,sessionGeneration:session.profile_generation})).rejects.toThrow('AUTHORITY_CHANGED');
  expect((await service.job(owner,id)).status).toBe('cancelled');
  const nextId=crypto.randomUUID();await service.sync(owner,nextId);const next=await service.career.claimWork(['session'],120,'manual');if(!next)throw Error('Missing next work');
  await service.career.writeSession(owner,{profileGeneration:session.profile_generation+1});
  await expect(service.store.save(owner,snapshot,{id:nextId,leaseGeneration:next.lease_generation,sessionGeneration:session.profile_generation})).rejects.toThrow('AUTHORITY_CHANGED');
  await service.cancel(owner,nextId);
});
it('paused mode rejects sync without opening a browser',async()=>{
  const paused=new BossInboxService({DATABASE_URL:`file:${directory}/app.sqlite`,BOSS_AUTOMATION:'paused'});
  try{await expect(paused.sync(owner,crypto.randomUUID())).rejects.toThrow('暂停');}finally{await paused.onModuleDestroy();}
});
it('validates recoverable job/source references as private workspace data',()=>{
  const id=crypto.randomUUID();expect(normalizeWorkspaceValue('boss-inbox-job',id)).toBe(id);
  expect(isSensitiveWorkspaceKey('boss-inbox-job')).toBe(true);
  expect(()=>normalizeWorkspaceValue('boss-inbox-job','not-an-id')).toThrow();
  const source={conversationId:id,snapshotHash:'a'.repeat(64)};
  expect(JSON.parse(normalizeWorkspaceValue('boss-interview-origin',JSON.stringify(source)))).toEqual(source);
});
