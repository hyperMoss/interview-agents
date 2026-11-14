import { describe, expect, it, vi } from 'vitest';
import { newSession } from '../packages/interview/src/domain';
import { turnSchema } from '../packages/contracts/src/index';
import { modelSettingsSchema } from '../packages/contracts/src/models';
import type { ReviewItem } from '../packages/contracts/src/workspace';
import { describeFrozenMode, describeRecordedMode, describeRuntimeMode } from '../apps/web/src/model-mode-tag';
import { questionIdOf, reviewAddMessage, reviewIntent } from '../apps/web/src/report-priorities';
import { input } from './fixtures';

vi.mock('../apps/web/src/storage', () => ({
  readSession: () => null, readDraftValue: () => null, writeSession: () => true, tryClearInterviewDrafts: () => {},
}));

const settings = (patch: Record<string, unknown> = {}) => modelSettingsSchema.parse({
  enabled: true, allowLocal: false, mode: 'demo', defaultModel: 'deployment-model', defaultReference: 'a'.repeat(64), active: null, ...patch,
});
const connection = () => ({
  id: crypto.randomUUID(), baseUrl: 'https://api.example.com/v1', model: 'coach-alpha', hasKey: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(), remember: false,
});

describe('mode of a started interview comes from its frozen snapshot', () => {
  it('shows the recorded model name and never the connection id', () => {
    const active = connection();
    const custom = describeFrozenMode('live', { kind: 'custom', connectionId: active.id, model: active.model, baseUrl: active.baseUrl });
    expect(custom).toMatchObject({ tone: 'live', label: 'AI · coach-alpha' });
    expect(JSON.stringify(custom)).not.toContain(active.id);
    expect(describeFrozenMode('live', { kind: 'default', model: 'deployment-model' })).toMatchObject({ tone: 'live', label: 'AI · deployment-model' });
    expect(describeFrozenMode('live', { kind: 'default' })).toMatchObject({ tone: 'live', label: 'AI · 部署方默认模型' });
  });

  it('keeps demo sessions on the demo reading even when a rules model name is recorded', () => {
    expect(describeFrozenMode('demo', { kind: 'default', model: 'rules-demo-v1' })).toMatchObject({ tone: 'demo', label: '演示模式' });
    expect(JSON.stringify(describeFrozenMode('demo', { kind: 'default', model: 'rules-demo-v1' }))).not.toContain('rules-demo-v1');
  });

  it('lets a per-turn reading differ from the session reading after a retry switched connections', () => {
    const session = describeFrozenMode('live', { kind: 'custom', connectionId: crypto.randomUUID(), model: 'coach-alpha', baseUrl: 'https://api.example.com' });
    const turn = describeFrozenMode('live', { kind: 'default', model: 'deployment-model' }, 'turn');
    expect(session.label).toBe('AI · coach-alpha');
    expect(turn.label).toBe('AI · deployment-model');
    expect(session.hint).toContain('单题来源可能与这里不同');
    expect(turn.hint).toContain('本题');
  });

  it('reports unknown provenance as unconfirmed rather than demo', () => {
    expect(describeFrozenMode('live', undefined).tone).toBe('unconfirmed');
    expect(describeFrozenMode(undefined, undefined).label).toBe('未确认');
    expect(describeFrozenMode('live', { kind: 'custom', connectionId: crypto.randomUUID(), model: '', baseUrl: 'https://api.example.com' }).tone).toBe('unconfirmed');
    expect(describeRecordedMode('live', undefined)).toMatchObject({ tone: 'live', label: 'AI 模式' });
    expect(describeRecordedMode(undefined, undefined).tone).toBe('unconfirmed');
    expect(describeRecordedMode('demo', 'rules-demo-v1')).toMatchObject({ tone: 'demo', label: '演示模式' });
  });
});

describe('mode of a not-yet-started entry point reads runtime readiness only', () => {
  it('separates an enabled connection, the deployment default, demo and an unconfigured runtime', () => {
    const active = connection();
    const enabled = describeRuntimeMode({ data: settings({ mode: 'disabled', active }) });
    expect(enabled).toMatchObject({ tone: 'live', label: 'AI · coach-alpha' });
    expect(JSON.stringify(enabled)).not.toContain(active.id);
    expect(describeRuntimeMode({ data: settings({ mode: 'live' }) })).toMatchObject({ tone: 'live', label: 'AI · deployment-model' });
    expect(describeRuntimeMode({ data: settings({ mode: 'demo' }) })).toMatchObject({ tone: 'demo', label: '演示模式' });
    expect(describeRuntimeMode({ data: settings({ mode: 'disabled' }) })).toMatchObject({ tone: 'unconfigured' });
  });

  it('never turns loading or a failed read into a demo claim', () => {
    expect(describeRuntimeMode({ pending: true }).tone).toBe('pending');
    expect(describeRuntimeMode({ failed: true }).tone).toBe('unconfirmed');
    expect(describeRuntimeMode({ data: undefined }).tone).toBe('unconfirmed');
  });
});

const turnWithId = (id: string) => turnSchema.parse({
  question: { id, text: '如何验证这次修改有效？', competency: '工程能力', kind: 'technical' },
  answer: '补充失败路径用例并观察实际执行结果。',
  assessment: { score: 70, evidence: '观察实际执行结果', feedback: '增加失败路径验证。', strengths: [], improvements: ['增加失败路径验证。'] },
});

const reviewItem = (interviewId: string, questionId: string, completedAt: string | null = null): ReviewItem => ({
  id: crypto.randomUUID(), interviewId, questionId, title: 'Web 全栈工程师 · 工程能力', questionText: '如何验证这次修改有效？',
  evidence: '观察实际执行结果', notes: '', dueAt: new Date(Date.now() + 86_400_000).toISOString(), completedAt,
});

describe('per-question review actions share one local list', () => {
  it('decides add versus remove from the stored list and removes only this interview open record', () => {
    const session = newSession(input, 'demo');
    const other = newSession(input, 'demo');
    const questionId = crypto.randomUUID();
    const turn = turnWithId(questionId);
    expect(reviewIntent([], session, turn, 0)).toEqual({ kind: 'add' });
    const open = reviewItem(session.id, questionId);
    const completed = reviewItem(session.id, questionId, new Date().toISOString());
    const foreign = reviewItem(other.id, questionId);
    const intent = reviewIntent([open, completed, foreign], session, turn, 0);
    expect(intent.kind).toBe('remove');
    expect(intent.kind === 'remove' ? intent.remaining.map(item => item.id) : []).toEqual([completed.id, foreign.id]);
  });

  it('reports what an insert attempt actually did instead of trusting one boolean', () => {
    const session = newSession(input, 'demo');
    const questionId = crypto.randomUUID();
    const turn = turnWithId(questionId);
    const open = reviewItem(session.id, questionId);
    expect(reviewAddMessage([], [open], session, turn, 0)).toContain('已加入面试复习清单');
    expect(reviewAddMessage([open], [open], session, turn, 0)).toContain('没有重复加入');
    const refused = reviewAddMessage([], [], session, turn, 0);
    expect(refused).toContain('没有写入');
    expect(refused).toContain('复习清单已满或本机存储写入失败');
  });

  it('lets a reviewed question be queued again and falls back to the turn index for identity', () => {
    const session = newSession(input, 'demo');
    const questionId = crypto.randomUUID();
    expect(reviewIntent([reviewItem(session.id, questionId, new Date().toISOString())], session, turnWithId(questionId), 0).kind).toBe('add');
    const withoutId = turnSchema.parse({
      question: { text: '没有稳定标识的旧题面。', competency: '工程能力', kind: 'technical' },
      answer: '补充失败路径用例并观察实际执行结果。',
      assessment: { score: 60, evidence: '观察实际执行结果', feedback: '补充边界。', strengths: [], improvements: ['补充边界。'] },
    });
    expect(questionIdOf(withoutId, 2)).toBe('turn-2');
    expect(questionIdOf(withoutId, 3)).not.toBe(questionIdOf(withoutId, 2));
  });
});
