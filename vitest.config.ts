import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL??'postgresql://app:local-app-password@localhost:55439/interview',AGENT_DATABASE_URL:process.env.AGENT_DATABASE_URL??'postgresql://agent:local-agent-password@localhost:55439/interview',REDIS_URL:process.env.REDIS_URL??'redis://localhost:56389',AGENT_URL:process.env.AGENT_URL??'http://127.0.0.1:4111',INTERNAL_SERVICE_TOKEN:'local-only-change-before-deploy-123456',COOKIE_SECRET:'local-only-cookie-secret-change-123456',MODEL_MODE:'demo'});
export default defineConfig({test:{include:['tests/**/*.test.ts'],testTimeout:15000,hookTimeout:15000,fileParallelism:false}});
