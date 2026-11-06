import { createServer,type Server } from 'node:http';
import { z } from 'zod';
import { createInterviewSchema,questionSchema } from '../packages/contracts/src/index';
import { planSchema } from '../packages/contracts/src/planning';
import { preparationInputSchema } from '../packages/contracts/src/preparation';
import { demoPreparation } from '../apps/agent/src/preparation';
export async function startProviderFixture(){
  const calls:Array<{model:string;authorization:string;content:string}>=[];
  const state={failure:false,badEvidence:false,badPreparationEvidence:false,badCareerEvidence:false,failCareer:false,rateLimited:false,
    /** Synthetic-only: lets a test choose its own bearer key instead of a fixture credential. */
    acceptAnyKey:false,
    /** Synthetic-only: holds the career match model response so a test can act while it is in flight. */
    holdCareerMatch:null as Promise<void>|null};
  const server=createServer(async(req,res)=>{
    res.setHeader('connection','close');
    if(req.url?.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'coach-alpha'},{id:'coach-beta'},{id:'coach-alpha'}]}));return;}
    if(state.rateLimited){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture rate limit'}}));return;}
    if(state.failure){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture unavailable'}}));return;}
    let text='';for await(const chunk of req)text+=String(chunk);
    const body=z.object({model:z.string(),messages:z.array(z.object({role:z.string(),content:z.string()})),max_tokens:z.number().optional()}).parse(JSON.parse(text));
    const content=body.messages.findLast(message=>message.role==='user')?.content??'';
    calls.push({model:body.model,authorization:req.headers.authorization??'',content});
    const credentials:Record<string,string>={'coach-alpha':'fixture-alpha-key','coach-beta':'fixture-beta-key'};
    if(!state.acceptAnyKey&&req.headers.authorization!==`Bearer ${credentials[body.model]}`){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture authentication failed'}}));return;}
    let output:string;
    const preparation=z.object({kind:z.literal('jd-preparation'),input:preparationInputSchema}).safeParse(JSON.parse(content.startsWith('{')?content:'null'));
    const careerMatch=z.object({kind:z.literal('career-match'),jobDescription:z.string(),resume:z.string()}).safeParse(JSON.parse(content.startsWith('{')?content:'null'));
    const careerPreparation=z.object({kind:z.literal('career-preparation'),jobDescription:z.string(),resume:z.string()}).safeParse(JSON.parse(content.startsWith('{')?content:'null'));
    if(state.failCareer&&(careerMatch.success||careerPreparation.success)){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture career model unavailable'}}));return;}
    if(careerMatch.success&&state.holdCareerMatch)await state.holdCareerMatch;
    if(body.max_tokens===16)output='OK';else if(careerMatch.success){
      const jdQuotes=sentences(careerMatch.data.jobDescription);
      const resumeQuotes=sentences(careerMatch.data.resume);
      const jd1=state.badCareerEvidence?'不存在的岗位要求原文':(jdQuotes[0]??careerMatch.data.jobDescription.slice(0,40));
      const jd2=jdQuotes[1]??jd1;
      const resume1=resumeQuotes[0]??careerMatch.data.resume.slice(0,40);
      output=JSON.stringify({
        assessments:[
          {kind:'supported',competency:'核心技术栈',priority:'required',jdQuotes:[jd1],resumeQuotes:[resume1],rationale:'简历与岗位描述提到了同一技术方向的职责。'},
          {kind:'gap',competency:'岗位加分项',priority:'preferred',jdQuotes:[jd2],explanation:'简历中没有可核对的该加分项证据。'},
        ],
        strengths:['技术方向与岗位一致'],gaps:['加分项缺少证据'],uncertainties:['未说明团队规模'],
        aiApplication:{value:'yes',jdQuotes:[jd1]},
        greeting:{text:`您好，我在简历中说明了${resume1.slice(0,18)}的经历，希望进一步沟通这个岗位的职责与协作方式。`,claims:[{claim:resume1.slice(0,20),resumeQuotes:[resume1],jdQuotes:[jd1]}],uncertainties:[]},
      });
    }else if(careerPreparation.success){
      const jdQuotes=sentences(careerPreparation.data.jobDescription);
      const resumeQuotes=sentences(careerPreparation.data.resume);
      const jd1=state.badCareerEvidence?'不存在的岗位要求原文':(jdQuotes[0]??careerPreparation.data.jobDescription.slice(0,40));
      const jd2=jdQuotes[1]??jd1;
      const resume1=resumeQuotes[0]??careerPreparation.data.resume.slice(0,40);
      output=JSON.stringify({
        requirements:[{competency:'核心技术栈',priority:'required',quote:jd1},{competency:'岗位加分项',priority:'preferred',quote:jd2}],
        questions:Array.from({length:10},(_,index)=>({
          title:`备题 ${index+1}`,
          text:`第 ${index+1} 题：围绕岗位要求说明具体做法、取舍与验证方式。`,
          requirementIndex:index%2,
          purpose:index<4?'jd_skill':index<8?'resume_project':'skill_gap',
          jdQuotes:[jd1],
          basis:index>=8?{kind:'gap',missingCompetency:'岗位加分项'}:{kind:'resume_evidence',resumeQuotes:[resume1]},
          assessmentPoints:['说明约束与取舍','给出可以验证的证据'],
          referenceAnswerGuidance:['解释边界条件','说明如何度量效果'],
        })),
        uncertainties:['简历未说明该加分项的深度'],
      });
    }else if(preparation.success){
      const result=demoPreparation(preparation.data.input);
      if(state.badPreparationEvidence&&result.requirements[0])result.requirements[0].quote='这段岗位要求不存在于 JD 中';
      output=JSON.stringify(result);
    }else{
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
function sentences(text:string){
  return text.split(/[。；;\n]/).map(value=>value.trim()).filter(value=>value.length>=6).slice(0,4);
}
async function listen(server:Server){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');return `http://127.0.0.1:${address.port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
