import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Online store: sidebar link, settings follow the org picked in the switcher,
// store handle (slug) edits.

const API = 'http://localhost:3002';

const orgs = [
  {
    id: 'org-store-1',
    name: 'Raleigh Retro Gamers',
    slug: 'raleigh-retro-gamers',
    status: 'ACTIVE',
    logoUrl: null,
    coverUrl: null,
    brandColor: null,
    themeMode: 'SYSTEM',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    _count: { venues: 3, users: 3 },
  },
  {
    id: 'org-store-2',
    name: 'Durham Pinball Society',
    slug: 'durham-pinball-society',
    status: 'ACTIVE',
    logoUrl: null,
    coverUrl: null,
    brandColor: null,
    themeMode: 'DARK',
    createdAt: '2027-01-02T00:00:00.000Z',
    updatedAt: '2027-01-02T00:00:00.000Z',
    _count: { venues: 1, users: 2 },
  },
];

async function mockOrgApi(page: Page) {
  let current = orgs.map((o) => ({ ...o }));
  const patches: { id: string; body: Record<string, unknown> }[] = [];

  // Registered first so the specific routes below take precedence (last wins).
  await page.route(`${API}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
  );
  await page.route(`${API}/organizations/*`, async (route) => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.fallback();
    const id = new URL(req.url()).pathname.split('/').pop()!;
    const body = req.postDataJSON() as Record<string, unknown>;
    patches.push({ id, body });
    current = current.map((o) => (o.id === id ? { ...o, ...body } : o));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current.find((o) => o.id === id)),
    });
  });

  return { patches };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'store-admin', email: 'store-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('sidebar links to Online store and has no Organizations link', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/venues');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Organizations' })).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'Online store' }).click();
  await expect(page).toHaveURL(/\/admin\/online-store$/);
  await expect(sidebar.getByRole('link', { name: 'Online store' })).toHaveClass(/bg-indigo/);
  await expect(page.getByRole('heading', { name: 'Online store' })).toBeVisible();
});

test('shows the active org and follows the switcher without leaving the page', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/online-store');

  await expect(page.getByRole('heading', { name: 'Raleigh Retro Gamers' })).toBeVisible();
  await expect(page.getByLabel('Store name')).toHaveValue('Raleigh Retro Gamers');
  await expect(page.getByLabel('Handle')).toHaveValue('raleigh-retro-gamers');
  await expect(page.getByRole('radio', { name: /System/ })).toBeChecked();

  const switcher = page.getByTestId('org-switcher-trigger');
  await switcher.click();
  await page.getByRole('button', { name: 'Durham Pinball Society' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store$/);
  await expect(switcher).toContainText('Durham Pinball Society');
  await expect(page.getByRole('heading', { name: 'Durham Pinball Society' })).toBeVisible();
  await expect(page.getByText('1 venue')).toBeVisible();
  await expect(page.getByLabel('Store name')).toHaveValue('Durham Pinball Society');
  await expect(page.getByLabel('Handle')).toHaveValue('durham-pinball-society');
  await expect(page.getByRole('radio', { name: /Dark/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();
});

test('saves a normalized store handle through PATCH /organizations/:id', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/online-store');

  const handle = page.getByLabel('Handle');
  const save = page.getByTestId('handle-save');
  await expect(save).toBeDisabled();
  await handle.fill('Retro-Raleigh');
  await expect(save).toBeEnabled();
  await save.click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ id: 'org-store-1', body: { slug: 'retro-raleigh' } });
  await expect(handle).toHaveValue('retro-raleigh');
  await expect(save).toBeDisabled();
});
