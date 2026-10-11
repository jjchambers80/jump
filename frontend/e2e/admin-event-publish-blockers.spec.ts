// Publish blockers on Event Details (spec 050-C): a refused publish (422
// EVENT_NOT_READY) lists what to fix, announced, each linking to its editor.
// Mocked API, signInAsStaff, 390 × 844, axe.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-blockers';
const EVENT_ID = 'evt-draft';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const future = new Date(Date.now() + 20 * 86_400_000).toISOString();

const event = {
  id: EVENT_ID, slug: 'spring-swap', name: 'Spring Swap Meet', description: null, logoUrl: null, date: future, endDate: null,
  capacity: null, category: null, status: 'DRAFT', admissionMode: 'TICKETED', rsvpLimit: null, rsvpMaxPartySize: 1, rsvpRemaining: null,
  setupStep: 'tickets', setupCompletedAt: null, tax: { rate: 0, source: null, region: 'NC' }, taxInclusivePricing: false,
  venue: { id: 'venue-1', name: 'Fairgrounds', address: '1 Fair Rd, Raleigh, NC', timezone: 'America/New_York' },
  priceTiers: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};

const overview = {
  event,
  money: { gross: 0, orgReceives: 0, refunded: 0, net: 0, tickets: { orders: 0, gross: 0 }, applications: { orders: 0, gross: 0 } },
  tickets: { issued: 0, checkedIn: 0, voided: 0 },
  rsvp: null,
  addOns: { addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } },
  applications: { forms: [] },
  map: null,
};

const blockers = [
  { code: 'CAPACITY_MISSING', step: 'tickets', message: 'Set the event capacity.' },
  { code: 'NO_ACTIVE_TIER', step: 'tickets', message: 'Add at least one active ticket tier.' },
];

async function mockApi(page: Page) {
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Blockers Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) => route.fulfill(json(overview)));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/publish`, (route) =>
    route.fulfill(json({ error: 'UnprocessableEntityError', message: 'This event is not ready to publish', code: 'EVENT_NOT_READY', details: { blockers, warnings: [] } }, 422))
  );
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'blockers-organizer', email: 'blockers@test.com', role: 'ORGANIZER' }, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
});

test('a refused publish lists the blockers as text with links to fix them', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Spring Swap Meet' })).toBeVisible();

  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  expect((await publish.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await publish.click();

  const alert = page.getByRole('alert').filter({ hasText: 'before publishing' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Fix 2 things before publishing');
  const links = alert.getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(alert.getByRole('link', { name: /Set the event capacity/ })).toHaveAttribute(
    'href',
    `/admin/events/${EVENT_ID}/edit/sales?orgId=${ORG_ID}#event-admission`
  );
  await expect(alert.getByRole('link', { name: /Add at least one active ticket tier/ })).toHaveAttribute(
    'href',
    `/admin/events/${EVENT_ID}/edit/sales?orgId=${ORG_ID}#event-price-tiers`
  );
  for (const box of await Promise.all((await links.all()).map((l) => l.boundingBox()))) {
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  // No horizontal scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const results = await new AxeBuilder({ page }).include('main').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious).toEqual([]);
});
