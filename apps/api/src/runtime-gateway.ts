import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { ApiConfig } from '../../../packages/config/src/index';
export class RuntimeGateway {
  constructor(readonly config:ApiConfig){}
  protected async forward<T>(path:string,schema:z.ZodType<T>,method='GET',body?:unknown,timeoutMs=25000){
    let response:Response;
    try{response=await fetch(`${this.config.AGENT_URL}/internal/v1${path}`,{method,headers:{authorization:`Bearer ${this.config.INTERNAL_SERVICE_TOKEN}`,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});}
    catch{throw new HttpException({code:'MODEL_SERVICE_UNAVAILABLE',message:'Agent 服务连接失败，请检查服务后重试。'},503);}
    const data:unknown=await response.json().catch(()=>null);
    if(!response.ok){const error=z.object({error:z.string(),message:z.string().optional()}).safeParse(data);throw new HttpException({code:error.success?error.data.error:'MODEL_SERVICE_ERROR',message:error.success?error.data.message??'请求失败，请检查配置。':'请求失败，请稍后重试。'},response.status);}
    return schema.parse(data);
  }
}
