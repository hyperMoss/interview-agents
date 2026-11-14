import { describe, expect, it } from 'vitest';
import { handoffBlockers, handoffPreview, type HandoffFacts } from '../apps/web/src/boss-inbox-panel';

const jd = '岗位要求：负责 React 与 NestJS 开发、接口设计、自动化测试和项目架构复盘。';
const resume = '合成经历：负责 React 页面与 NestJS 接口联调，并通过自动化测试验证状态恢复。';
const facts = (patch: Partial<HandoffFacts> = {}): HandoffFacts => ({
  title: '全栈工程师', jd, snapshotPending: false, snapshotUnavailable: false,
  resumeSelected: true, resumePending: false, resumeError: false, resume, ...patch,
});

describe('BOSS 会话带入判定', () => {
  it('blocks the handoff when the JD is missing and keeps the full-length statement', () => {
    const problems = handoffBlockers('preparation', facts({ jd: '' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('缺少 JD');
    expect(problems[0]).not.toContain('截断');
  });

  it('blocks practice without a selected resume copy while preparation still allows it', () => {
    expect(handoffBlockers('practice', facts({ resumeSelected: false, resume: '' }))).toEqual(['模拟面试需要先选择一份简历库副本。']);
    expect(handoffBlockers('preparation', facts({ resumeSelected: false, resume: '' }))).toEqual([]);
  });

  it('blocks a chosen resume below the limit for both entries instead of carrying unusable text', () => {
    const problems = handoffBlockers('preparation', facts({ resume: '太短' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('至少需要 20 字');
    expect(handoffBlockers('practice', facts({ resume: '太短' }))).toEqual(problems);
  });

  it('blocks both entries when the selected history snapshot never loaded, so the recorded source stays the shown one', () => {
    const problems = handoffBlockers('practice', facts({ snapshotUnavailable: true }));
    expect(problems).toEqual(['所选历史快照还没有读取成功，请重试或改回当前快照。']);
  });

  it('previews a bounded JD prefix while reporting the full length', () => {
    const preview = handoffPreview(`  ${'x'.repeat(260)}  `);
    expect(preview.bounded).toBe(true);
    expect(preview.length).toBe(260);
    expect(preview.text).toHaveLength(200);
  });
});
