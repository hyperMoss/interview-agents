import type { Pool,PoolClient } from 'pg';
import { BadRequestException,ConflictException,NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { bankDraftSchema,bankQuestionSchema,leetcodeImportSchema,leetcodeBatchSchema,type BankDraft,type BankQuestion } from '../../../packages/contracts/src/bank';
import type { savePreparationSchema } from '../../../packages/contracts/src/preparation';

const rowSchema=z.object({id:z.uuid(),owner:z.string().nullable(),source:z.enum(['builtin','custom','leetcode']),source_url:z.string().nullable(),payload:bankDraftSchema,revision:z.number(),created_at:z.date()});
const seeds:Array<BankDraft & {key:number}>=[
  {key:1,title:'自我介绍与岗位匹配',content:'请结合真实经历介绍自己。你与目标岗位最相关的项目、职责和可验证的结果是什么？',category:'intro',difficulty:'easy',roleFamilies:['general'],tags:['开场'],expectedAnswer:'区分事实与计划，说明自己的具体职责。'},
  {key:2,title:'你的反问',content:'你希望进一步了解目标岗位的哪些职责、团队协作方式或成长机会？请提出问题，并说明它为何影响你的选择。',category:'reverse',difficulty:'easy',roleFamilies:['general'],tags:['反问'],expectedAnswer:'围绕岗位信息与双向匹配提出具体问题。'},
  {key:3,title:'接口重试的取舍',content:'一个创建订单接口偶尔超时。客户端准备自动重试，你会如何设计幂等和状态查询，避免重复订单？',category:'technical',difficulty:'medium',roleFamilies:['backend','fullstack','general'],tags:['接口','幂等'],expectedAnswer:'讨论业务幂等键、并发唯一约束、失败窗口与状态查询。'},
  {key:4,title:'页面状态与请求竞争',content:'用户快速切换搜索条件时，旧请求在新请求之后返回。你会怎样保证页面展示正确的结果？',category:'technical',difficulty:'easy',roleFamilies:['frontend','fullstack','general'],tags:['异步','状态'],expectedAnswer:'区分请求标识，取消请求并拒绝旧结果覆盖。'},
  {key:5,title:'系统容量与证据',content:'业务访问量预计增长十倍。请选择一个瓶颈，说明容量推算、验证实验、退化方案及上线判断依据。',category:'technical',difficulty:'hard',roleFamilies:['general'],tags:['容量','验证'],expectedAnswer:'使用可验证的流量、资源与延迟假设，并考虑故障和降级。'},
  {key:6,title:'你的协作行动',content:'请描述一次跨团队协作。目标、分歧、你采取的行动和可以核对的结果分别是什么？',category:'behavioral',difficulty:'easy',roleFamilies:['general'],tags:['协作'],expectedAnswer:'区分个人职责和团队结果，描述具体行动。'},
  {key:7,title:'反馈与改进',content:'请描述一次收到反馈后调整工作方法的经历。你如何判断改进是否有效？',category:'behavioral',difficulty:'medium',roleFamilies:['general'],tags:['成长'],expectedAnswer:'给出反馈内容、具体改进和验证结果。'},
  {key:8,title:'冲突与责任',content:'项目目标和可用资源存在明显冲突。你如何沟通取舍、承担责任，并推动团队形成可执行的计划？',category:'behavioral',difficulty:'hard',roleFamilies:['general'],tags:['责任','决策'],expectedAnswer:'说明约束、共同目标、决策依据和跟踪机制。'},
  {key:9,title:'日志连续去重',content:'编写函数，删除字符串日志数组中相邻的重复项，保持原有顺序。输入 ["a","a","b","a"] 应返回 ["a","b","a"]。说明空数组和时间复杂度。',category:'coding',difficulty:'easy',roleFamilies:['general'],tags:['数组'],expectedAnswer:'一次遍历，当前项不同于结果最后一项时追加，时间 O(n)。'},
  {key:10,title:'任务依赖的执行顺序',content:'给定任务编号和依赖边，编写函数返回合法执行顺序。如果依赖形成环，返回明确的失败结果。说明独立任务、重复依赖和复杂度。',category:'coding',difficulty:'medium',roleFamilies:['backend','fullstack','data','general'],tags:['图','任务'],expectedAnswer:'拓扑排序，入度和队列，处理节点数不足时识别环。'},
  {key:11,title:'滑动窗口告警',content:'事件按时间排序到达。编写函数判断任意连续 60 秒窗口内是否至少出现 K 条失败事件。说明时间边界、相同时间戳和流式内存成本。',category:'coding',difficulty:'hard',roleFamilies:['general'],tags:['窗口','流式'],expectedAnswer:'双指针或队列，明确闭开边界并维护窗口计数。'},
];
export class QuestionBank {
  constructor(readonly pool:Pool,readonly fetcher:typeof fetch=fetch){}
  private view(raw:unknown){const row=rowSchema.parse(raw);return bankQuestionSchema.parse({...row.payload,id:row.id,source:row.source,sourceUrl:row.source_url,editable:row.owner!==null,createdAt:row.created_at.toISOString(),revision:row.revision});}
  private async seed(){for(const {key,...draft}of seeds){const id=`10000000-0000-4000-8000-${String(key).padStart(12,'0')}`;await this.pool.query("INSERT INTO app.bank_questions(id,owner,source,payload) VALUES($1,NULL,'builtin',$2) ON CONFLICT(id) DO NOTHING",[id,JSON.stringify(draft)]);}}
  async list(owner:string){await this.seed();const result=await this.pool.query('SELECT * FROM app.bank_questions WHERE owner=$1 OR owner IS NULL ORDER BY created_at,id LIMIT 500',[owner]);return result.rows.map(row=>this.view(row));}
  async snapshot(owner:string,ids:string[]){const rows=await this.list(owner);if(!ids.length)return rows;const chosen=rows.filter(q=>ids.includes(q.id));if(new Set(ids).size!==chosen.length)throw new NotFoundException('题库中包含不存在或不属于当前身份的题目。');return [...chosen,...rows.filter(q=>q.source==='builtin'&&(q.category==='intro'||q.category==='reverse')&&!ids.includes(q.id))];}
  private async withOwnerTransaction<T>(owner:string,action:(client:PoolClient)=>Promise<T>){
    await this.seed();const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`bank-owner:${owner}`]);const result=await action(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async ensureCapacity(client:PoolClient,owner:string){const result=await client.query('SELECT count(*)::int AS total FROM app.bank_questions WHERE owner=$1 OR owner IS NULL',[owner]);if(result.rows[0].total>=500)throw new ConflictException('题库最多 500 题，包含内置题。请删除不需要的题目后再创建或导入。');}
  async create(owner:string,id:string,draft:BankDraft){return this.withOwnerTransaction(owner,client=>this.createInTransaction(client,owner,id,draft));}
  async createBatch(owner:string,batch:z.infer<typeof savePreparationSchema>){return this.withOwnerTransaction(owner,async client=>{
    const saved:BankQuestion[]=[];
    for(const {requestId,draft} of batch.questions)saved.push(await this.createInTransaction(client,owner,requestId,draft));
    return saved;
  });}
  private async createInTransaction(client:PoolClient,owner:string,id:string,draft:BankDraft){
    let result=await client.query('SELECT * FROM app.bank_questions WHERE id=$1 AND owner=$2',[id,owner]);
    if(!result.rows[0]){await this.ensureCapacity(client,owner);await client.query("INSERT INTO app.bank_questions(id,owner,source,payload) VALUES($1,$2,'custom',$3) ON CONFLICT(id) DO NOTHING",[id,owner,JSON.stringify(draft)]);result=await client.query('SELECT * FROM app.bank_questions WHERE id=$1 AND owner=$2',[id,owner]);}
    if(!result.rows[0])throw new ConflictException('题目创建键已使用。');const row=rowSchema.parse(result.rows[0]);if(JSON.stringify(row.payload)!==JSON.stringify(draft))throw new ConflictException('同一请求键对应不同题目。');return this.view(row);
  }
  async update(owner:string,id:string,revision:number,draft:BankDraft){const result=await this.pool.query('UPDATE app.bank_questions SET payload=$4,revision=revision+1 WHERE id=$1 AND owner=$2 AND revision=$3 RETURNING *',[id,owner,revision,JSON.stringify(draft)]);if(result.rows[0])return this.view(result.rows[0]);const existing=await this.pool.query('SELECT 1 FROM app.bank_questions WHERE id=$1 AND owner=$2',[id,owner]);if(!existing.rows.length)throw new NotFoundException('题目不存在。');throw new ConflictException('题目已改变，请重新读取后编辑。');}
  async remove(owner:string,id:string){const result=await this.pool.query('DELETE FROM app.bank_questions WHERE id=$1 AND owner=$2',[id,owner]);if(!result.rowCount)throw new NotFoundException('题目不存在或不可删除。');return{deleted:true};}
  private async insertImported(client:PoolClient,owner:string,slug:string,region:'cn'|'com',draft:BankDraft){
    const existing=await client.query('SELECT 1 FROM app.bank_questions WHERE owner=$1 AND source_key=$2',[owner,`${region}:${slug}`]);if(existing.rowCount)return 0;
    await this.ensureCapacity(client,owner);const url=`https://leetcode.${region}/problems/${slug}/`;const result=await client.query("INSERT INTO app.bank_questions(id,owner,source,source_key,source_url,payload) VALUES($1,$2,'leetcode',$3,$4,$5) ON CONFLICT(owner,source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id",[crypto.randomUUID(),owner,`${region}:${slug}`,url,JSON.stringify(draft)]);return result.rowCount??0;
  }
  async importBatch(owner:string,raw:unknown){const batch=leetcodeBatchSchema.parse(raw);return this.withOwnerTransaction(owner,async client=>{let imported=0;for(const {slug,region,...draft}of batch.questions)imported+=await this.insertImported(client,owner,slug,region,draft);return{imported,skipped:batch.questions.length-imported};});}
  async importLeetCode(owner:string,raw:unknown){
    const {url}=leetcodeImportSchema.parse(raw);const parsed=new URL(url),slug=parsed.pathname.split('/')[2];if(!slug)throw new BadRequestException('题目链接无效。');
    try{
      const response=await this.fetcher(`https://${parsed.hostname}/graphql/`,{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(12000),body:JSON.stringify({query:'query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { title translatedTitle content translatedContent difficulty isPaidOnly topicTags { name } } }',variables:{titleSlug:slug}})});
      if(!response.ok)throw new Error();const text=await response.text();if(text.length>500000)throw new Error();
      const data=z.object({data:z.object({question:z.object({title:z.string(),translatedTitle:z.string().nullable().optional(),content:z.string().nullable(),translatedContent:z.string().nullable().optional(),difficulty:z.enum(['Easy','Medium','Hard']),isPaidOnly:z.boolean(),topicTags:z.array(z.object({name:z.string()})).default([])})})}).parse(JSON.parse(text));const q=data.data.question;if(q.isPaidOnly)throw new Error();
      const difficulty={Easy:'easy',Medium:'medium',Hard:'hard'}[q.difficulty];const draft=bankDraftSchema.parse({title:q.translatedTitle||q.title,content:htmlText(q.translatedContent||q.content||''),category:'coding',difficulty,roleFamilies:['general'],tags:q.topicTags.map(t=>t.name).slice(0,12),expectedAnswer:''});
      const imported=await this.withOwnerTransaction(owner,client=>this.insertImported(client,owner,slug,parsed.hostname==='leetcode.cn'?'cn':'com',draft));return{imported,skipped:1-imported};
    }catch(error){if(error instanceof ConflictException)throw error;throw new BadRequestException('无法读取公开 LeetCode 题目。可以改用导出的 JSON 题库导入。');}
  }
}
export function htmlText(value:string){return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|li|pre|div)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,entity=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]??entity)).replace(/&#(\d+);/g,(whole,number)=>{const code=Number(number);return code>0&&code<=0x10ffff?String.fromCodePoint(code):whole;}).trim();}
