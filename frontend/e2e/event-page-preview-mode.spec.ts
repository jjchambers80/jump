// Event page preview mode (spec 050-G): when the backend answers
// `preview: true`, EventPageView shows unset fields as text placeholders, keeps
// the cart and RSVP inert and opens no dialogs. The API is mocked; assertions
// are scoped to visible elements (the page mounts mobile + desktop copies).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';

function previewEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    name: 'Preview Fair',
    description: null,
    logoUrl: null,
    date: '2031-06-01T20:00:00.000Z',
    endDate: '2031-06-02T00:00:00.000Z',
    capacity: null,
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    taxRate: 0,
    organizationId: 'org-preview-mode',
    organizationName: 'Preview Org',
    organizationBrandColor: '#0f766e',
    organizationThemeMode: 'LIGHT',
    organizationSignInLinks: false,
    venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [],
    preview: true,
    ...overrides,
  };
}

async function mockEvent(page: Page, event: { id: string }) {
  await page.route(`${API}/events/${event.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(event) })
  );
  await page.route(`${API}/events/${event.id}/applications/forms`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );
  await page.route(`${API}/events/${event.id}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await mockLegalVersions(page, API);
}

const visible = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.use({ viewport: { width: 390, height: 844 } });

test('a bare draft shows text placeholders and the end time', async ({ page }) => {
  await mockEvent(page, previewEvent('e2e-preview-bare'));
  await page.goto('/events/e2e-preview-bare');

  await expect(page.getByRole('heading', { level: 1, name: 'Preview Fair' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  for (const text of ['Add an image', 'Add a description', 'Add tickets', '$ –']) await expect(visible(page, text)).toBeVisible();
  // No tiers yet is not "Sold out" in a preview.
  await expect(page.getByText('Sold Out')).toHaveCount(0);
  await expect(visible(page, /4:00\s–\s8:00\sPM\sEDT/)).toBeVisible();

  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no scroll at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await seriousViolations(page)).toEqual([]);
});

test('placeholders keep their contrast in dark mode', async ({ page }) => {
  await mockEvent(page, previewEvent('e2e-preview-dark', { organizationThemeMode: 'DARK' }));
  await page.goto('/events/e2e-preview-dark');
  await expect(visible(page, 'Add a description')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await seriousViolations(page)).toEqual([]);
});

test('ticketed preview: tiers show, checkout and the cart stay shut, no dialogs', async ({ page }) => {
  const tier = {
    id: 't1', name: 'General', description: 'Entry all day', price: 20, quantityTotal: 100, quantitySold: 0, quantityReserved: 0,
    quantityAvailable: 100, displayOrder: 0, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10,
  };
  await mockEvent(
    page,
    previewEvent('e2e-preview-ticketed', { description: '<p>Bring a friend.</p>', logoUrl: '/uploads/poster.png', priceTiers: [tier] })
  );
  await page.goto('/events/e2e-preview-ticketed');

  await expect(page.getByRole('heading', { level: 1, name: 'Preview Fair' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('region', { name: 'Event preview' })).toBeVisible();
  // The description is inline (no Event Information dialog), the image opens nothing.
  await expect(visible(page, 'Bring a friend.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Event Information' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /View Preview Fair image/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'General details' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Increase General quantity' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('button', { name: /Checkout/ }).filter({ visible: true }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /View cart/ }).filter({ visible: true }).first()).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expect(await seriousViolations(page)).toEqual([]);
});

test('RSVP preview: the pass shows a placeholder About and never submits', async ({ page }) => {
  await mockEvent(page, previewEvent('e2e-preview-rsvp', { admissionMode: 'RSVP', rsvpLimit: 50, rsvpMaxPartySize: 2, rsvpRemaining: 50 }));
  let posted = false;
  await page.route(`${API}/events/e2e-preview-rsvp/rsvps`, (route) => {
    posted = true;
    return route.fulfill({ status: 202, body: '{}' });
  });
  await page.goto('/events/e2e-preview-rsvp');

  const pass = page.locator('#rsvp-pass');
  await expect(pass.getByRole('button', { name: 'Reserve my spot' })).toBeDisabled({ timeout: 30000 });
  await expect(visible(page, 'Add a description')).toBeVisible();
  expect(posted).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
});
