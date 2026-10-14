import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',workers:1,timeout:45000,use:{baseURL:'http://localhost:5173',channel:'chrome',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'docs/evidence/browser-results.json'}]]});
