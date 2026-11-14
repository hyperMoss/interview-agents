import {defineConfig} from '@playwright/test';
import base from './resume-playwright.config';
if(!Array.isArray(base.webServer)||!base.webServer[0]?.env)throw Error('Missing isolated test environment');
const env=base.webServer[0].env;
export default defineConfig({
  ...base,testMatch:['preparation.spec.ts','preparation-history.spec.ts'],grep:/custom model failures|keeps failed and successful/,
  outputDir:'../test-results/preparation',
  webServer:[...base.webServer,{
    command:'pnpm exec bun apps/agent/src/main.ts',url:'http://127.0.0.1:15411/health',
    cwd:base.webServer[0].cwd,env:{...env,AGENT_PORT:'15411'},reuseExistingServer:false,timeout:30000,
  }],
});
