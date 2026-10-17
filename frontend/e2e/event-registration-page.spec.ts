// Registration event page (spec 057): the description inline, then the form
// with one Register button, no tickets, cart or RSVP pass. A live event's
// page offers a linked registration event's form as a pill pointing there.
// The API is mocked; no backend needed.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const REG_ID = 'e2e-registration-event';
const LIVE_ID = 'e2e-registration-live';
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: REG_ID,
    name: 'Retro Market Vendors',
    description: '<p>Tables, power and <strong>load-in at 8am</strong>.</p>',
    logoUrl: null,
    date: '2030-10-26T16:00:00.000Z',
    capacity: null,
    category: null,
    status: 'PUBLISHED',
    type: 'REGISTRATION',
    admissionMode: 'TICKETED',
    taxRate: 0,
    organizationId: 'org-reg',
    organizationName: 'Retro Gamers',
    organizationThemeMode: 'LIGHT',
    venue: { id: 'venue-1', name: 'Town Center', address: '5959 Triangle Town Blvd', timezone: 'America/New_York' },
    priceTiers: [],
    ...overrides,
  };
}

const form = (overrides: Record<string, unknown> = {}) => ({
  id: 'form-reg', eventId: REG_ID, kind: 'PAID', name: 'Vendor registration', slug: 'vendors', intro: null,
  acceptance: { open: true, reason: null }, tiers: [], questions: [], ...overrides,
});

async function mock(page: Page) {
  await page.route(`${API}/events/${REG_ID}`, (route) => route.fulfill(json(event())));
  await page.route(`${API}/events/${REG_ID}/applications/forms`, (route) => route.fulfill(json({ data: [form()] })));
  await page.route(`${API}/events/${LIVE_ID}`, (route) => route.fulfill(json(event({ id: LIVE_ID, name: 'Retro Market', type: 'LIVE', capacity: 100 }))));
  await page.route(`${API}/events/${LIVE_ID}/applications/forms`, (route) => route.fulfill(json({ data: [form()] })));
  await mockLegalVersions(page, API);
}

test('a registration event offers its form with one Register button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mock(page);
  await page.goto(`/events/${REG_ID}`);
  const register = page.locator('#register');
  await expect(register.getByRole('heading', { name: 'Register' })).toBeVisible({ timeout: 30000 });
  await expect(register.getByText('Registering is free. Once approved, you choose and pay.')).toBeVisible();
  await expect(register.getByRole('link', { name: /Register.*Vendor registration/ })).toHaveAttribute('href', `/events/${REG_ID}/apply/vendors`);
  await expect(page.getByRole('heading', { name: 'About this event' })).toBeVisible();
  await expect(page.locator('.jump-prose:visible strong')).toHaveText('load-in at 8am');
  // No tickets, cart, RSVP pass, Event Information dialog or Get involved pills.
  await expect(page.locator('#tickets')).toHaveCount(0);
  await expect(page.locator('#rsvp-pass')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Event Information' })).toHaveCount(0);
  await expect(page.getByTestId('get-involved')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
});

test('a closed registration says so instead of linking', async ({ page }) => {
  await mock(page);
  await page.route(`${API}/events/${REG_ID}/applications/forms`, (route) =>
    route.fulfill(json({ data: [form({ acceptance: { open: false, reason: 'closed' } })] }))
  );
  await page.goto(`/events/${REG_ID}`);
  await expect(page.locator('#register').getByText('Closed')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#register').getByRole('link')).toHaveCount(0);
});

test("a live event's pill opens a linked registration event's form there", async ({ page }) => {
  await mock(page);
  await page.goto(`/events/${LIVE_ID}`);
  const pills = page.getByTestId('get-involved');
  await expect(pills.getByRole('link', { name: /Vendor registration/ })).toHaveAttribute('href', `/events/${REG_ID}/apply/vendors`, { timeout: 30000 });
});
