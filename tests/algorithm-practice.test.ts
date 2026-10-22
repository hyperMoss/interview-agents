import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { algorithmPatterns, suggestPatterns } from '../packages/interview/src/algorithm-patterns';
import { compareTyping } from '../packages/interview/src/typing-practice';
import { defaultAlgorithmDraft, recordTyping, restoreAlgorithmDraft, sameDrill, type DrillTarget } from '../apps/web/src/algorithm-draft';

const pythonFixtures: Record<string, string> = {
  'hash-map': 'assert solve([2, 7, 11, 15], 9) == [0, 1]\nassert solve([3, 3], 6) == [0, 1]\nassert solve([3], 6) == []\nassert solve([], 1) == []',
  'two-pointers': 'assert solve([1, 3, 5, 8], 9) == [0, 3]\nassert solve([2, 2], 4) == [0, 1]\nassert solve([-4, -1, 3, 8], 2) == [1, 2]\nassert solve([], 1) == []',
  'sliding-window': 'assert solve("abcabcbb") == 3\nassert solve("abba") == 2\nassert solve("一😀一二") == 3\nassert solve("") == 0',
  'prefix-sum': 'assert solve([1, -1, 1], 1) == 3\nassert solve([0, 0, 0], 0) == 6\nassert solve([], 0) == 0\nassert solve([-1, -1, 1], 0) == 1',
  'binary-search': 'assert solve([1, 3, 3, 7], 3) == 1\nassert solve([], 2) == 0\nassert solve([2, 3], 9) == 2\nassert solve([2, 3], 0) == 0',
  'monotonic-stack': 'assert solve([30, 40, 35, 50]) == [1, 2, 1, 0]\nassert solve([40, 40, 30]) == [0, 0, 0]\nassert solve([]) == []',
  'bfs': 'assert solve({0: [1, 2], 1: [3], 2: [], 3: []}, 0, 3) == 2\nassert solve({0: [1], 1: [0]}, 0, 2) == -1\nassert solve({}, 3, 3) == 0',
  'backtracking': 'assert solve([1, 2]) == [[], [1], [1, 2], [2]]\nassert solve([]) == [[]]\nassert len(solve([1, 2, 3])) == 8',
  'dp-knapsack': 'assert solve([(2, 3), (3, 4), (4, 5)], 5) == 7\nassert solve([(2, 3)], 4) == 3\nassert solve([], 5) == 0\nassert solve([(1, 9)], 0) == 0\nassert solve([(1, -9)], 2) == 0',
  'heap-top-k': 'assert solve([3, 2, 1, 5, 6, 4], 2) == 5\nassert solve([3, 3, 2], 2) == 3\nassert solve([-2, -1], 2) == -2\nassert solve([], 1) is None\nassert solve([1], 0) is None',
  'union-find': 'assert solve(5, [(0, 1), (1, 2), (3, 4)]) == 2\nassert solve(3, [(0, 1), (0, 1), (1, 1)]) == 2\nassert solve(0, []) == 0\nassert solve(3, []) == 3',
  'topological-sort': 'assert solve(3, [(0, 1), (1, 2)]) == [0, 1, 2]\nassert solve(2, [(0, 1), (1, 0)]) is None\nassert solve(0, []) == []\nassert sorted(solve(3, [])) == [0, 1, 2]',
};

describe('catalog-owned Python references', () => {
  it('covers every pattern with an executable fixture and unique identity', () => {
    expect(algorithmPatterns).toHaveLength(12);
    expect(new Set(algorithmPatterns.map(pattern => pattern.id)).size).toBe(12);
    expect(Object.keys(pythonFixtures).sort()).toEqual(algorithmPatterns.map(pattern => pattern.id).sort());
  });
  for (const pattern of algorithmPatterns) {
    it(`${pattern.title} passes its displayed example and edge cases in Python`, () => {
      const fixture = pythonFixtures[pattern.id];
      if (!fixture) throw new Error(`Missing Python fixture for ${pattern.id}`);
      const script = `${pattern.code}\n\n${fixture}\nassert repr(${pattern.example.invocation}) == ${JSON.stringify(pattern.example.result)}`;
      const result = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 3000 });
      expect(result.error, 'Python 3 is required to verify the displayed templates').toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    });
  }
});

describe('keyword guidance', () => {
  it('shows multiple candidates and literal matching evidence', () => {
    const { candidates } = suggestPatterns('有序数组，两数之和');
    expect(candidates.map(candidate => candidate.pattern.id)).toEqual(expect.arrayContaining(['hash-map', 'two-pointers', 'binary-search']));
    expect(candidates.find(candidate => candidate.pattern.id === 'hash-map')?.matched).toContain('两数之和');
  });
  it('handles English case and word boundaries', () => {
    expect(suggestPatterns('BFS shortest path').candidates[0]?.pattern.id).toBe('bfs');
    expect(suggestPatterns('abfs defhash').candidates).toEqual([]);
    expect(suggestPatterns('TOP   K').candidates[0]?.pattern.id).toBe('heap-top-k');
  });
  it('recognizes mixed Chinese and English Top K terms', () => {
    for (const text of ['求数组第 k 大元素', '第k大元素', '返回前 k 个元素', '前k个值']) {
      expect(suggestPatterns(text).candidates.some(candidate => candidate.pattern.id === 'heap-top-k'), text).toBe(true);
    }
  });
  it('does not reverse explicit nonnegative and unweighted conditions', () => {
    for (const text of ['非负数子数组和', '不含负数的连续数组和', 'nonnegative sum', 'non-negative sum', 'unweighted shortest path', '无权图最短路径']) {
      expect(suggestPatterns(text).warnings, text).toEqual([]);
    }
  });
  it('warns about negative sum windows and recommends prefix sums', () => {
    const result = suggestPatterns('连续子数组和为 k，可能有负数');
    expect(result.candidates.some(candidate => candidate.pattern.id === 'prefix-sum')).toBe(true);
    expect(result.warnings.join('')).toContain('单调性');
  });
  it('does not present weighted BFS as an established solution', () => {
    const result = suggestPatterns('加权图最短路径');
    expect(result.warnings.join('')).toContain('不能直接用普通 BFS');
    expect(result.warnings.join('')).toContain('负权');
  });
  it('leaves an unsupported problem unmatched', () => {
    expect(suggestPatterns('').candidates).toEqual([]);
    expect(suggestPatterns('设计一个缓存淘汰策略').candidates).toEqual([]);
  });
});

describe('text comparison', () => {
  it('normalizes newline formats while preserving indentation', () => {
    expect(compareTyping('a\n    b', 'a\r\n    b').complete).toBe(true);
    expect(compareTyping('a\n    b', 'a\r\tb').difference).toEqual({ line: 2, column: 1, expected: ' ', actual: '\t' });
  });
  it('counts Chinese and emoji as code points and locates the first difference', () => {
    expect(compareTyping('一😀\n甲乙', '一😀\n甲丙').difference).toEqual({ line: 2, column: 2, expected: '乙', actual: '丙' });
    expect(compareTyping('一😀', '一😀').prefix).toBe(2);
  });
  it('shows missing, extra, and final newline differences', () => {
    expect(compareTyping('abc', 'ab').difference).toEqual({ line: 1, column: 3, expected: 'c', actual: null });
    expect(compareTyping('a', 'ab').difference).toEqual({ line: 1, column: 2, expected: null, actual: 'b' });
    expect(compareTyping('a', 'a\n').complete).toBe(false);
    expect(compareTyping('a\n', 'a').difference?.expected).toBe('\n');
  });
  it('compares all lines including extra lines and empty input', () => {
    expect(compareTyping('a\nb', 'a\nc\nd').lines.map(line => line.matches)).toEqual([true, false, false]);
    expect(compareTyping('', '').complete).toBe(true);
    expect(compareTyping('a', '').progress).toBe(0);
    expect(compareTyping('a', 'b').progress).toBe(0);
  });
  it('keeps Unicode normalization distinct rather than changing user text', () => {
    expect(compareTyping('é', 'e\u0301').complete).toBe(false);
  });
});

describe('per-reference draft storage model', () => {
  const code: DrillTarget = { key: 'python:hash-map', kind: 'code', reference: 'def solve():\n    pass' };
  const statement: DrillTarget = { key: 'custom', kind: 'statement', reference: '题面一😀' };
  it('keeps code and statement separate and updates rather than duplicates', () => {
    let draft = recordTyping(defaultAlgorithmDraft(), code, 'def');
    draft = recordTyping(draft, statement, '题');
    draft = recordTyping(draft, code, 'def solve');
    expect(draft.drills).toHaveLength(2);
    expect(draft.drills.find(drill => sameDrill(drill, statement))?.typed).toBe('题');
    expect(draft.drills.at(-1)?.typed).toBe('def solve');
  });
  it('will not restore input against a changed reference', () => {
    expect(sameDrill(code, { ...code, reference: 'changed' })).toBe(false);
  });
  it('retains the latest twenty targets and resets only the active one', () => {
    let draft = defaultAlgorithmDraft();
    for (let i = 0; i < 21; i++) draft = recordTyping(draft, { ...statement, key: `question:${i}` }, String(i));
    expect(draft.drills).toHaveLength(20);
    expect(draft.drills.some(drill => drill.key === 'question:0')).toBe(false);
    const active = draft.drills.at(-1);
    if (!active) throw new Error('Missing newest draft');
    draft = recordTyping(draft, active, '');
    expect(draft.drills.filter(drill => drill.typed !== '')).toHaveLength(19);
  });
  it('recovers a valid stored draft and normalizes an obsolete pattern', () => {
    const draft = { ...recordTyping(defaultAlgorithmDraft(), code, 'def'), patternId: 'obsolete' };
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify(draft) });
    try {
      const restored = restoreAlgorithmDraft();
      expect(restored.warning).toBe('');
      expect(restored.draft.patternId).toBe('hash-map');
      expect(restored.draft.drills[0]?.typed).toBe('def');
    } finally { vi.unstubAllGlobals(); }
  });
  it('starts with a usable example when stored JSON is corrupt', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => '{bad' });
    try {
      expect(restoreAlgorithmDraft().warning).toContain('旧草稿无法恢复');
      expect(restoreAlgorithmDraft().draft.problem.length).toBeGreaterThan(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it('reports inaccessible storage rather than treating it as an empty draft', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('unavailable'); } });
    try {
      expect(restoreAlgorithmDraft().warning).toContain('无法读取草稿');
    } finally { vi.unstubAllGlobals(); }
  });
});
