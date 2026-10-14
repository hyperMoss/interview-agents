import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { readWorkerConfig } from '../../../packages/config/src/index';
import { redisConnection } from '../../../packages/jobs/src/queue';
import { GenerationWorker } from './worker';
const config = readWorkerConfig();
@Module({ providers: [{ provide: GenerationWorker, useFactory: () => new GenerationWorker(config) }] })
class WorkerModule {}
const context = await NestFactory.createApplicationContext(WorkerModule);
const runner = context.get(GenerationWorker);
const wakeup = new Worker('interview-generation', async () => { await runner.tick(); }, { connection: redisConnection(config.REDIS_URL), concurrency: 1 });
wakeup.on('error', () => context.get(GenerationWorker));
const timer = setInterval(() => { void runner.tick().catch(() => process.stderr.write('worker_reconcile_failed\n')); }, 1000);
const deletionTimer=setInterval(()=>{void runner.purge().catch(()=>process.stderr.write('deletion_reconcile_failed\n'));},5000);
void runner.tick().catch(() => process.stderr.write('worker_initial_tick_failed\n'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  clearInterval(timer);
  clearInterval(deletionTimer);
  void Promise.all([wakeup.close(), runner.close(), context.close()]).finally(() => process.exit(0));
});
