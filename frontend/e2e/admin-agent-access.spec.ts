import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 045C: Settings › Agent access, Account › Connected apps and
// System administration › Settings load their data, and switch flips go through the
// "Confirm it's you" step-up. Backend mocked. The nav entries for the first
// two stay hidden until NEXT_PUBLIC_AGENT_ACCESS_ENABLED, so tests open them by URL.

const API = 'http://localhost:3002';
const ORG_ID = 'org-agent';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAUTH_401 = json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401);

const GRANT = {
  id: 'grant-1',
  userId: 'agent-admin',
  member: { name: 'Ada Admin', email: 'ada@test.com' },
  client: { name: 'Claude', clientId: 'https://claude.ai/oauth/client', kind: 'CIMD' },
  scopes: ['store:read', 'content:write'],
  createdAt: '2026-10-06T12:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  organizationId: ORG_ID,
  organizationName: 'Raleigh Retro Gamers',
};

async function mockApi(page: Page) {
  const patches: { path: string; reauth: string | null }[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE' }])),
  );
  await page.route(`${API}/admin/agent-access/settings`, (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push({ path: 'settings', reauth: route.request().headers()['x-jump-reauth'] ?? null });
      return route.fulfill(REAUTH_401);
    }
    return route.fulfill(json({ agentAccessEnabled: false }));
  });
  await page.route(`${API}/admin/agent-access/grants`, (route) => route.fulfill(json({ grants: [GRANT] })));
  await page.route(`${API}/admin/agent-access/audit-log**`, (route) =>
    route.fulfill(json({ total: 0, offset: 0, limit: 50, rows: [] })),
  );
  await page.route(`${API}/admin/agent-access/my-grants`, (route) => route.fulfill(json({ grants: [GRANT] })));
  await page.route(`${API}/admin/platform/settings`, (route) => route.fulfill(json({ agentAccessEnabled: true })));
  await page.route(`${API}/admin/platform/stats`, (route) =>
    route.fulfill(json({ grantCount: 3, callCount: 42, currentTokens: 2 })),
  );
  await page.route(`${API}/account/reauth/methods`, (route) => route.fulfill(json({ methods: ['email'] })));
  return { patches };
}

test.describe('as ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'agent-admin', email: 'ada@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('Agent access loads the switch and grants, and a flip asks to confirm it is you', async ({ page }) => {
    const { patches } = await mockApi(page);
    await page.goto('/admin/settings/agent-access');

    await expect(page.getByRole('heading', { name: 'Agent access', level: 2 })).toBeVisible();
    await expect(page.getByText('Claude').first()).toBeVisible();
    const toggle = page.getByRole('switch', { name: 'Toggle agent access' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(page.getByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible();
    expect(patches).toEqual([{ path: 'settings', reauth: null }]);
  });

  test('Platform is not in the Settings nav for a store ADMIN', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/settings/agent-access');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('link', { name: 'General' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Platform' })).toHaveCount(0);
  });

  test('Connected apps lists my grants', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/account/connected-apps');
    await expect(page.getByRole('heading', { name: 'Connected apps', level: 2 })).toBeVisible();
    await expect(page.getByText('Raleigh Retro Gamers').first()).toBeVisible();
  });
});

test.describe('as SYSTEM_ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'agent-sys', email: 'sys@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
  });

  test('System settings load the global switch and stats', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/system/settings');
    await expect(page.getByText('42').first()).toBeVisible();
    await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');
  });
});
