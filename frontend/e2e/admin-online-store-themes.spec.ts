import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 038J1: the Online Store page for organizations in the themes rollout.

const API = 'http://localhost:3002';

const org = {
  id: 'org-themes-1',
  name: 'Riverside Presents',
  slug: 'riverside-presents',
  status: 'ACTIVE',
  logoUrl: null,
  coverUrl: null,
  brandColor: '#0f766e',
  themeMode: 'LIGHT',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 2 },
};

const live = {
  id: 'theme-main',
  name: 'Eventimus Default',
  role: 'MAIN',
  presetKey: 'eventimus-default',
  presetVersion: '1.0',
  version: 3,
  lastSavedAt: '2027-03-01T14:15:00.000Z',
  lastSavedBy: { id: 'u1', name: 'Sam Organizer' },
  publishedAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2027-01-01T00:00:00.000Z',
};

async function mockApi(page: Page, { enabled = true, masterSwitch = true, hasPassword = true } = {}) {
  let prefs = { storefrontPrivate: false, hasPassword, storefrontMessage: null, seoTitle: null, seoDescription: null, autoRedirectLanguage: false };
  let status = { masterSwitch, organizationEnabled: enabled, enabled: enabled && masterSwitch };
  const calls = { prefsPatches: [] as unknown[], rollout: [] as unknown[] };

  await page.route(`${API}/**`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API}/organizations`, (route) => route.fulfill({ json: [org] }));
  await page.route(`${API}/admin/themes/status`, (route) => route.fulfill({ json: status }));
  await page.route(`${API}/admin/themes/rollout`, async (route) => {
    const body = route.request().postDataJSON();
    calls.rollout.push(body);
    status = { masterSwitch, organizationEnabled: body.enabled, enabled: body.enabled && masterSwitch };
    await route.fulfill({ json: status });
  });
  await page.route(`${API}/admin/themes`, (route) => route.fulfill({ json: { themes: [live] } }));
  await page.route(`${API}/admin/online-store/preferences`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      calls.prefsPatches.push(body);
      prefs = { ...prefs, ...body };
    }
    await route.fulfill({ json: prefs });
  });
  return calls;
}

test.describe('Online Store page with themes (038J1)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'store-admin', email: 'store-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('shows the live theme with Edit theme and its details', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/online-store');
    await expect(page.getByRole('heading', { level: 1, name: 'Online Store' })).toBeVisible();
    const card = page.getByRole('article', { name: 'Eventimus Default' });
    await expect(card.getByText('Active', { exact: true })).toBeVisible();
    await expect(card.getByText(/Last saved: .* by Sam Organizer · Eventimus Default · v1\.0/)).toBeVisible();
    await expect(card.getByRole('link', { name: 'Edit theme' })).toHaveAttribute('href', '/admin/online-store/themes/theme-main/editor');
    await expect(page.getByRole('link', { name: 'View store' })).toHaveAttribute('href', '/organizations/riverside-presents');
    // Thumbnails are the live home page, desktop + mobile.
    const frames = card.locator('iframe');
    await expect(frames).toHaveCount(2);
    for (const frame of await frames.all()) await expect(frame).toHaveAttribute('src', '/organizations/riverside-presents');
    if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT });
  });

  test('the ⋯ menu works by keyboard and returns focus', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/online-store');
    const trigger = page.getByRole('button', { name: 'More online store actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'More online store actions' });
    await expect(menu.getByRole('menuitem', { name: 'Preferences' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Pages' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('store access switches to password protected when a password exists', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/admin/online-store');
    await page.getByLabel('Store access').selectOption('private');
    await expect.poll(() => calls.prefsPatches).toEqual([{ storefrontPrivate: true }]);
    await expect(page.getByLabel('Store access')).toHaveValue('private');
  });

  test('password protected without a password opens Preferences to set one', async ({ page }) => {
    const calls = await mockApi(page, { hasPassword: false });
    await page.goto('/admin/online-store');
    await page.getByLabel('Store access').selectOption('private');
    await expect(page).toHaveURL(/\/admin\/online-store\/preferences#store-access$/);
    expect(calls.prefsPatches).toEqual([]);
  });

  test('Preferences carries the Brand card while themes are on', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/online-store/preferences');
    await expect(page.getByRole('region', { name: 'Brand' })).toBeVisible();
  });

  test('without themes the page stays today\'s branding page, with no Brand card in Preferences', async ({ page }) => {
    await mockApi(page, { enabled: false });
    await page.goto('/admin/online-store');
    await expect(page.getByRole('heading', { level: 1, name: 'Online store' })).toBeVisible();
    await expect(page.getByTestId('live-theme')).toHaveCount(0);
    await expect(page.getByTestId('themes-rollout')).toHaveCount(0);
    await page.goto('/admin/online-store/preferences');
    await expect(page.getByTestId('store-access')).toBeVisible();
    await expect(page.getByTestId('brand-card')).toHaveCount(0);
  });
});

test.describe('themes rollout by a system administrator', () => {
  test('turns themes on for the organization from the legacy page', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'sys', email: 'sys@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
    const calls = await mockApi(page, { enabled: false });
    await page.goto('/admin/online-store');
    await page.getByTestId('themes-rollout').getByRole('button', { name: 'Turn on themes' }).click();
    await expect(page.getByRole('article', { name: 'Eventimus Default' })).toBeVisible();
    expect(calls.rollout).toEqual([{ enabled: true }]);
  });
});
