// System administration shell: post-login landing, the user-menu entry, the
// SYSTEM_ADMIN guard, the platform settings redirect and the Overview page.
// Backend mocked (CI has none).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mintSessionToken, signInAsStaff, type StaffUser } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Shape of SystemAdminService.overview().
const OVERVIEW = {
  organizations: { total: 128, active: 120, inactive: 3, pending: 5 },
  users: { total: 412, active: 405, inactive: 7, systemAdmins: 2 },
  onboarding: { windows: { 7: { started: 4, completed: 2, subscribed: 1 } }, pending: 5 },
  recentSignups: [
    {
      id: 'org-new',
      name: 'Raleigh Retro Gamers',
      slug: 'raleigh-retro-gamers',
      status: 'ACTIVE',
      onboardingCompletedAt: null,
      plan: 'FREE',
      signedUpAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      owner: { id: 'u-owner', email: 'owner@rrg.test', name: null },
    },
  ],
};

async function mockApi(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: 'org-1', name: 'First Store', slug: 'first', status: 'ACTIVE' }])),
  );
  await page.route(`${API}/admin/system/overview`, (route) => route.fulfill(json(OVERVIEW)));
  await page.route(`${API}/admin/platform/settings`, (route) => route.fulfill(json({ agentAccessEnabled: false })));
  await page.route(`${API}/admin/platform/stats`, (route) =>
    route.fulfill(json({ grantCount: 0, callCount: 0, currentTokens: 0 })),
  );
}

const sysAdmin = { id: 'sys-1', email: 'sys@test.com', role: 'SYSTEM_ADMIN' as const, name: 'Sys Admin' };
const storeAdmin = { id: 'adm-1', email: 'adm@test.com', role: 'ADMIN' as const, name: 'Store Admin' };

test.describe('as SYSTEM_ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, sysAdmin, baseURL!);
    await mockApi(page);
  });

  test('lands on /admin/system from /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/system$/);
    await expect(page.getByRole('heading', { level: 1, name: 'System administration' })).toBeVisible();
  });

  test('a callbackUrl deep link survives sign-in', async ({ page }) => {
    // Already signed in, the sign-in page's explicit callbackUrl still wins over /admin.
    await page.goto('/auth/two-step?callbackUrl=%2Fadmin%2Fevents');
    await expect(page).toHaveURL(/\/admin\/events/);
  });

  test('user menu links to System administration', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await page.getByTestId('org-switcher-trigger').click();
    const item = page.getByTestId('org-switcher-system');
    await expect(item).toHaveAttribute('role', 'menuitem');
    await item.click();
    await expect(page).toHaveURL(/\/admin\/system$/);
  });

  test('sidebar switches to system mode with aria-current and a way back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/system');
    const nav = page.getByRole('navigation', { name: 'System administration' });
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Events' })).toHaveCount(0);
    await expect(page.getByTestId('sidebar-onboarding')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-back-to-store')).toHaveAttribute('href', '/admin/dashboard');

    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/admin\/system\/settings$/);
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  test('/admin/settings/platform redirects to /admin/system/settings', async ({ page }) => {
    await page.goto('/admin/settings/platform');
    await expect(page).toHaveURL(/\/admin\/system\/settings$/);
    await expect(page.getByRole('switch', { name: 'Toggle global agent access' })).toBeVisible();
  });

  for (const width of [375, 1280]) {
    test(`overview tiles and signups render at ${width}px without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/admin/system');
      const tiles = page.getByTestId('system-stat-tiles');
      await expect(tiles.getByText('128')).toBeVisible();
      await expect(tiles.getByText('120 active · 3 suspended')).toBeVisible();
      await expect(page.getByRole('link', { name: /Raleigh Retro Gamers/ })).toHaveAttribute(
        'href',
        '/admin/system/organizations/org-new',
      );
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return main.scrollWidth - main.clientWidth + (document.documentElement.scrollWidth - window.innerWidth);
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('overview shows an alert with retry when the API fails', async ({ page }) => {
    let calls = 0;
    await page.route(`${API}/admin/system/overview`, (route) => {
      calls += 1;
      return calls === 1 ? route.fulfill(json({ message: 'Boom' }, 500)) : route.fulfill(json(OVERVIEW));
    });
    await page.goto('/admin/system');
    const alert = page.getByRole('alert').filter({ hasText: 'Try again' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('system-stat-tiles').getByText('128')).toBeVisible();
  });

  test('overview has no axe violations', async ({ page }) => {
    await page.goto('/admin/system');
    await expect(page.getByTestId('system-stat-tiles')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('as store ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, storeAdmin, baseURL!);
    await mockApi(page);
  });

  test('/admin lands on the dashboard', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  });

  test('no System administration item in the user menu', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await page.getByTestId('org-switcher-trigger').click();
    await expect(page.getByRole('menu', { name: 'Account menu' })).toBeVisible();
    await expect(page.getByTestId('org-switcher-system')).toHaveCount(0);
  });

  test('/admin/system redirects to the dashboard', async ({ page }) => {
    await page.goto('/admin/system/settings');
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  });
});

// Password sign-in through the real sign-in page. Auth.js endpoints are
// mocked: the credentials callback sets the session cookie (as Auth.js
// would) and answers with the callbackUrl it was given.
async function passwordSignIn(page: Page, baseURL: string, user: StaffUser, query = '') {
  const posted: string[] = [];
  await mockApi(page);
  await page.route('**/api/auth/providers', (route) =>
    route.fulfill(json({ password: { id: 'password', name: 'Password', type: 'credentials' } })),
  );
  await page.route('**/api/auth/csrf', (route) => route.fulfill(json({ csrfToken: 'csrf' })));
  await page.route('**/api/auth/session', (route) =>
    route.fulfill(json({ user: { id: user.id, email: user.email, role: user.role, name: user.name }, mfaPending: user.mfa === 'pending', expires: '2099-01-01T00:00:00.000Z' })),
  );
  await page.route('**/api/auth/callback/password**', async (route) => {
    const callbackUrl = new URLSearchParams(route.request().postData() ?? '').get('callbackUrl') ?? '';
    posted.push(callbackUrl);
    const token = await mintSessionToken(user);
    await page.context().addCookies([
      { name: 'authjs.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    return route.fulfill(json({ url: new URL(callbackUrl, baseURL).toString() }));
  });

  await page.goto(`/auth/signin${query}`);
  await page.getByLabel('Email').fill(user.email);
  await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in with password' }).click();
  return posted;
}

test.describe('password sign-in landing', () => {
  test('SYSTEM_ADMIN with no callbackUrl lands on /admin/system', async ({ page, baseURL }) => {
    const posted = await passwordSignIn(page, baseURL!, sysAdmin);
    await expect(page).toHaveURL(/\/admin\/system$/);
    expect(posted).toEqual(['/auth/landing']);
  });

  test('an explicit callbackUrl still wins for SYSTEM_ADMIN', async ({ page, baseURL }) => {
    await passwordSignIn(page, baseURL!, sysAdmin, '?callbackUrl=%2Fadmin%2Fevents');
    await expect(page).toHaveURL(/\/admin\/events$/);
  });

  test('SYSTEM_ADMIN with two-step pending goes through /auth/two-step to /admin', async ({ page, baseURL }) => {
    await passwordSignIn(page, baseURL!, { ...sysAdmin, mfa: 'pending' });
    await expect(page).toHaveURL(/\/auth\/two-step\?callbackUrl=%2Fadmin$/);
  });

  test('a store ADMIN keeps the /events default', async ({ page, baseURL }) => {
    await passwordSignIn(page, baseURL!, storeAdmin);
    await expect(page).toHaveURL(/\/events$/);
  });
});
