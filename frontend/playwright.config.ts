import { defineConfig, devices } from '@playwright/test';

const testPort = process.env.PLAYWRIGHT_PORT || '3001';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${testPort}`;

export default defineConfig({
  testDir: './',
  testMatch: ['tests/integration/**/*.spec.ts', 'e2e/**/*.spec.ts'],
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
