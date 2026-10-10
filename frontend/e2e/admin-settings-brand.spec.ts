import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Settings › General › Brand (spec 049): the organization's brand identity.
// Each card PATCHes only its own fields.

const API = 'http://localhost:3002';
const ORG_ID = 'org-brand-settings';

const org = {
  id: ORG_ID,
  name: 'Raleigh Retro Gamers',
  slug: 'raleigh-retro-gamers',
  status: 'ACTIVE',
  logoUrl: null as string | null,
  squareLogoUrl: null as string | null,
  coverUrl: null as string | null,
  brandColor: '#1d4ed8',
  brandSecondaryColor: null as string | null,
  themeMode: 'SYSTEM',
  slogan: null as string | null,
  shortDescription: null as string | null,
  socialLinks: { instagram: 'https://instagram.com/rrg' } as Record<string, string> | null,
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-18T12:00:00.000Z',
};

async function mockBrandApi(page: Page) {
  let current = { ...org };
  const patches: Record<string, unknown>[] = [];
  const uploads: string[] = [];

  await page.route(`${API}/organizations`, (route) => route.fulfill({ json: [current] }));

  await page.route(`${API}/admin/settings/business-details`, (route) =>
    route.fulfill({ json: { id: ORG_ID, name: current.name, countryCode: 'US', hasEin: false, einMasked: null } })
  );
  await page.route(`${API}/admin/settings/people`, (route) => route.fulfill({ json: { people: [] } }));

  await page.route(`${API}/organizations/${ORG_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      const social = body.socialLinks as Record<string, string> | undefined;
      if (social && Object.values(social).some((url) => !url.startsWith('https://'))) {
        return route.fulfill({ status: 400, json: { message: 'socialLinks.tiktok must start with https://' } });
      }
      current = { ...current, ...body } as typeof current;
    }
    return route.fulfill({ json: current });
  });

  await page.route(`${API}/organizations/${ORG_ID}/square-logo`, async (route) => {
    uploads.push(route.request().method());
    current = {
      ...current,
      squareLogoUrl: route.request().method() === 'POST' ? '/images/img-1/abc/square' : null,
    };
    return route.fulfill({ json: current });
  });

  return { patches, uploads };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'brand-admin', email: 'brand-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('General links to Brand under Store assets, with General still current', async ({ page }) => {
  await mockBrandApi(page);
  await page.goto('/admin/settings');

  await expect(page.getByRole('heading', { name: 'Store assets' })).toBeVisible();
  const row = page.getByRole('button', { name: 'Edit brand' });
  await expect(row).toContainText('Logos, colors, slogan and social links');
  await row.click();

  await expect(page).toHaveURL(/\/admin\/settings\/brand$/);
  await expect(page.getByRole('heading', { name: 'Brand', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'General' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  for (const card of ['Logos', 'Colors', 'Slogan and short description', 'Social links']) {
    await expect(page.getByRole('region', { name: card })).toBeVisible();
  }
});

test('slogan and short description save only their own fields, with counters', async ({ page }) => {
  const api = await mockBrandApi(page);
  await page.goto('/admin/settings/brand');

  const card = page.getByTestId('brand-text');
  const save = card.getByTestId('brand-text-save');
  await expect(save).toBeDisabled();
  await card.getByLabel('Slogan').fill('  Retro games, every month  ');
  await expect(card.getByText('28 of 120 characters used')).toBeVisible();
  await card.getByLabel('Short description').fill('A monthly market.');
  await save.click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ slogan: 'Retro games, every month', shortDescription: 'A monthly market.' });
  await expect(card.getByRole('status')).toHaveText('Saved');
  await expect(save).toBeDisabled();
});

test('secondary color saves on its own', async ({ page }) => {
  const api = await mockBrandApi(page);
  await page.goto('/admin/settings/brand');

  await page.getByTestId('secondary-color').getByTestId('brand-preset-emerald').click();
  await page.getByTestId('brand-colors-save').click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ brandSecondaryColor: '#047857' });
});

test('social links save the filled networks and surface a server error', async ({ page }) => {
  const api = await mockBrandApi(page);
  await page.goto('/admin/settings/brand');

  const card = page.getByTestId('brand-social');
  await expect(card.getByLabel('Instagram')).toHaveValue('https://instagram.com/rrg');
  await card.getByLabel('YouTube').fill('https://youtube.com/@rrg');
  await card.getByTestId('brand-social-save').click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({
    socialLinks: { instagram: 'https://instagram.com/rrg', youtube: 'https://youtube.com/@rrg' },
  });
  await expect(card.getByRole('status')).toHaveText('Saved');

  // http:// passes the browser's URL check; the backend refuses it.
  await card.getByLabel('TikTok').fill('http://tiktok.com/@rrg');
  await card.getByTestId('brand-social-save').click();
  await expect(card.getByRole('alert')).toHaveText('socialLinks.tiktok must start with https://');
});

test('square logo uploads to its own endpoint and can be removed', async ({ page }) => {
  const api = await mockBrandApi(page);
  await page.goto('/admin/settings/brand');

  const square = page.getByTestId('brand-image-square-logo');
  await square.locator('input[type="file"]').setInputFiles({
    name: 'square.png',
    mimeType: 'image/png',
    // 1×1 transparent PNG
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  });
  await expect(square.getByRole('img', { name: 'square logo preview' })).toBeVisible();
  await square.getByRole('button', { name: 'Remove square logo' }).click();
  await expect(square.getByRole('img', { name: 'square logo preview' })).toHaveCount(0);
  expect(api.uploads).toEqual(['POST', 'DELETE']);
});
