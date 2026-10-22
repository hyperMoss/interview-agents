import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { leetcodeBatchSchema } from '../packages/contracts/src/bank';
import { hot100MetadataSchema } from '../packages/contracts/src/hot100';
import { exportHot100Bank, filterHot100, findHot100Question, getHot100Entry, hot100FilterSchema, hot100Groups, hot100Metadata, hot100Questions, nextHot100Question } from '../packages/interview/src/hot100';
import { hot100Lessons } from '../packages/interview/src/hot100-lessons';
import { parseOfficialHot100 } from '../packages/interview/src/hot100-source';
import { runAlgorithmCommand } from '../scripts/algorithm-practice';
import { defaultHot100Draft, restoreHot100Draft, updateHot100Entry } from '../apps/web/src/hot100-draft';

describe('official Hot 100 snapshot and authored learning cards', () => {
  it('has exactly the official one hundred unique questions, matching every authored lesson', () => {
    expect(hot100Questions).toHaveLength(100);
    expect(hot100Groups).toHaveLength(17);
    expect(Object.keys(hot100Lessons).map(Number).sort((a, b) => a - b)).toEqual(hot100Questions.map(question => question.id).sort((a, b) => a - b));
    expect(new Set(hot100Questions.map(question => question.url)).size).toBe(100);
    expect(hot100Metadata.source.sha256).toBe(createHash('sha256').update(JSON.stringify(hot100Metadata.questions)).digest('hex'));
    expect(hot100Questions.filter(question => question.group === '链表')).toHaveLength(14);
    expect(hot100Questions.filter(question => question.group === '二叉树')).toHaveLength(15);
    expect(findHot100Question(1)?.slug).toBe('two-sum');
    expect(findHot100Question(49)?.patternIds).toEqual(['hash-map']);
    expect(findHot100Question(239)?.patternIds).toEqual([]);
  });
  it('filters by topic, difficulty, title, number and review state together', () => {
    expect(filterHot100(hot100FilterSchema.parse({ group: '哈希', difficulty: 'easy' })).map(question => question.id)).toEqual([1]);
    expect(filterHot100(hot100FilterSchema.parse({ query: 'two-sum' })).map(question => question.id)).toEqual([1]);
    expect(filterHot100(hot100FilterSchema.parse({ query: '739' })).map(question => question.id)).toEqual([739]);
    expect(filterHot100(hot100FilterSchema.parse({ query: 'binary-search' })).map(question => question.id)).toEqual(expect.arrayContaining([35, 300]));
    expect(filterHot100(hot100FilterSchema.parse({ query: '不在题单中的文本' }))).toEqual([]);
    expect(filterHot100(hot100FilterSchema.parse({ status: 'reviewed' }), [{ questionId: 1, status: 'reviewed', code: '', notes: '' }]).map(question => question.id)).toEqual([1]);
  });
  it('moves forward and wraps while skipping reviewed items and the current question', () => {
    const questions = filterHot100(hot100FilterSchema.parse({ group: '哈希' }));
    const entries = [{ questionId: 49, status: 'reviewed', code: '', notes: '' } satisfies ReturnType<typeof getHot100Entry>];
    expect(nextHot100Question(questions, entries, 1)?.id).toBe(128);
    expect(nextHot100Question(questions, entries, 128)?.id).toBe(1);
    expect(nextHot100Question([], [], 1)).toBeUndefined();
    expect(nextHot100Question(questions.slice(0, 1), [], 1)).toBeUndefined();
  });
  it('exports all one hundred cards using the real bank import contract', () => {
    const exported = leetcodeBatchSchema.parse(exportHot100Bank(hot100Questions));
    expect(exported.questions).toHaveLength(100);
    expect(exported.questions[0]).toMatchObject({ slug: 'two-sum', region: 'cn', category: 'coding', difficulty: 'easy' });
    expect(exported.questions.every(question => question.content.includes('并非官方完整题面'))).toBe(true);
    expect(exported.questions.every(question => question.tags.includes('Hot100'))).toBe(true);
    expect(() => exportHot100Bank([])).toThrow();
    expect(hot100MetadataSchema.safeParse({ ...hot100Metadata, questions: Array(100).fill(hot100Metadata.questions[0]) }).success).toBe(false);
  });
  it('extracts only public metadata from an official-page-shaped payload and fails closed', () => {
    const difficulty = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
    const planSubGroups = hot100Groups.map(name => ({ name, questions: hot100Metadata.questions.filter(question => question.group === name).map(question => ({ questionFrontendId: String(question.id), titleSlug: question.slug, translatedTitle: question.title, difficulty: difficulty[question.difficulty], paidOnly: false, topicTags: question.tags.map(tag => ({ name: tag, nameTranslated: tag })) })) }));
    const page = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { studyPlanV2Detail: { slug: 'top-100-liked', planSubGroups } } } }] } } } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(page)}</script>`;
    expect(parseOfficialHot100(html, '2026-10-22')).toEqual(hot100Metadata);
    expect(() => parseOfficialHot100('<html>temporarily unavailable</html>', '2026-10-22')).toThrow('保留已有快照');
  });
});

describe('practice card tool used by the skill', () => {
  it('lists real filtered questions and exports the same dataset', () => {
    expect(runAlgorithmCommand(['list', '--group', '哈希', '--difficulty', 'easy'])).toMatchObject({ total: 100, matched: 1, questions: [{ id: 1 }] });
    expect(leetcodeBatchSchema.parse(runAlgorithmCommand(['export-bank'])).questions).toHaveLength(100);
  });
  it('defers hints until requested and rejects invalid selections', () => {
    expect(JSON.stringify(runAlgorithmCommand(['show', '1']))).not.toContain('先查询再记录');
    expect(JSON.stringify(runAlgorithmCommand(['show', '1', '--hint']))).toContain('先查询再记录');
    expect(() => runAlgorithmCommand(['show', '999999'])).toThrow('不在当前');
    expect(() => runAlgorithmCommand(['list', '--group', '不存在'])).toThrow('专题不存在');
    expect(() => runAlgorithmCommand(['list', '--difficulty', 'invalid'])).toThrow();
  });
});

describe('isolated Hot 100 practice drafts', () => {
  it('preserves code, notes and self review for each question', () => {
    let draft = updateHot100Entry(defaultHot100Draft(), { questionId: 1, code: 'print(1)', notes: '查互补值', status: 'doing' });
    draft = updateHot100Entry(draft, { questionId: 49, code: 'groups = {}', notes: '分组键', status: 'reviewed' });
    draft = updateHot100Entry(draft, { ...getHot100Entry(draft.entries, 1), code: 'print(2)' });
    expect(draft.entries).toHaveLength(2);
    expect(getHot100Entry(draft.entries, 49)).toMatchObject({ notes: '分组键', status: 'reviewed' });
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(draft) });
    try { expect(restoreHot100Draft().draft.entries).toEqual(draft.entries); }
    finally { vi.unstubAllGlobals(); }
  });
  it('keeps the UI usable with corrupt or inaccessible storage', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => '{invalid' });
    try { expect(restoreHot100Draft().warning).toContain('无法解析'); }
    finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('storage denied'); } });
    try { expect(restoreHot100Draft().warning).toContain('无法读取'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('rejects foreign question IDs and excessive persisted text at the boundary', () => {
    const invalid = { ...defaultHot100Draft(), entries: [{ questionId: 999999, code: '', notes: '', status: 'doing' }] };
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(invalid) });
    try { expect(restoreHot100Draft().draft.entries).toEqual([]); }
    finally { vi.unstubAllGlobals(); }
  });
  it('preserves valid answers when one old question disappears and falls back from stale filters', () => {
    const draft = { ...defaultHot100Draft(), selectedId: 999999, filters: { query: '', group: '旧专题', difficulty: 'all', status: 'all' }, entries: [
      { questionId: 1, code: 'my valid code', notes: '保留这条思路', status: 'reviewed' },
      { questionId: 999999, code: 'old', notes: '', status: 'doing' },
    ] };
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(draft) });
    try {
      const restored = restoreHot100Draft();
      expect(restored.draft.entries).toEqual([draft.entries[0]]);
      expect(restored.draft.selectedId).toBe(1);
      expect(restored.draft.filters.group).toBe('all');
      expect(restored.warning).toContain('已保留可恢复');
    } finally { vi.unstubAllGlobals(); }
  });
});
