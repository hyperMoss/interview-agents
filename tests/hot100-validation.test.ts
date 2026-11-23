import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hot100Questions } from '../packages/interview/src/hot100';
import { pythonRuntimeUrl, sandboxDocument } from '../apps/web/src/hot100-validation';

const harness = readFileSync('packages/interview/src/hot100-checks.py', 'utf8') + '\n' + readFileSync('packages/interview/src/hot100-runner.py', 'utf8');
// Only repository-owned code is ever sent to host Python in tests.
function check(id: number, code: string) {
  const script = harness + `\nprint(run_hot100(${id}, ${JSON.stringify(code)}))`;
  const result = spawnSync('python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 3000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('Hot 100 browser validation', () => {
  for (const question of hot100Questions) {
    it(`runs shared harness for ${question.id}`, () => {
      expect(check(question.id, question.referenceCode).status).toBe('passed');
    });
  }
  it('reports incorrect output with the failed check', () => {
    const result = check(1, 'class Solution:\n    def twoSum(self, nums, target):\n        return []');
    expect(result.status).toBe('failed');
    expect(result.message).toContain('AssertionError');
    expect(result.check).toContain('s.twoSum');
  });
  it('reports syntax and signature errors without passing', () => {
    expect(check(1, 'class Solution: ???').message).toContain('SyntaxError');
    expect(check(1, 'class Solution: pass').message).toContain('AttributeError');
  });
  it('allows original typing annotations and captures SystemExit', () => {
    expect(check(1, 'raise SystemExit(0)').status).toBe('failed');
    expect(check(1, 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        return next([i,j] for i in range(len(nums)) for j in range(i+1,len(nums)) if nums[i]+nums[j]==target)').status).toBe('passed');
  });
  it('pins runtime and restricts network in opaque-origin document', () => {
    const html = sandboxDocument();
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(`connect-src ${pythonRuntimeUrl}`);
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('/api/');
  });
});
