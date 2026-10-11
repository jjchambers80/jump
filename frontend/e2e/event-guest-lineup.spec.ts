// Special guest lineup (spec 050-Q). Storefront: the #guests section on the
// public event page (visible guests, photo alt = name, named links, hidden
// with no guests, placeholder in preview). The API is mocked; assertions are
// scoped to the #guests section. Axe runs with reduced motion at 390 × 844.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const GUESTS = [
  { id: 'g-mara', name: 'Mara Voss', role: 'Voice actor', bio: 'Voice of Captain Rook.\nSigning Saturday only.', imageUrl: '/images/img-mara/abc/square', links: { instagram: 'https://instagram.com/mara', website: 'https://mara.example' } },
  { id: 'g-sam', name: 'Sam Lee', role: null, bio: null, imageUrl: null, links: null },
];

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, slug: id, name: 'Retro Con', description: null, logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 100, status: 'PUBLISHED', admissionMode: 'TICKETED', taxRate: 0,
    organizationId: 'org-lineup', organizationName: 'Lineup Org', organizationBrandColor: '#0f766e', organizationThemeMode: 'LIGHT',
    organizationSignInLinks: false,
    venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [], guests: GUESTS,
    ...overrides,
  };
}

async function mockEvent(page: Page, body: { id: string }) {
  await page.route(`${API}/events/${body.id}`, (route) => route.fulfill(json(body)));
  await page.route(`${API}/events/${body.id}/applications/forms`, (route) => route.fulfill(json({ data: [] })));
  await page.route(`${API}/events/${body.id}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route(`${API}/images/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await mockLegalVersions(page, API);
}

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test.describe('storefront lineup', () => {
  test('shows visible guests in order with photo alt, plain-text bio and named links', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup'));
    await page.goto('/events/e2e-lineup');
    const section = page.locator('#guests');
    await expect(section.getByRole('heading', { level: 2, name: 'Special guests' })).toBeVisible({ timeout: 30000 });
    await expect(section.getByRole('heading', { level: 3 })).toHaveText(['Mara Voss', 'Sam Lee']);
    await expect(section.getByRole('img', { name: 'Mara Voss' })).toBeVisible();
    await expect(section.getByText('Voice actor')).toBeVisible();
    await expect(section.getByText(/Signing Saturday only/)).toBeVisible();
    await expect(section.getByRole('link', { name: 'Mara Voss on Instagram' })).toHaveAttribute('href', 'https://instagram.com/mara');
    await expect(section.getByRole('link', { name: "Mara Voss's website" })).toHaveAttribute('href', 'https://mara.example');
    const box = await section.getByRole('link', { name: 'Mara Voss on Instagram' }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await serious(page)).toEqual([]);
  });

  test('renders nothing without visible guests', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup-empty', { guests: [] }));
    await page.goto('/events/e2e-lineup-empty');
    await expect(page.getByRole('heading', { level: 1, name: 'Retro Con' }).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#guests')).toHaveCount(0);
  });

  test('preview shows a placeholder when the lineup is empty', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup-preview', { guests: [], status: 'DRAFT', preview: true }));
    await page.goto('/events/e2e-lineup-preview');
    const section = page.locator('#guests');
    await expect(section.getByText('Guests you add to the lineup show here')).toBeVisible({ timeout: 30000 });
    expect(await serious(page)).toEqual([]);
  });
});
