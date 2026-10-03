import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 038J2: draft themes on the Online Store page — duplicate, publish, delete.

const API = 'http://localhost:3002';

const org = {
  id: 'org-drafts-1',
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

const theme = (id: string, name: string, role: 'MAIN' | 'UNPUBLISHED') => ({
  id,
  name,
  role,
  presetKey: 'eventimus-default',
  presetVersion: '1.0',
  version: 1,
  lastSavedAt: '2027-03-01T14:15:00.000Z',
  lastSavedBy: { id: 'u1', name: 'Sam Organizer' },
  publishedAt: role === 'MAIN' ? '2027-01-01T00:00:00.000Z' : null,
  createdAt: '2027-01-01T00:00:00.000Z',
});

async function mockApi(page: Page) {
  let themes = [theme('theme-main', 'Eventimus Default', 'MAIN')];
  const calls: string[] = [];
  const prefs = { storefrontPrivate: false, hasPassword: true, storefrontMessage: null, seoTitle: null, seoDescription: null, autoRedirectLanguage: false };

  await page.route(`${API}/**`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API}/organizations`, (route) => route.fulfill({ json: [org] }));
  await page.route(`${API}/admin/themes/status`, (route) =>
    route.fulfill({ json: { masterSwitch: true, organizationEnabled: true, enabled: true } }),
  );
  await page.route(`${API}/admin/online-store/preferences`, (route) => route.fulfill({ json: prefs }));
  await page.route(`${API}/admin/themes`, (route) => route.fulfill({ json: { themes } }));
  await page.route(`${API}/admin/themes/*/duplicate`, async (route) => {
    calls.push(`duplicate ${route.request().url().split('/').at(-2)}`);
    const copy = theme('theme-copy', 'Copy of Eventimus Default', 'UNPUBLISHED');
    themes = [...themes, copy];
    await route.fulfill({ status: 201, json: copy });
  });
  await page.route(`${API}/admin/themes/*/publish`, async (route) => {
    const id = route.request().url().split('/').at(-2)!;
    calls.push(`publish ${id}`);
    themes = themes.map((t) => ({ ...t, role: t.id === id ? 'MAIN' : 'UNPUBLISHED' }));
    await route.fulfill({ json: themes.find((t) => t.id === id) });
  });
  await page.route(`${API}/admin/themes/theme-*`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const id = route.request().url().split('/').at(-1)!;
    calls.push(`delete ${id}`);
    themes = themes.filter((t) => t.id !== id);
    await route.fulfill({ status: 204, body: '' });
  });
  return calls;
}

test.describe('Draft themes (038J2)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'store-admin', email: 'store-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('duplicate the live theme, publish the draft, then delete the old one', async ({ page }) => {
    const calls = await mockApi(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/admin/online-store');

    const drafts = page.getByRole('region', { name: 'Draft themes' });
    await expect(drafts.getByText('Duplicate your live theme')).toBeVisible();

    await page.getByRole('button', { name: 'More actions for Eventimus Default' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    const row = drafts.getByRole('listitem').filter({ hasText: 'Copy of Eventimus Default' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: 'Edit theme' })).toHaveAttribute('href', '/admin/online-store/themes/theme-copy/editor');

    await row.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('article', { name: 'Copy of Eventimus Default' })).toBeVisible();
    const old = drafts.getByRole('listitem').filter({ hasText: 'Eventimus Default' });
    await old.getByRole('button', { name: 'More actions for Eventimus Default' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(drafts.getByText('Duplicate your live theme')).toBeVisible();

    expect(calls).toEqual(['duplicate theme-main', 'publish theme-copy', 'delete theme-main']);
  });

  test('the live theme cannot be deleted from its menu', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/online-store');
    await page.getByRole('button', { name: 'More actions for Eventimus Default' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });
});
