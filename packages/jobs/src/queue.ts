import { Queue } from 'bullmq';
const pollingOnly={on:(_event:string,_handler:()=>void)=>{},add:async(..._args:unknown[])=>{},close:async()=>{}};
export function redisConnection(raw: string) {
  const url = new URL(raw);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined,
    password: url.password || undefined, ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
}
export function createQueue(url: string) {
  if (!url) return pollingOnly;
  return new Queue('interview-generation', { connection: { ...redisConnection(url), maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 1 } });
}

/** Career notifications carry only a durable career_work id; SQLite remains the truth. */
export function createCareerQueue(url: string) {
  if (!url) return pollingOnly;
  return new Queue('career-work', { connection: { ...redisConnection(url), maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: { removeOnComplete: 200, removeOnFail: 200, attempts: 1 } });
}
