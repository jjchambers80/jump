import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

// CI skips the specs listed in e2e/quarantine.txt; local runs execute everything.
const quarantined = process.env.E2E_QUARANTINE
  ? readFileSync(path.join(__dirname, 'e2e', 'quarantine.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  : [];

const testPort = process.env.PLAYWRIGHT_PORT || '3001';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${testPort}`;

export default defineConfig({
  testDir: './',
  testMatch: ['tests/integration/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  testIgnore: quarantined,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: {
    command: `npx next dev -p ${testPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
