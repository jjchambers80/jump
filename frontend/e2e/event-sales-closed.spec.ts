// Sales closed (spec 050-D): the event stays published, but the public page
// hides the cart, steppers and RSVP form and says "Sales are closed"; the
// "Get involved" pills go; the apply pages say "Applications are closed".
// API mocked; assertions scoped to visible elements (mobile + desktop copies).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const TICKETED = 'evt-sales-closed';
const RSVP = 'evt-sales-closed-rsvp';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const event = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  name: 'Closed Fair',
  description: '<p>Two days of tabletop.</p>',
  logoUrl: null,
  date: '2031-06-01T20:00:00.000Z',
  capacity: 100,
  status: 'PUBLISHED',
  salesClosed: true,
  admissionMode: 'TICKETED',
  taxRate: 0,
  organizationId: 'org-closed',
  organizationName: 'Closed Org',
  organizationBrandColor: '#0f766e',
  organizationThemeMode: 'LIGHT',
  organizationSignInLinks: false,
  venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
  priceTiers: [
    { id: 't-ga', name: 'General Admission', price: 20, quantityTotal: 100, quantitySold: 10, quantityReserved: 0, quantityAvailable: 90, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, isRefundable: false },
  ],
  ...over,
});

const closedForm = {
  id: 'form-press',
  kind: 'FREE',
  name: 'Press & Media',
  slug: 'press-media',
  intro: 'Tell us about your outlet.',
  acceptance: { open: false, reason: 'sales_closed' },
  chargeTiming: null,
  feeMode: null,
  tiers: [],
  questions: [],
};

async function mockApi(page: Page) {
  for (const [id, body] of [
    [TICKETED, event(TICKETED)],
    [RSVP, event(RSVP, { admissionMode: 'RSVP', priceTiers: [], rsvpLimit: 50, rsvpRemaining: 40, rsvpMaxPartySize: 1 })],
  ] as const) {
    await page.route(`${API}/events/${id}`, (route) => route.fulfill(json(body)));
    await page.route(`${API}/events/${id}/applications/forms`, (route) => route.fulfill(json({ data: [closedForm] })));
    await page.route(`${API}/events/${id}/applications/forms/press-media`, (route) => route.fulfill(json(closedForm)));
    await page.route(`${API}/events/${id}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
  }
  await mockLegalVersions(page, API);
}

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => mockApi(page));

test('ticketed: no steppers, cart or apply pills, and "Sales are closed"', async ({ page }) => {
  await page.goto(`/events/${TICKETED}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Closed Fair' })).toBeVisible({ timeout: 30000 });

  const closed = page.getByTestId('sales-closed').filter({ visible: true });
  await expect(closed).toContainText('Sales are closed');
  await expect(page.getByRole('button', { name: /Increase .* quantity/ })).toHaveCount(0);
  await expect(page.getByTestId('mobile-get-tickets')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Checkout/ })).toHaveCount(0);
  await expect(page.getByTestId('get-involved')).toHaveCount(0);

  expect(await seriousViolations(page)).toEqual([]);
});

test('RSVP: the pass says sales are closed instead of showing the form', async ({ page }) => {
  await page.goto(`/events/${RSVP}`);
  await expect(page.getByRole('heading', { name: 'Sales are closed' }).filter({ visible: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#rsvp-form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reserve my spot/ })).toHaveCount(0);

  expect(await seriousViolations(page)).toEqual([]);
});

test('apply pages say applications are closed', async ({ page }) => {
  await page.goto(`/events/${TICKETED}/apply`);
  await expect(page.getByTestId('apply-sales-closed')).toHaveText('Applications are closed.', { timeout: 30000 });
  await expect(page.getByRole('link', { name: /Press & Media/ })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto(`/events/${TICKETED}/apply/press-media`);
  await expect(page.getByTestId('apply-closed')).toContainText('Applications are closed.', { timeout: 30000 });
  await expect(page.getByTestId('apply-form')).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});
