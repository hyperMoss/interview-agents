import { Queue } from 'bullmq';
export function redisConnection(raw: string) {
  const url = new URL(raw);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined,
    password: url.password || undefined, ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
}
export function createQueue(url: string) {
  return new Queue('interview-generation', { connection: { ...redisConnection(url), maxRetriesPerRequest: 1, enableOfflineQueue: false },
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 1 } });
}
