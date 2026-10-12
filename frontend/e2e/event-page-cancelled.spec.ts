// Spec 054-A: a cancelled event keeps its page. The backend answers
// `cancelled: true`; the page shows a notice instead of tickets, cart, mobile
// bar, map and apply pills. API mocked; assertions scoped to visible copies.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  name: 'Retro Expo',
  description: '<p>Games.</p>',
  logoUrl: null,
  date: '2031-06-01T20:00:00.000Z',
  capacity: 100,
  status: 'CANCELLED',
  cancelled: true,
  admissionMode: 'TICKETED',
  taxRate: 0,
  organizationId: 'org-cancelled',
  organizationName: 'Raleigh Retro Gamers',
  organizationBrandColor: '#0f766e',
  organizationThemeMode: 'LIGHT',
  organizationSignInLinks: false,
  venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
  priceTiers: [{ id: 't1', name: 'GA', price: 20, quantityAvailable: 50, quantityTotal: 50, isActive: true }],
  ...overrides,
});

async function mockEvent(page: Page, body: { id: string }) {
  await page.route(`${API}/events/${body.id}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await page.route(`${API}/events/${body.id}/applications/forms`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'f1', name: 'Vendors', slug: 'vendors', kind: 'FREE' }] }) })
  );
  await page.route(`${API}/events/${body.id}/map`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'm1', status: 'PUBLISHED' }) }));
  await mockLegalVersions(page, API);
}

test.use({ viewport: { width: 390, height: 844 } });

test('a cancelled ticketed event shows the notice and nothing to buy or apply for', async ({ page }) => {
  await mockEvent(page, event('e2e-cancelled'));
  await page.goto('/events/e2e-cancelled');

  await expect(page.getByRole('heading', { level: 1, name: 'Retro Expo' })).toBeVisible({ timeout: 30000 });
  const notice = page.getByRole('status').filter({ hasText: 'This event was cancelled' }).first();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Raleigh Retro Gamers cancelled Retro Expo');
  await expect(page.getByText('GA', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /checkout|get tickets/i }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /vendors/i }).filter({ visible: true })).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));
  expect(violations).toEqual([]);
});

test('a cancelled RSVP event says the RSVP is cancelled', async ({ page }) => {
  await mockEvent(page, event('e2e-cancelled-rsvp', { admissionMode: 'RSVP', priceTiers: [], rsvpRemaining: 10 }));
  await page.goto('/events/e2e-cancelled-rsvp');
  await expect(page.getByRole('status').filter({ hasText: 'Your RSVP has been cancelled' }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /rsvp/i }).filter({ visible: true })).toHaveCount(0);
});
