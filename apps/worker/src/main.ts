import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { readWorkerConfig } from '../../../packages/config/src/index';
import { redisConnection } from '../../../packages/jobs/src/queue';
import { GenerationWorker } from './worker';
import { CareerWorker } from './career-worker';
const config = readWorkerConfig();
@Module({ providers: [
  { provide: GenerationWorker, useFactory: () => new GenerationWorker(config) },
  { provide: CareerWorker, useFactory: () => new CareerWorker(config) },
] })
class WorkerModule {}
const context = await NestFactory.createApplicationContext(WorkerModule);
const runner = context.get(GenerationWorker);
const career = context.get(CareerWorker);
const wakeup = config.REDIS_URL ? new Worker('interview-generation', async () => { await runner.tick(); }, { connection: redisConnection(config.REDIS_URL), concurrency: 1 }) : null;
const careerWakeup = config.REDIS_URL ? new Worker('career-work', async () => { await career.tick(); }, { connection: redisConnection(config.REDIS_URL), concurrency: 1 }) : null;
wakeup?.on('error', () => context.get(GenerationWorker));
const timer = setInterval(() => { void runner.tick().catch(() => process.stderr.write('worker_reconcile_failed\n')); }, 1000);
const careerTimer = setInterval(() => { void career.tick().catch(() => process.stderr.write('career_reconcile_failed\n')); }, 1000);
const deletionTimer=setInterval(()=>{void runner.purge().catch(()=>process.stderr.write('deletion_reconcile_failed\n'));},5000);
void runner.tick().catch(() => process.stderr.write('worker_initial_tick_failed\n'));
void career.tick().catch(() => process.stderr.write('career_initial_tick_failed\n'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  clearInterval(timer);
  clearInterval(careerTimer);
  clearInterval(deletionTimer);
  void Promise.all([wakeup?.close(), careerWakeup?.close(), runner.close(), career.close(), context.close()]).finally(() => process.exit(0));
});
