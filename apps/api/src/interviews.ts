import { createHash } from 'node:crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
import { ConflictException, NotFoundException,BadRequestException } from '@nestjs/common';
import { type InterviewInput, type Session,type RuntimeRequest, answerSchema, sessionSchema,retrySchema } from '../../../packages/contracts/src/index';
import type { ModelSource } from '../../../packages/contracts/src/models';
import { ModelGateway } from './models';
import { SearchGateway } from './search';
import { QuestionBank } from './bank';
import { newSession, cancelSession,sessionBase } from '../../../packages/interview/src/domain';
import { interviews, jobs, deletions,interviewMaterials,interviewCommands } from '../../../packages/database/src/schema';
import { openDatabase } from '../../../packages/database/src/client';
import { createQueue } from '../../../packages/jobs/src/queue';
import type { ApiConfig } from '../../../packages/config/src/index';
import { bankQuestionSchema,type BankQuestion } from '../../../packages/contracts/src/bank';
import { type PlanningOptions,type InterviewPlan,replanSchema } from '../../../packages/contracts/src/planning';
import { searchChoiceSchema } from '../../../packages/contracts/src/search';
import { planInterview,emptyProgress } from '../../../packages/interview/src/planner';
import { eligibleQa,eligibleCoding,questionDirective } from '../../../packages/interview/src/questions';
import { acceptedProgress,pinCurrentQuestion } from '../../../packages/interview/src/progress';
import { z } from 'zod';

export class InterviewService {
  readonly database;
  readonly queue;
  readonly models;
  readonly search;
  readonly bank;
  constructor(readonly config: ApiConfig) {
    this.database = openDatabase(config.DATABASE_URL);
    this.queue = createQueue(config.REDIS_URL);
    this.queue.on('error', () => {});
    this.models=new ModelGateway(config);
    this.search=new SearchGateway(config);
    this.bank=new QuestionBank(this.database.pool);
  }
  async onModuleDestroy() { await Promise.all([this.database.pool.end(), this.queue.close()]); }
  async list(owner: string) {
    const rows = await this.database.db.select().from(interviews).where(eq(interviews.owner, owner)).orderBy(desc(interviews.createdAt)).limit(50);
    return rows.map(row => sessionSchema.parse(row.state));
  }
  async get(owner: string, id: string) {
    const [row] = await this.database.db.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.owner, owner)));
    if (!row) throw new NotFoundException('Interview not found');
    return sessionSchema.parse(row.state);
  }
  async previewPlan(owner:string,options:PlanningOptions){const pool=await this.bank.snapshot(owner,options.bankIds);const plan=this.buildPlan(options,pool,[],emptyProgress());this.validateCoding(plan,pool);return plan;}
  private validateCoding(plan:InterviewPlan,pool:BankQuestion[]){if(plan.codingEnabled&&!eligibleCoding(plan,pool).length)throw new BadRequestException('题库中没有符合岗位与级别的编程题，请补充题目或关闭编程环节。');}
  private buildPlan(options:PlanningOptions,pool:BankQuestion[],turns:Session['turns'],progress:InterviewPlan['progress'],revision=0){const initial=planInterview(options,progress,null,revision);return options.bankMode==='strict'?planInterview(options,progress,eligibleQa(initial,pool,turns).length,revision):initial;}
  async create(owner: string, input: InterviewInput,modelConnectionId:string|null=null,search:z.infer<typeof searchChoiceSchema>={kind:'off'}) {
    const modelSource=await this.modelSource(owner,modelConnectionId);
    if(search.kind==='on')await this.search.describe(owner,search.connectionId);
    const pool=input.planning?await this.bank.snapshot(owner,input.planning.bankIds):[];
    const plan=input.planning?this.buildPlan(input.planning,pool,[],emptyProgress()):undefined;
    if(plan&&!plan.remainingQuestions)throw new BadRequestException('严格模式需要符合岗位的问答题，请选择题目或调整模式。');
    if(plan)this.validateCoding(plan,pool);
    const normalized:InterviewInput=plan?{...input,level:plan.options.candidateLevel==='intern'?'junior':plan.options.candidateLevel==='experienced'?'senior':'mid',planning:plan.options,questionCount:plan.totalQuestions}:input;
    const session:Session={...newSession(normalized,this.mode(modelSource),modelSource),search,...(plan?{plan}:{})};
    const jobId = crypto.randomUUID();
    const payload=this.buildPayload(owner,session,jobId,null,pool,plan);
    await this.database.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
      const usage = await tx.select({ count: sql<number>`count(*)::int` }).from(interviews).where(and(eq(interviews.owner,owner),sql`${interviews.createdAt} > now()-interval '1 day'`));
      if ((usage[0]?.count ?? 0)>=20) throw new ConflictException('DAILY_INTERVIEW_LIMIT');
      await tx.insert(interviews).values({ id: session.id, owner, state: session });
      if(plan)await tx.insert(interviewMaterials).values({sessionId:session.id,questions:pool});
      await tx.insert(jobs).values({ id: jobId, sessionId: session.id, owner, revision: 0, status: 'pending', requestHash: hash(input),
        payload });
    });
    await this.wakeWorkerBestEffort(jobId);
    return session;
  }
  async answer(owner: string, id: string, body: ReturnType<typeof answerSchema.parse>) {
    const requestHash = hash({ sessionId: id, answer: body.answer, revision: body.revision });
    const session = await this.database.db.transaction(async tx => {
      const [row] = await tx.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.owner, owner))).for('update');
      if (!row) throw new NotFoundException('Interview not found');
      const state = sessionSchema.parse(row.state);
      const [existing] = await tx.select().from(jobs).where(eq(jobs.id, body.requestId));
      if (existing) {
        if (existing.owner !== owner || existing.requestHash !== requestHash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
        return state;
      }
      if (state.status !== 'awaiting_answer' || state.revision !== body.revision) throw new ConflictException('INTERVIEW_CHANGED');
      const current:NonNullable<RuntimeRequest['current']>={question:state.question,answer:body.answer,...(state.plan?{durationSeconds:Math.min(7200,Math.max(0,(Date.now()-Date.parse(state.presentedAt??state.createdAt))/1000))}:{})};
      const [materials]=state.plan?await tx.select().from(interviewMaterials).where(eq(interviewMaterials.sessionId,id)):[];
      const pool=materials?z.array(bankQuestionSchema).parse(materials.questions):[];
      const remainingPool=current.question.bankId?pool.filter(q=>q.id!==current.question.bankId):pool;
      const plan=state.plan?this.buildPlan(state.plan.options,remainingPool,state.turns,acceptedProgress([...state.turns,current],state.startedAt,Date.now()),state.plan.revision+1):undefined;
      const payload=this.buildPayload(owner,state,body.requestId,current,remainingPool,plan);
      const next: Session = { ...state, status: 'evaluating' };
      await tx.update(interviews).set({ state: next }).where(eq(interviews.id, id));
      await tx.insert(jobs).values({ id: body.requestId, sessionId: id, owner, revision: state.revision, status: 'pending', requestHash,
        payload });
      return next;
    });
    await this.wakeWorkerBestEffort(body.requestId);
    return session;
  }
  async cancel(owner: string, id: string) {
    return this.database.db.transaction(async tx => {
      const [row] = await tx.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.owner, owner))).for('update');
      if (!row) throw new NotFoundException('Interview not found');
      const next = cancelSession(sessionSchema.parse(row.state));
      await tx.update(interviews).set({ state: next }).where(eq(interviews.id, id));
      await tx.update(jobs).set({ status: 'cancelled' }).where(and(eq(jobs.sessionId, id), eq(jobs.status, 'pending')));
      await tx.update(jobs).set({ status: 'cancelled' }).where(and(eq(jobs.sessionId, id), eq(jobs.status, 'processing')));
      return next;
    });
  }
  private runtimeModel(owner:string,state:Session){return{ownerId:owner,...(state.modelSource.kind==='custom'?{modelConnectionId:state.modelSource.connectionId}:state.modelSource.reference?{defaultModelReference:state.modelSource.reference}:{})};}
  private buildPayload(owner:string,state:Session,jobId:string,current:RuntimeRequest['current'],pool:BankQuestion[],plan?:InterviewPlan):RuntimeRequest{
    let next:RuntimeRequest['next'];try{next=plan?questionDirective(plan,state.turns,pool,jobId,state.role):undefined;}catch{throw new BadRequestException('题库库存不足，请调整剩余计划或补充题目。');}
    const research:RuntimeRequest['research']=state.search?.kind==='on'?state.research?{kind:'snapshot',value:state.research}:{kind:'fetch',connectionId:state.search.connectionId,query:state.search.query}:{kind:'off'};
    return{jobId,input:plan?{...state.input,planning:plan.options,questionCount:Math.max(1,plan.totalQuestions)}:state.input,turns:state.turns,current,...this.runtimeModel(owner,state),research,...(plan?{plan,next}:{})};
  }
  private mode(source:ModelSource){if(source.kind==='custom')return 'live' satisfies 'live';if(this.config.MODEL_MODE==='disabled')throw new BadRequestException('请在模型设置中启用连接后开始面试。');return this.config.MODEL_MODE;}
  private async modelSource(owner:string,id:string|null):Promise<ModelSource>{if(!id){const settings=await this.models.settings(owner);return{kind:'default',reference:settings.defaultReference,...(settings.mode==='demo'?{model:'rules-demo-v1'}:settings.defaultModel?{model:settings.defaultModel}:{})};}const profile=await this.models.describe(owner,id);return{kind:'custom',connectionId:profile.id,model:profile.model,baseUrl:profile.baseUrl};}
  async retry(owner:string,id:string,body:ReturnType<typeof retrySchema.parse>){
    const replacement=body.modelConnectionId===undefined?undefined:await this.modelSource(owner,body.modelConnectionId);
    const signature=hash({sessionId:id,revision:body.revision,modelConnectionId:body.modelConnectionId===undefined?'previous':body.modelConnectionId,searchConnectionId:body.searchConnectionId===undefined?'previous':body.searchConnectionId});
    const state=await this.database.db.transaction(async tx=>{
      const [row]=await tx.select().from(interviews).where(and(eq(interviews.id,id),eq(interviews.owner,owner))).for('update');if(!row)throw new NotFoundException('Interview not found');
      const session=sessionSchema.parse(row.state);const [existing]=await tx.select().from(jobs).where(eq(jobs.id,body.requestId));
      if(existing){if(existing.owner!==owner||existing.requestHash!==signature)throw new ConflictException('IDEMPOTENCY_CONFLICT');return session;}
      if(session.status!=='failed'||session.revision!==body.revision)throw new ConflictException('INTERVIEW_CHANGED');
      const [previous]=await tx.select().from(jobs).where(and(eq(jobs.sessionId,id),eq(jobs.status,'failed'))).orderBy(desc(jobs.createdAt)).limit(1);if(!previous)throw new ConflictException('NO_RETRYABLE_OPERATION');
      const modelSource=replacement??session.modelSource;const mode=this.mode(modelSource);
      if(mode!==session.modelMode)throw new ConflictException('请保持相同的真实/演示模式重试，或创建新的练习。');
      const revision=session.revision+1;
      const search:Session['search']=body.searchConnectionId===null?{kind:'off'}:body.searchConnectionId&&session.search?.kind==='on'?{...session.search,connectionId:body.searchConnectionId}:session.search;
      if(search?.kind==='on'&&body.searchConnectionId)await this.search.describe(owner,search.connectionId);
      const base={...sessionBase(session),modelSource,revision,...(search?{search}:{})};
      const next:Session=previous.payload.current?{...base,status:'evaluating',question:previous.payload.current.question}:{...base,status:'preparing'};
      await tx.update(interviews).set({state:next}).where(eq(interviews.id,id));
      const {modelConnectionId:_oldConnection,defaultModelReference:_oldDefault,...priorPayload}=previous.payload;
      const research:RuntimeRequest['research']=body.searchConnectionId===null?{kind:'off'}:body.searchConnectionId&&search?.kind==='on'&&session.search?.kind==='on'&&body.searchConnectionId!==session.search.connectionId?{kind:'fetch',connectionId:search.connectionId,query:search.query}:previous.payload.research;
      await tx.insert(jobs).values({id:body.requestId,sessionId:id,owner,revision,status:'pending',requestHash:signature,payload:{...priorPayload,jobId:body.requestId,...this.runtimeModel(owner,next),...(research?{research}:{})}});
      return next;
    });await this.wakeWorkerBestEffort(body.requestId);return state;
  }
  async replan(owner:string,id:string,body:z.infer<typeof replanSchema>){
    const signature=hash({id,revision:body.revision,durationMinutes:body.durationMinutes,answerLength:body.answerLength});
    return this.database.db.transaction(async tx=>{
      const [row]=await tx.select().from(interviews).where(and(eq(interviews.id,id),eq(interviews.owner,owner))).for('update');if(!row)throw new NotFoundException('Interview not found');const state=sessionSchema.parse(row.state);
      const [receipt]=await tx.select().from(interviewCommands).where(eq(interviewCommands.requestId,body.requestId));if(receipt){if(receipt.owner!==owner||receipt.requestHash!==signature)throw new ConflictException('IDEMPOTENCY_CONFLICT');return state;}
      if(state.status!=='awaiting_answer'||state.revision!==body.revision||!state.plan)throw new ConflictException('当前状态不能重规划，请等待当前生成完成或重新读取。');
      const [material]=await tx.select().from(interviewMaterials).where(eq(interviewMaterials.sessionId,id));const pool=material?z.array(bankQuestionSchema).parse(material.questions):[];
      const plan=pinCurrentQuestion(this.buildPlan({...state.plan.options,durationMinutes:body.durationMinutes,answerLength:body.answerLength},pool,state.turns,acceptedProgress(state.turns,state.startedAt,Date.now()),state.plan.revision+1),state.question.stage??'qa');
      const next:Session={...state,plan,input:{...state.input,planning:plan.options,questionCount:Math.max(1,plan.totalQuestions)},revision:state.revision+1};await tx.update(interviews).set({state:next}).where(eq(interviews.id,id));await tx.insert(interviewCommands).values({requestId:body.requestId,sessionId:id,owner,requestHash:signature,acceptedRevision:next.revision});return next;
    });
  }
  async remove(owner: string, id: string) {
    await this.database.db.transaction(async tx => {
      const [row] = await tx.select().from(interviews).where(and(eq(interviews.id,id),eq(interviews.owner,owner))).for('update');
      if (!row) throw new NotFoundException('Interview not found');
      const related = await tx.select({jobId:jobs.id}).from(jobs).where(eq(jobs.sessionId,id));
      if (related.length) await tx.insert(deletions).values(related).onConflictDoNothing();
      await tx.delete(interviews).where(eq(interviews.id,id));
    });
    return { deleted: true };
  }
  private async wakeWorkerBestEffort(id: string) {
    try { await this.queue.add('wake', { jobId: id }, { jobId: id }); }
    catch {  }
  }
}
export function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
