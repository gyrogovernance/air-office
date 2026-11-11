import { defineConfig } from '@playwright/test';

/** Artifacts stay under tests/; do not use a root test-results folder. */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
});
