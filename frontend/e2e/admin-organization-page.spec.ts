import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Org switcher → /admin/organization/[orgSlug] with the org's settings.

const API = 'http://localhost:3002';

const orgs = [
  {
    id: 'org-page-1',
    name: 'Raleigh Retro Gamers',
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
    id: 'org-page-2',
    name: 'Durham Pinball Society',
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
  await signInAsStaff(page, { id: 'org-page-admin', email: 'org-page-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('sidebar has no Organizations link', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/venues');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Organizations' })).toHaveCount(0);
});

test('picking an org in the switcher opens /admin/organization/<slug> with its settings', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/venues');

  const switcher = page.getByTestId('org-switcher-trigger');
  await expect(switcher).toContainText('Raleigh Retro Gamers');
  await switcher.click();
  await page.getByRole('button', { name: 'Durham Pinball Society' }).click();

  await expect(page).toHaveURL(/\/admin\/organization\/durham-pinball-society$/);
  await expect(page.getByRole('heading', { name: 'Durham Pinball Society' })).toBeVisible();
  await expect(page.getByText('1 venue')).toBeVisible();
  await expect(page.getByText('2 users')).toBeVisible();
  await expect(switcher).toContainText('Durham Pinball Society');

  // The settings editor is open inline: name, theme, branding.
  await expect(page.getByLabel('Name')).toHaveValue('Durham Pinball Society');
  await expect(page.getByRole('radio', { name: /Dark/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();
  await expect(page.getByTestId('brand-color-save')).toBeDisabled();
});

test('visiting an org URL directly selects that org and saves through it', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/organization/durham-pinball-society');

  await expect(page.getByRole('heading', { name: 'Durham Pinball Society' })).toBeVisible();
  await expect(page.getByTestId('org-switcher-trigger')).toContainText('Durham Pinball Society');

  await page.getByTestId('theme-mode-light').click();
  await page.getByTestId('theme-mode-save').click();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ id: 'org-page-2', body: { themeMode: 'LIGHT' } });
});

test('unknown slug shows a not-found message', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/organization/nope');
  await expect(page.getByRole('heading', { name: 'Organization not found' })).toBeVisible();
});
