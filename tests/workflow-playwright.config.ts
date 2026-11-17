import { defineConfig } from '@playwright/test';
import base from './astryx-playwright.config';

export default defineConfig({
  ...base,
  testMatch: [
    'unified-resumes.spec.ts', 'preparation-handoff.spec.ts', 'career-cities.spec.ts',
    'resume-studio.spec.ts', 'preparation.spec.ts', 'preparation-history.spec.ts',
    'preparation-pdf.spec.ts', 'interview.spec.ts', 'usability.spec.ts', 'astryx.spec.ts', 'boss-inbox.spec.ts',
  ],
  outputDir: '../test-results/workflow',
});
