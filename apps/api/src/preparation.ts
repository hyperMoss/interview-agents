import {ConflictException,HttpException,NotFoundException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ApiConfig} from '../../../packages/config/src/index';
import type {Pool} from '../../../packages/database/src/sqlite';
import {preparationResultSchema,PREPARATION_TIMEOUT_MS,type PreparationPdf} from '../../../packages/contracts/src/preparation';
import {preparationPdfHtml} from '../../../packages/interview/src/preparation-pdf';
import {renderLocalPdf} from './pdf';
import {preparationGenerateCommandSchema,preparationHistorySchema,preparationHistoryPageSchema,preparationHistoryQuerySchema,preparationHistoryRetrySchema,type PreparationHistory} from '../../../packages/contracts/src/preparation-history';
import {RuntimeGateway} from './runtime-gateway';
import {validatePreparation} from '../../../packages/interview/src/preparation';

export class PreparationGateway extends RuntimeGateway {
  constructor(config:ApiConfig,readonly pool:Pool){super(config);}
  async pdf(input:PreparationPdf){
    try { validatePreparation(input.input,{requirements:input.result.requirements,questions:input.result.questions}); }
    catch { throw new HttpException('题单结构或 JD 依据无效，请重新载入后导出。',400); }
    return {bytes:await renderLocalPdf(preparationPdfHtml(input),true),filename:`${input.input.role}备题单.pdf`};
  }
  async historyPdf(owner:string,id:string){
    const record=await this.get(owner,id);
    if(record.outcome.status!=='ready')throw new ConflictException('该备题记录尚未生成成功，无法导出 PDF。');
    return this.pdf({input:record.input,result:record.outcome.result});
  }
  private async expire(owner:string){
    const now=new Date().toISOString(),cutoff=new Date(Date.now()-PREPARATION_TIMEOUT_MS-10000).toISOString();
    await this.pool.query("UPDATE app_preparation_history SET payload=json_set(payload,'$.outcome',json($1),'$.updatedAt',$2),updated_at=$2 WHERE owner=$3 AND payload->'outcome'->>'status'='generating' AND created_at<$4",[JSON.stringify({status:'failed',code:'PREPARATION_INTERRUPTED',message:'备题生成已中断，原输入已保留，可重新选择模型后重试。'}),now,owner,cutoff]);
  }
  async get(owner:string,id:string):Promise<PreparationHistory>{
    await this.expire(owner);
    const row=await this.pool.query('SELECT payload FROM app_preparation_history WHERE owner=$1 AND id=$2',[owner,id]);
    if(!row.rows[0])throw new NotFoundException('备题记录不存在。');
    return preparationHistorySchema.parse(row.rows[0].payload);
  }
  async history(owner:string,query:z.infer<typeof preparationHistoryQuerySchema>){
    await this.expire(owner);
    const before=query.before?await this.get(owner,query.before):null;
    const rows=await this.pool.query("SELECT payload FROM app_preparation_history WHERE owner=$1 AND ($2 IS NULL OR (created_at,id)<($2,$3)) ORDER BY created_at DESC,id DESC LIMIT $4",[owner,before?.createdAt??null,before?.id??null,query.limit+1]);
    const records=rows.rows.map(row=>preparationHistorySchema.parse(row.payload));
    return preparationHistoryPageSchema.parse({items:records.slice(0,query.limit).map(row=>({id:row.id,parentId:row.parentId,role:row.input.role,questionCount:row.input.questionCount,createdAt:row.createdAt,status:row.outcome.status})),nextBefore:records.length>query.limit?records[query.limit-1]?.id??null:null});
  }
  async retry(owner:string,id:string,command:z.infer<typeof preparationHistoryRetrySchema>){
    const source=await this.get(owner,id);
    if(source.outcome.status==='generating')throw new ConflictException('该记录仍在生成，请等待完成后重试。');
    return this.run(owner,{requestId:command.requestId,input:source.input,modelConnectionId:command.modelConnectionId},source.id);
  }
  async generate(owner:string,request:z.infer<typeof preparationGenerateCommandSchema>){
    const record=await this.run(owner,request,null);
    if(record.outcome.status==='ready')return record.outcome.result;
    if(record.outcome.status==='generating')throw new ConflictException('该请求正在生成，请到备题历史查看进度。');
    throw new HttpException({code:record.outcome.code,message:record.outcome.message,historyId:record.id},record.outcome.httpStatus);
  }
  private async run(owner:string,request:z.infer<typeof preparationGenerateCommandSchema>,parentId:string|null){
    const id=request.requestId??randomUUID();
    const hash=createHash('sha256').update(JSON.stringify({input:request.input,modelConnectionId:request.modelConnectionId,parentId})).digest('hex');
    const now=new Date().toISOString();
    const record:PreparationHistory={id,parentId,input:request.input,modelConnectionId:request.modelConnectionId,createdAt:now,updatedAt:now,outcome:{status:'generating'}};
    const inserted=await this.pool.query('INSERT INTO app_preparation_history(id,owner,parent_id,request_hash,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(id) DO NOTHING RETURNING id',[id,owner,parentId,hash,JSON.stringify(record),now]);
    if(!inserted.rowCount){
      const prior=await this.pool.query('SELECT request_hash FROM app_preparation_history WHERE owner=$1 AND id=$2',[owner,id]);
      if(prior.rows[0]?.request_hash!==hash)throw new ConflictException('同一请求编号不能更改备题输入、模型或重试来源。');
      return this.get(owner,id);
    }
    let outcome:PreparationHistory['outcome'];
    try{
      const result=await this.forward('/preparations/generate',preparationResultSchema,'POST',{input:request.input,modelConnectionId:request.modelConnectionId,ownerId:owner},PREPARATION_TIMEOUT_MS+5000);
      validatePreparation(request.input,{requirements:result.requirements,questions:result.questions});
      outcome={status:'ready',result};
    }catch(error){
      const response=error instanceof HttpException?z.object({code:z.string().max(100),message:z.string().max(600)}).safeParse(error.getResponse()):null;
      outcome=response?.success?{status:'failed',...response.data,httpStatus:error instanceof HttpException?error.getStatus():502}:{status:'failed',code:'PREPARATION_INVALID_RESULT',message:'备题响应无效，输入已保留。请检查模型后重试。',httpStatus:502};
    }
    const updatedAt=new Date().toISOString();
    await this.pool.query("UPDATE app_preparation_history SET payload=$1,updated_at=$2 WHERE owner=$3 AND id=$4 AND payload->'outcome'->>'status'='generating'",[JSON.stringify({...record,updatedAt,outcome}),updatedAt,owner,id]);
    return this.get(owner,id);
  }
}
