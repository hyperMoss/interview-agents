import { createServer,type Server } from 'node:http';
import { z } from 'zod';
import { createInterviewSchema,questionSchema } from '../packages/contracts/src/index';
import { planSchema } from '../packages/contracts/src/planning';
export async function startProviderFixture(){
  const calls:Array<{model:string;authorization:string;content:string}>=[];
  const state={failure:false,badEvidence:false};
  const server=createServer(async(req,res)=>{
    res.setHeader('connection','close');
    if(req.url?.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'coach-alpha'},{id:'coach-beta'},{id:'coach-alpha'}]}));return;}
    if(state.failure){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture unavailable'}}));return;}
    let text='';for await(const chunk of req)text+=String(chunk);
    const body=z.object({model:z.string(),messages:z.array(z.object({role:z.string(),content:z.string()})),max_tokens:z.number().optional()}).parse(JSON.parse(text));
    const content=body.messages.findLast(message=>message.role==='user')?.content??'';
    calls.push({model:body.model,authorization:req.headers.authorization??'',content});
    const credentials:Record<string,string>={'coach-alpha':'fixture-alpha-key','coach-beta':'fixture-beta-key'};
    if(req.headers.authorization!==`Bearer ${credentials[body.model]}`){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture authentication failed'}}));return;}
    let output:string;
    if(body.max_tokens===16)output='OK';else{
      const context=z.object({input:createInterviewSchema,completedCount:z.number(),current:z.object({question:questionSchema,answer:z.string()}).nullable(),plan:planSchema.optional()}).parse(JSON.parse(content));
      const answered=context.completedCount+(context.current?1:0);
      const applicable=context.plan&&context.plan.options.round!=='hr'&&context.plan.options.roleType==='technical'&&['qa','coding'].includes(context.current?.question.stage??'qa');
      output=JSON.stringify({modelMode:'live',question:answered>=context.input.questionCount?null:{text:`${body.model}：请结合「${context.input.role}」说明一个具体项目决策。`,competency:'技术决策',kind:context.current?'technical':'opening'},assessment:context.current?{score:1,evidence:state.badEvidence?'不存在的回答证据':context.current.answer.slice(0,80),feedback:'结合真实行动与结果说明技术取舍。',strengths:['说明了具体行动。'],improvements:['补充替代方案的验证过程。'],dimensions:{relevance:80,depth:75,clarity:85,evidence:70},...(context.plan?{evaluation:{technical:applicable?75:null,communication:85,overallQuality:70,rationale:{technical:applicable?'结合具体行动说明技术取舍。':null,communication:'回答说明了实际行动。',overallQuality:'回答提到了测试与验证。'}}}:{})}:null});
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:output},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
  });
  const origin=await listen(server);return{baseUrl:`${origin}/v1`,calls,state,close:()=>close(server)};
}
export async function serveFixture(fetchHandler:(request:Request)=>Response|Promise<Response>){
  const server=createServer(async(req,res)=>{
    const headers=new Headers();for(const [key,value]of Object.entries(req.headers)){if(Array.isArray(value))for(const item of value)headers.append(key,item);else if(value!==undefined)headers.set(key,value);}
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
    const method=req.method??'GET';const request=new Request(`http://localhost${req.url??'/'}`,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
    try{const response=await fetchHandler(request);const outgoing:Record<string,string>={};response.headers.forEach((value,key)=>{outgoing[key]=value;});res.writeHead(response.status,outgoing);res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('{}');}
  });const origin=await listen(server);return{origin,close:()=>close(server)};
}
async function listen(server:Server){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');return `http://127.0.0.1:${address.port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
