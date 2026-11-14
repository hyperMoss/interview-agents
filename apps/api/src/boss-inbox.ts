import { Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Req, UseFilters } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { ApiConfig } from '../../../packages/config/src/index';
import { openDatabase } from '../../../packages/database/src/client';
import { CareerStore } from '../../../packages/career/src/store';
import { BossInboxStore } from '../../../packages/career/src/inbox';
import { bossInboxJobSchema, bossInboxSyncSchema, bossInboxSyncModeSchema } from '../../../packages/contracts/src/boss-inbox';
import { CareerErrorFilter } from './errors';
export const BOSS_INBOX='BOSS_INBOX';
export class BossInboxService {
  readonly database; readonly store; readonly career;
  constructor(readonly config:Pick<ApiConfig,'DATABASE_URL'|'BOSS_AUTOMATION'>) {
    this.database=openDatabase(config.DATABASE_URL);this.store=new BossInboxStore(this.database.pool);this.career=new CareerStore(this.database.pool);
  }
  async sync(owner:string,requestId:string,mode:z.infer<typeof bossInboxSyncModeSchema>='current') {
    bossInboxSyncModeSchema.parse(mode);
    if(this.config.BOSS_AUTOMATION==='paused')throw new ConflictException('BOSS 已暂停，请人工处理限制后再开启只读会话操作。');
    const previous=await this.database.pool.query("SELECT payload FROM app_career_work WHERE owner=$1 AND id=$2 AND kind='session' AND payload->>'syncConversation'=1",[owner,requestId]);
    if(previous.rows[0]){
      const prior=z.object({payload:z.object({inboxMode:bossInboxSyncModeSchema.default('current')})}).parse(previous.rows[0]);
      if(prior.payload.inboxMode!==mode)throw new ConflictException('同一同步请求不能更改同步范围。');
      return this.job(owner,requestId);
    }
    const session=await this.career.session(owner);
    if(!session||session.state!=='ready'||session.human_window!=='open')throw new ConflictException('请在 BOSS 求职中打开专用窗口，完成登录与会话检查，再选中已交换简历的聊天。');
    const active=await this.database.pool.query("SELECT id FROM app_career_work WHERE owner=$1 AND kind='session' AND payload->>'syncConversation'=1 AND status IN ('queued','processing')",[owner]);
    if(active.rows.length)throw new ConflictException('已有会话同步在执行，请等待完成或取消。');
    try{await this.career.enqueueWork({id:requestId,owner,kind:'session',requestHash:`inbox:${owner}:${requestId}`,payload:{action:'check',syncConversation:true,inboxMode:mode,sessionGeneration:session.profile_generation}});}
    catch(error){if(error instanceof Error&&/UNIQUE constraint failed: app_career_work\.(owner|id)/.test(error.message))throw new ConflictException('同步请求已存在或有其他同步正在执行，请重新读取状态。');throw error;}
    return this.job(owner,requestId);
  }
  async job(owner:string,id:string) {
    const result=await this.database.pool.query("SELECT id,status,failure,payload FROM app_career_work WHERE owner=$1 AND id=$2 AND kind='session' AND payload->>'syncConversation'=1",[owner,id]);
    if(!result.rows[0])throw new NotFoundException('同步记录不存在。');
    const row=z.object({payload:z.object({inboxProgress:bossInboxJobSchema.shape.progress.optional()})}).parse(result.rows[0]);
    return bossInboxJobSchema.parse({...result.rows[0],progress:row.payload.inboxProgress??null});
  }
  async cancel(owner:string,id:string) {
    await this.job(owner,id);
    await this.database.pool.query("UPDATE app_career_work SET status='cancelled',lease_until=NULL WHERE owner=$1 AND id=$2 AND status IN ('queued','processing')",[owner,id]);
    return this.job(owner,id);
  }
  async remove(owner:string,id:string,revision:number) {
    if(!await this.store.get(owner,id))throw new NotFoundException('会话不存在。');
    const client=await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE app_career_work SET status='cancelled',lease_until=NULL WHERE owner=$1 AND payload->>'syncConversation'=1 AND status IN ('queued','processing')",[owner]);
      const result=await client.query('DELETE FROM app_boss_conversations WHERE owner=$1 AND id=$2 AND revision=$3 RETURNING id',[owner,id,revision]);
      if(!result.rowCount)throw new ConflictException('会话已更新，请重新读取后确认删除。');
      await client.query('COMMIT'); return {deleted:true};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async onModuleDestroy(){await this.database.pool.end();}
}
const owner=(req:Request)=>z.uuid().parse(req.headers['x-owner-id']);
const revisionSchema=z.strictObject({revision:z.number().int().positive()});
@Controller('api/v1/boss-conversations')
@UseFilters(new CareerErrorFilter())
export class BossInboxController {
  constructor(@Inject(BOSS_INBOX) readonly service:BossInboxService){}
  @Get() list(@Req() req:Request){return this.service.store.list(owner(req));}
  @Post('sync') sync(@Req() req:Request,@Body() body:unknown){const input=bossInboxSyncSchema.parse(body);return this.service.sync(owner(req),input.requestId,input.mode);}
  @Get('sync/:id') job(@Req() req:Request,@Param('id') id:string){return this.service.job(owner(req),z.uuid().parse(id));}
  @Post('sync/:id/cancel') cancel(@Req() req:Request,@Param('id') id:string){return this.service.cancel(owner(req),z.uuid().parse(id));}
  @Get(':id/snapshots') snapshots(@Req() req:Request,@Param('id') id:string){return this.service.store.snapshots(owner(req),z.uuid().parse(id));}
  @Get(':id/snapshots/:hash') async snapshot(@Req() req:Request,@Param('id') id:string,@Param('hash') hash:string){const result=await this.service.store.snapshot(owner(req),z.uuid().parse(id),z.string().regex(/^[a-f0-9]{64}$/).parse(hash));if(!result)throw new NotFoundException('会话快照不存在。');return result;}
  @Get(':id') async get(@Req() req:Request,@Param('id') id:string){const result=await this.service.store.get(owner(req),z.uuid().parse(id));if(!result)throw new NotFoundException('会话不存在。');return result;}
  @Patch(':id/jd') async jd(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){
    const input=revisionSchema.extend({jd:z.string().trim().min(20).max(12000)}).parse(body);
    if(!await this.service.store.get(owner(req),z.uuid().parse(id)))throw new NotFoundException('会话不存在。');
    const result=await this.service.store.updateJd(owner(req),id,input.revision,input.jd);
    if(!result)throw new ConflictException('会话已更新，请重新读取。');return result;
  }
  @Delete(':id') remove(@Req() req:Request,@Param('id') id:string,@Body() body:unknown){return this.service.remove(owner(req),z.uuid().parse(id),revisionSchema.parse(body).revision);}
}
