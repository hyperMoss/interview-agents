import { defineConfig } from '@playwright/test';
import base from './resume-playwright.config';

if (!Array.isArray(base.webServer) || !base.webServer[0]?.env) throw new Error('Missing isolated test environment');
const env = base.webServer[0].env;

export default defineConfig({
  ...base,
  testMatch: ['resume-studio.spec.ts', 'boss-inbox.spec.ts', 'usability.spec.ts', 'hot100.spec.ts', 'algorithm.spec.ts', 'interview.spec.ts', 'preparation.spec.ts', 'preparation-review.spec.ts', 'preparation-history.spec.ts', 'preparation-pdf.spec.ts', 'astryx.spec.ts', 'extension.spec.ts'],
  // This migration suite uses local fixtures; public URL ingestion has a separate network check.
  grepInvert: /public LeetCode URL imports/,
  outputDir: '../test-results/astryx',
  webServer: [
    ...base.webServer,
    {
      command: 'node_modules/.bin/bun apps/agent/src/main.ts',
      url: 'http://127.0.0.1:15411/health',
      cwd: base.webServer[0].cwd,
      env: { ...env, AGENT_PORT: '15411' },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'node --import tsx apps/worker/src/main.ts',
      cwd: base.webServer[0].cwd,
      env,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
