import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InterviewService } from '../apps/api/src/interviews';
import { interviewHistoryQuerySchema, interviewHistoryPageSchema } from '../packages/contracts/src/history';
import { newSession } from '../packages/interview/src/domain';
import type { Session } from '../packages/contracts/src/index';
import { apiConfig, input } from './fixtures';

describe('history query boundary', () => {
  it('defaults to twenty and bounds every external filter', () => {
    expect(interviewHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(interviewHistoryQuerySchema.parse({ limit: '50', role: ' 前端 ' })).toEqual({ limit: 50, role: '前端' });
    for (const value of [{ limit: 51 }, { limit: '2.5' }, { limit: ['20'] }, { status: 'unknown' }, { role: '岗'.repeat(121) }, { cursor: 'x'.repeat(513) }, { cursor: '../secret' }]) {
      expect(interviewHistoryQuerySchema.safeParse(value).success).toBe(false);
    }
  });
});

const suite = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
suite('owned lightweight interview history with real PostgreSQL', () => {
  let api: InterviewService;
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  beforeAll(() => {
    api = new InterviewService({ ...apiConfig(), DATABASE_URL: 'postgresql://app:local-app-password@127.0.0.1:55440/interview_test' });
  });
  afterEach(async () => {
    await api.database.pool.query('DELETE FROM app.interviews WHERE owner=$1 OR owner=$2', [owner, other]);
  });
  afterAll(async () => { await api.onModuleDestroy(); });

  async function insert({ count, identity = owner, role = '前端工程师', status = 'preparing', createdAt = '2026-01-01T08:00:00.123456Z' }: {
    count: number; identity?: string; role?: string; status?: 'preparing' | 'completed' | 'cancelled'; createdAt?: string;
  }) {
    const sessions: Session[] = Array.from({ length: count }, () => {
      const base = newSession({ ...input, role, resume: '这是私密简历测试 fixture，不能进入轻量历史摘要。', jobDescription: '这是私密 JD 测试 fixture，不能进入轻量历史摘要。' }, 'demo');
      if (status === 'completed') return { ...base, status, turns: [{
        question: { kind: 'technical', competency: '测试能力', text: '这是私密测试问题，不能进入历史摘要。' },
        answer: '这是私密测试答案，不能进入历史摘要。', modelSource: { kind: 'default' },
        assessment: { score: 81, evidence: '私密测试答案', feedback: '测试反馈', strengths: [], improvements: ['测试改进'] },
      }], report: { overallScore: 81, summary: '测试报告摘要', strengths: [], improvements: [] } };
      return { ...base, status };
    });
    await api.database.pool.query(
      'INSERT INTO app.interviews(id,owner,state,created_at) SELECT fixture.id::uuid,$1,fixture.state,$3::timestamptz FROM jsonb_to_recordset($2::jsonb) AS fixture(id text,state jsonb)',
      [identity, JSON.stringify(sessions.map(state => ({ id: state.id, state }))), createdAt],
    );
    return sessions;
  }

  it('paginates past fifty rows without duplicates when all timestamps are identical', async () => {
    const sessions = await insert({ count: 65 });
    const ids: string[] = [];
    let cursor: string | undefined;
    const lengths: number[] = [];
    do {
      const page = await api.history(owner, interviewHistoryQuerySchema.parse({ cursor }));
      interviewHistoryPageSchema.parse(page);
      lengths.push(page.items.length);
      ids.push(...page.items.map(item => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(lengths).toEqual([20, 20, 20, 5]);
    expect(ids).toEqual(sessions.map(session => session.id).sort().reverse());
    expect(new Set(ids).size).toBe(65);
  });

  it('retains timestamp precision in cursors and orders distinct microseconds correctly', async () => {
    const later = await insert({ count: 1, createdAt: '2026-01-01T08:00:00.123457Z' });
    const earlier = await insert({ count: 1, createdAt: '2026-01-01T08:00:00.123456Z' });
    const first = await api.history(owner, { limit: 1 });
    expect(first.items[0]?.id).toBe(later[0]?.id);
    expect(first.items[0]?.createdAt).toBe('2026-01-01T08:00:00.123457Z');
    const next = await api.history(owner, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(next.items[0]?.id).toBe(earlier[0]?.id);
    expect(next.nextCursor).toBeNull();
  });

  it('filters by literal case-insensitive role and status only after ownership', async () => {
    await insert({ count: 3, role: 'React 前端工程师', status: 'completed' });
    await insert({ count: 2, role: 'React 前端工程师', status: 'cancelled' });
    await insert({ count: 4, role: '后端工程师', status: 'completed' });
    await insert({ count: 7, identity: other, role: 'React 前端工程师', status: 'completed' });
    const filtered = await api.history(owner, { limit: 20, role: 'rEaCt', status: 'completed' });
    expect(filtered.items).toHaveLength(3);
    expect(filtered.items.every(item => item.role === 'React 前端工程师' && item.status === 'completed')).toBe(true);
    expect((await api.history(owner, { limit: 20, role: '%' })).items).toEqual([]);
    expect((await api.history(owner, { limit: 20, role: '_' })).items).toEqual([]);
    expect((await api.history(other, { limit: 20 })).items).toHaveLength(7);
  });

  it('returns only summary fields and no personal materials, questions, answers or full reports', async () => {
    await insert({ count: 1, status: 'completed' });
    const page = await api.history(owner, { limit: 20 });
    expect(page.items[0]).toMatchObject({ turnCount: 1, questionCount: input.questionCount, modelMode: 'demo', overallScore: 81 });
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['id', 'role', 'status', 'createdAt', 'turnCount', 'questionCount', 'modelMode', 'overallScore'].sort());
    expect(JSON.stringify(page)).not.toMatch(/私密|resume|jobDescription|answer|question":|report|input|turns|modelSource/);
  });

  it('never grants access from a cursor issued to another owner', async () => {
    await insert({ count: 2, identity: other });
    const foreign = await api.history(other, { limit: 1 });
    expect((await api.history(owner, { limit: 20, cursor: foreign.nextCursor ?? undefined })).items).toEqual([]);
  });

  it('rejects malformed, oversized and invalid decoded cursors with a generic boundary error', async () => {
    const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const invalid of ['abc', '!', 'x'.repeat(513), cursor({ version: 1, createdAt: 'bad-date', id: crypto.randomUUID() }), cursor({ version: 1, createdAt: '2026-01-01T00:00:00.123456Z', id: 'not-uuid' }), cursor({ version: 2, createdAt: '2026-01-01T00:00:00.123456Z', id: crypto.randomUUID() })]) {
      await expect(api.history(owner, { limit: 20, cursor: invalid })).rejects.toThrow('无效的历史分页位置');
    }
  });
});
