import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../../../packages/database/src/client';
import { interviews, jobs } from '../../../packages/database/src/schema';
import { runtimeRequestSchema, runtimeResponseSchema, sessionSchema, type RuntimeRequest, type RuntimeResponse } from '../../../packages/contracts/src/index';
import { applyGeneration,sessionBase } from '../../../packages/interview/src/domain';
import { RuntimeFailure } from '../../../packages/interview/src/errors';
import type { WorkerConfig } from '../../../packages/config/src/index';
const claimedSchema = z.object({ id: z.uuid(), session_id: z.uuid(), revision: z.number(), attempts: z.number(), payload: runtimeRequestSchema });
export class GenerationWorker {
  readonly database;
  private busy = false;
  constructor(readonly config: WorkerConfig, readonly generate: (request: RuntimeRequest) => Promise<RuntimeResponse> = async request => {
    const response = await fetch(`${config.AGENT_URL}/internal/v1/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.INTERNAL_SERVICE_TOKEN}` },
      body: JSON.stringify(request), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {const data=z.object({error:z.string()}).safeParse(await response.json().catch(()=>null));throw new RuntimeFailure(data.success?data.data.error:'RUNTIME_UNAVAILABLE');}
    return runtimeResponseSchema.parse(await response.json());
  }) { this.database = openDatabase(config.DATABASE_URL); }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await this.database.pool.query(`UPDATE app.jobs SET status='processing', attempts=attempts+1, lease_until=now()+interval '90 seconds'
        WHERE id=(SELECT id FROM app.jobs WHERE status='pending' OR (status='processing' AND lease_until<now())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
      if (!result.rows.length) return;
      const job = claimedSchema.parse(result.rows[0]);
      try {
        if (job.attempts > 2) throw new Error('ATTEMPTS_EXHAUSTED');
        const response = runtimeResponseSchema.parse(await this.generate(job.payload));
        await this.database.db.transaction(async tx => {
          const [row] = await tx.select().from(interviews).where(eq(interviews.id, job.session_id)).for('update');
          const [storedJob] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for('update');
          if (!storedJob || storedJob.status !== 'processing' || storedJob.attempts !== job.attempts) return;
          if (row) {
            const session = sessionSchema.parse(row.state);
            if (session.revision === job.revision && (session.status === 'preparing' || session.status === 'evaluating')) {
              const next = applyGeneration(session, response, job.payload);
              await tx.update(interviews).set({ state: next }).where(eq(interviews.id, job.session_id));
            }
          }
          await tx.update(jobs).set({ status: 'completed', leaseUntil: null }).where(eq(jobs.id, job.id));
        });
      } catch(error) {
        await this.database.db.transaction(async tx => {
          const [row] = await tx.select().from(interviews).where(eq(interviews.id, job.session_id)).for('update');
          const [storedJob] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for('update');
          if (!storedJob || storedJob.status !== 'processing' || storedJob.attempts !== job.attempts) return;
          if (job.attempts < 2) { await tx.update(jobs).set({ status: 'pending', leaseUntil: null }).where(eq(jobs.id, job.id)); return; }
          if (row) {
            const state = sessionSchema.parse(row.state);
            if (state.revision === job.revision && (state.status === 'preparing' || state.status === 'evaluating')) {
              await tx.update(interviews).set({ state: {...sessionBase(state), revision: state.revision + 1,
                status: 'failed', recovery:job.payload.current,error:error instanceof RuntimeFailure?error.message:'本轮生成暂时不可用。作答已保存，请检查模型配置后重试，或取消练习。' } }).where(eq(interviews.id, job.session_id));
            }
          }
          await tx.update(jobs).set({ status: 'failed', leaseUntil: null }).where(eq(jobs.id, job.id));
        });
      }
    } finally { this.busy = false; }
  }
  async close() { await this.database.pool.end(); }
  async purge() {
    const result=await this.database.pool.query('SELECT job_id FROM app.deletions ORDER BY created_at LIMIT 20');
    for(const row of result.rows){
      const id=z.object({job_id:z.uuid()}).parse(row).job_id;
      const response=await fetch(`${this.config.AGENT_URL}/internal/v1/receipts/${id}`,{method:'DELETE',headers:{authorization:`Bearer ${this.config.INTERNAL_SERVICE_TOKEN}`},signal:AbortSignal.timeout(10000)});
      if(response.ok)await this.database.pool.query('DELETE FROM app.deletions WHERE job_id=$1',[id]);
    }
  }
}
