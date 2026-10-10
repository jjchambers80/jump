// Draft event preview (spec 050 F): the staff link sets the host-only httpOnly
// `jump_event_preview` cookie and opens the event page; the page forwards it
// as X-Event-Preview and shows the preview bar only when the backend answers
// `preview: true`. Checkout, RSVP and apply are off. The API is mocked.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const EVENT_ID = 'e2e-draft-preview';
const TOKEN = 'fixture-event-preview';

/** Unsigned stand-in: the Next route only reads `eventId` / `exp`; the backend verifies. */
const LINK_EXP = Math.floor(Date.now() / 1000) + 3600;
const linkToken = (eventId: string) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ eventId, exp: LINK_EXP })).toString('base64url'),
    'sig',
  ].join('.');

function draftEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: EVENT_ID,
    name: 'Draft Market',
    description: '<p>Coming soon.</p>',
    logoUrl: null,
    date: '2031-06-01T23:00:00.000Z',
    capacity: 100,
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    taxRate: 0,
    organizationId: 'org-draft',
    organizationName: 'Draft Org',
    organizationBrandColor: '#0f766e',
    organizationThemeMode: 'LIGHT',
    organizationSignInLinks: false,
    venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [
      { id: 't1', name: 'General', description: null, price: 20, quantityTotal: 100, quantitySold: 0, quantityReserved: 0, quantityAvailable: 100, displayOrder: 0, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preview: true,
    ...overrides,
  };
}

/** The backend's rule: a DRAFT answers only to the right X-Event-Preview, else 404. */
async function mockEvent(page: Page, event: Record<string, unknown>, token = TOKEN) {
  const seen: (string | undefined)[] = [];
  await page.route(`${API}/events/${event.id}`, (route) => {
    const header = route.request().headers()['x-event-preview'];
    seen.push(header);
    return header === token
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(event) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NotFoundError', message: 'Event not found' }) });
  });
  await page.route(`${API}/events/${event.id}/applications/forms`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'f1', slug: 'vendors', name: 'Vendor application', acceptance: { open: true, reason: null } }] }),
    })
  );
  await page.route(`${API}/events/${event.id}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await mockLegalVersions(page, API);
  return seen;
}

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.use({ viewport: { width: 390, height: 844 } });

test('staff link sets the cookie, renders the draft and turns commerce off', async ({ page, context }) => {
  const seen = await mockEvent(page, draftEvent(), linkToken(EVENT_ID));
  await page.goto(`/api/events/preview?token=${encodeURIComponent(linkToken(EVENT_ID))}`);
  await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}$`));

  const cookie = (await context.cookies()).find((c) => c.name === 'jump_event_preview');
  expect(cookie).toMatchObject({ httpOnly: true, path: '/', domain: 'localhost' });

  const bar = page.getByRole('region', { name: 'Event preview' });
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar).toContainText('Preview, not published');
  expect(seen).toContain(linkToken(EVENT_ID));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // Apply: the pill shows but opens nothing.
  await expect(page.getByTestId('get-involved').getByRole('link')).toHaveCount(0);
  // Checkout: a ticket goes in the cart, but checkout stays disabled.
  await page.getByRole('button', { name: 'Increase General quantity' }).filter({ visible: true }).first().click();
  const checkout = page.getByRole('button', { name: /Checkout/ }).filter({ visible: true }).first();
  await expect(checkout).toBeDisabled();

  // No horizontal scroll at 320px.
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });

  expect(await seriousViolations(page)).toEqual([]);

  // Exit expires the cookie.
  await bar.getByRole('link', { name: 'Exit preview' }).click();
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === 'jump_event_preview')).toBe(false);
});

test('without the cookie a draft is a 404 and there is no bar', async ({ page }) => {
  await mockEvent(page, draftEvent());
  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByText(/Event not found|Failed to load/).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('event-preview-bar')).toHaveCount(0);
});

test('the cookie alone never turns preview mode on', async ({ page, context }) => {
  // The backend answered without `preview: true` (e.g. a published event, token refused): no bar.
  await mockEvent(page, draftEvent({ status: 'PUBLISHED', preview: undefined }));
  await context.addCookies([{ name: 'jump_event_preview', value: TOKEN, domain: 'localhost', path: '/' }]);
  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Draft Market' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('event-preview-bar')).toHaveCount(0);
});

test('RSVP preview: the pass shows but never submits', async ({ page, context }) => {
  await mockEvent(page, draftEvent({ admissionMode: 'RSVP', priceTiers: [], rsvpLimit: 50, rsvpMaxPartySize: 2, rsvpRemaining: 50 }));
  let posted = false;
  await page.route(`${API}/events/${EVENT_ID}/rsvps`, (route) => {
    posted = true;
    return route.fulfill({ status: 202, body: '{}' });
  });
  await context.addCookies([{ name: 'jump_event_preview', value: TOKEN, domain: 'localhost', path: '/' }]);
  await page.goto(`/events/${EVENT_ID}`);
  const pass = page.locator('#rsvp-pass');
  await expect(pass.getByRole('button', { name: 'Reserve my spot' })).toBeDisabled({ timeout: 30000 });
  expect(posted).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
});

test('themed org: the draft renders inside the theme frame', async ({ page, context }) => {
  // The fixture API answers this draft's /meta only with the forwarded token (server side).
  await mockEvent(page, draftEvent({ id: 'draft-preview-event', slug: 'draft-preview-event', organizationId: 'theme-light' }));
  await context.addCookies([{ name: 'jump_event_preview', value: TOKEN, domain: 'localhost', path: '/' }]);
  await page.goto('/events/draft-preview-event');
  await expect(page.getByRole('region', { name: 'Event preview' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-theme-frame]')).toHaveCount(1);
  await expect(page.locator('[data-section="Header"]')).toHaveCount(1);
});
