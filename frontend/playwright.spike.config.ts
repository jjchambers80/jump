import { defineConfig, devices } from '@playwright/test';

// Spike 038-0: SSR fixture server (§16) next to Next, both started by Playwright.
const port = process.env.PLAYWRIGHT_PORT || '3111';
const apiPort = process.env.FIXTURE_API_PORT || '3102';

export default defineConfig({
  testDir: './e2e/spike',
  fullyParallel: true,
  reporter: 'line',
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: `FIXTURE_API_PORT=${apiPort} node e2e/fixtures/server.mjs`,
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: true,
    },
    {
      command: `NEXT_PUBLIC_API_URL=http://localhost:${apiPort} npx next dev -p ${port}`,
      url: `http://localhost:${port}/spike/storefront/org-public`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
