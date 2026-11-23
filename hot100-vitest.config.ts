import { defineConfig } from 'vitest/config';
// Isolated algorithm-only suite: does not load real environment or databases.
export default defineConfig({ test: { include: ['tests/hot100*.test.ts'], fileParallelism: false, pool: 'threads', maxWorkers: 1, testTimeout: 15000 } });
