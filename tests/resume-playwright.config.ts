import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'resume-browser-'));
const env = {
  NODE_ENV: 'test', API_PORT: '15300', WEB_ORIGIN: 'http://localhost:15173',
  DATABASE_URL: `file:${data}/app.sqlite`, AGENT_DATABASE_URL: `file:${data}/agent.sqlite`,
  CAREER_LOCAL_DATA_DIR: `${data}/private`, REDIS_URL: '', AGENT_URL: 'http://127.0.0.1:15411',
  COOKIE_SECRET: 'resume-e2e-synthetic-cookie-secret-123456789',
  INTERNAL_SERVICE_TOKEN: 'resume-e2e-synthetic-service-token-123456789',
  MODEL_MODE: 'demo', BOSS_AUTOMATION: 'paused',
};
export default defineConfig({
  testDir: './e2e', testMatch: 'resume-studio.spec.ts', workers: 1, timeout: 90000,
  outputDir: '../test-results/resumes', reporter: [['list']],
  use: { baseURL: env.WEB_ORIGIN, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node --import tsx scripts/migrate.ts && node --import tsx apps/api/src/main.ts', url: 'http://localhost:15300/api/v1/health', cwd: join(import.meta.dirname, '..'), env, reuseExistingServer: false, timeout: 30000 },
    { command: 'pnpm exec vite --config apps/web/vite.config.ts --port 15173 --strictPort', url: env.WEB_ORIGIN, cwd: join(import.meta.dirname, '..'), env, reuseExistingServer: false, timeout: 30000 },
  ],
});
