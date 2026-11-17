import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerService } from '../apps/api/src/career';
import { apiConfig } from './fixtures';

// Only exercises the authorized business service and temporary SQLite. No browser or Worker is started.
describe('selected cities in immutable career task snapshots', () => {
  let service: CareerService;
  let directory: string;
  const owner = crypto.randomUUID();
  const policy = { roleTargets: ['fullstack'], cities: ['杭州', '成都'], salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'city-snapshot-'));
    service = new CareerService({ ...apiConfig(), BOSS_AUTOMATION: 'search', CAREER_LOCAL_DATA_DIR: directory, REDIS_URL: '' });
  });
  afterAll(async () => { await service?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  it('persists selected mainland cities, replays the original command and isolates the owner', async () => {
    const command = { mode: 'preview', requestId: crypto.randomUUID(), policy };
    const created = await service.createTask(owner, command);
    expect(created.policy.cities).toEqual(['杭州', '成都']);
    expect((await service.getTask(owner, created.id)).policy.cities).toEqual(['杭州', '成都']);
    expect((await service.createTask(owner, command)).id).toBe(created.id);
    await expect(service.getTask(crypto.randomUUID(), created.id)).rejects.toThrow();
    await expect(service.createTask(owner, { ...command, policy: { ...policy, cities: ['北京'] } })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect((await service.getTask(owner, created.id)).policy.cities).toEqual(['杭州', '成都']);
  });
  it('keeps the historical Guangzhou/Shenzhen policy and rejects unknown cities before creating a task', async () => {
    const legacy = await service.createTask(owner, { mode: 'preview', requestId: crypto.randomUUID(), policy: { ...policy, cities: ['广州', '深圳'] } });
    expect(legacy.policy.cities).toEqual(['广州', '深圳']);
    await expect(service.createTask(owner, { mode: 'preview', requestId: crypto.randomUUID(), policy: { ...policy, cities: ['纽约'] } })).rejects.toThrow();
  });
});
