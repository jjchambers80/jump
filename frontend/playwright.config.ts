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
// The fixture API listens where the specs already point the API (NEXT_PUBLIC_API_URL, 3002).
// Locally, when a dev backend holds that port, set FIXTURE_API_PORT: the
// fixture moves there and only the Next server's own fetches follow it
// (INTERNAL_API_URL), so browser mocks on :3002 keep matching.
const fixturePort = process.env.FIXTURE_API_PORT || new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002').port || '3002';
// Spec 050: the event setup wizard is a build-time flag. A second dev server
// builds with it on (own port, own distDir) for the wizard specs only, so
// every other spec keeps the flag-off pages. Specs read the URL from
// PLAYWRIGHT_WIZARD_BASE_URL (workers inherit this process's env).
// Default: the app port + 103, clear of the fixture API (3002) and of any
// small PLAYWRIGHT_PORT offset. Locally, reuseExistingServer reuses whatever holds
// that port: make sure it is a flag-on server, or set PLAYWRIGHT_WIZARD_PORT.
// PLAYWRIGHT_WIZARD=0 skips it (the wizard specs then skip themselves).
const wizardEnabled = process.env.PLAYWRIGHT_WIZARD !== '0';
const wizardPort = process.env.PLAYWRIGHT_WIZARD_PORT || String(Number(testPort) + 103);
const wizardURL = `http://localhost:${wizardPort}`;
if (wizardEnabled) process.env.PLAYWRIGHT_WIZARD_BASE_URL = wizardURL;
const internalApi: Record<string, string> = process.env.FIXTURE_API_PORT ? { INTERNAL_API_URL: `http://localhost:${fixturePort}` } : {};

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

  webServer: [
    // Spec 038: canned API for the Next server's own fetches (server-rendered
    // themed pages). Browser calls are still mocked with page.route.
    {
      command: 'node e2e/fixtures/server.mjs',
      url: `http://localhost:${fixturePort}/__fixtures/health`,
      reuseExistingServer: !process.env.CI,
      env: { FIXTURE_API_PORT: fixturePort },
    },
    {
      command: `npx next dev -p ${testPort}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_THEME_EDITOR_ENABLED: 'true',
        ...internalApi,
      },
    },
    ...(wizardEnabled
      ? [
        {
          command: `npx next dev -p ${wizardPort}`,
          url: wizardURL,
          reuseExistingServer: !process.env.CI,
          env: {
            NEXT_PUBLIC_THEME_EDITOR_ENABLED: 'true',
            NEXT_PUBLIC_EVENT_WIZARD_ENABLED: 'true',
            // Two dev servers must not share .next (next.config.mjs reads this).
            NEXT_DIST_DIR: '.next-e2e-wizard',
            ...internalApi,
          },
        },
      ]
      : []),
  ],
});
