import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hot100Questions } from '../packages/interview/src/hot100';
import { hot100Solutions } from '../packages/interview/src/hot100-solutions';
import { defaultAlgorithmDraft, getAlgorithmDrillTarget, recordTyping, sameDrill } from '../apps/web/src/algorithm-draft';

const checker = 'tests/fixtures/check-hot100.py';

describe('per-question Python typing references', () => {
  it('covers exactly the snapshot with both references and executable regressions', () => {
    const ids = hot100Questions.map(question => question.id).sort((a, b) => a - b);
    expect(Object.keys(hot100Solutions).map(Number).sort((a, b) => a - b)).toEqual(ids);
    const fixtures = spawnSync('python3', ['-I', checker, '--list'], { encoding: 'utf8', timeout: 3000 });
    expect(fixtures.status, fixtures.stderr).toBe(0);
    expect(JSON.parse(fixtures.stdout)).toEqual(ids);
  });
  for (const question of hot100Questions) {
    it(`${question.id}. ${question.title}: displayed code passes fixed Python cases`, () => {
      const result = spawnSync('python3', ['-I', checker, String(question.id)], {
        input: question.referenceCode, encoding: 'utf8', timeout: 3000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    });
  }
  it('separates two questions sharing a routine, statements, and routine examples', () => {
    const first = { ...defaultAlgorithmDraft(), codeSource: 'question', origin: { kind: 'hot100', id: 1, title: '两数之和' } } satisfies ReturnType<typeof defaultAlgorithmDraft>;
    const second = { ...first, origin: { kind: 'hot100', id: 49, title: '字母异位词分组' } } satisfies typeof first;
    const a = getAlgorithmDrillTarget(first);
    const b = getAlgorithmDrillTarget(second);
    const routine = getAlgorithmDrillTarget({ ...first, codeSource: 'pattern' });
    const statement = getAlgorithmDrillTarget({ ...first, kind: 'statement' });
    expect(new Set([a.key, b.key, routine.key, statement.key]).size).toBe(4);
    expect(a.reference).toContain('def twoSum');
    expect(b.reference).toContain('def groupAnagrams');
    let draft = recordTyping(first, a, 'first draft');
    draft = recordTyping(draft, b, 'second draft');
    draft = recordTyping(draft, a, '');
    expect(draft.drills.find(drill => sameDrill(drill, b))?.typed).toBe('second draft');
    expect(sameDrill(a, { ...a, reference: a.reference + '\n' })).toBe(false);
  });
});
