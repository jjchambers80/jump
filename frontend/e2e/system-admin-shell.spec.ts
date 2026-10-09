// System administration shell: post-login landing, the user-menu entry, the
// SYSTEM_ADMIN guard, the platform settings redirect and the Overview page.
// Backend mocked (CI has none).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const OVERVIEW = {
  organizations: { total: 128, active: 120, suspended: 3, pending: 5 },
  users: { total: 412, systemAdmins: 2, inactive: 7 },
  recentSignups: [
    {
      id: 'org-new',
      name: 'Raleigh Retro Gamers',
      slug: 'raleigh-retro-gamers',
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      onboardingCompletedAt: null,
      ownerEmail: 'owner@rrg.test',
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
