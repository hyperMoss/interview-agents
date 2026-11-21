import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hot100Questions } from '../packages/interview/src/hot100';

const checker = 'tests/fixtures/check-hot100-boundaries.py';

describe('independent Hot 100 Python boundary validation', () => {
  const ids = hot100Questions.map(question => question.id).sort((a, b) => a - b);

  it('covers exactly the current one-hundred-question snapshot', () => {
    expect(hot100Questions).toHaveLength(100);
    const fixtures = spawnSync('python3', ['-I', checker, '--list'], { encoding: 'utf8', timeout: 3000 });
    expect(fixtures.error).toBeUndefined();
    expect(fixtures.status, fixtures.stderr).toBe(0);
    expect(JSON.parse(fixtures.stdout)).toEqual(ids);
  });

  for (const question of hot100Questions) {
    it(question.id + '. ' + question.title + ': independent boundary cases', () => {
      const result = spawnSync('python3', ['-I', checker, String(question.id)], {
        input: question.referenceCode, encoding: 'utf8', timeout: 5000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
    });
  }
});
