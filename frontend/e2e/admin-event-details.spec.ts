// Event Details page (spec 037 phase 1): the read-only event home the list
// card opens. Mocked API, signInAsStaff.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-details';
const EVENT_ID = 'evt-details';
const RSVP_ID = 'evt-rsvp';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const venue = { id: 'venue-1', name: 'Convention Center', address: '1 Main St, Raleigh, NC', timezone: 'America/New_York' };
const future = new Date(Date.now() + 20 * 86_400_000).toISOString();

const tier = (over: Record<string, unknown>) => ({
  description: null, quantityReserved: 0, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true,
  saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC', isRefundable: false, saleStatus: 'ON_SALE', ...over,
});

const baseEvent = {
  id: EVENT_ID,
  slug: 'game-and-geek',
  name: 'Game & Geek 2026',
  description: '<p>Two days of tabletop, cosplay and vendors.</p>',
  logoUrl: null,
  date: future,
  capacity: 500,
  category: 'Expo',
  status: 'PUBLISHED',
  admissionMode: 'TICKETED',
  rsvpLimit: null,
  rsvpMaxPartySize: 1,
  rsvpRemaining: null,
  tax: { rate: 0.0725, source: 'MANUAL', region: 'NC' },
  taxInclusivePricing: false,
  venue,
  priceTiers: [
    tier({ id: 't-ga', name: 'General Admission', price: 25, quantityTotal: 400, quantitySold: 120, quantityAvailable: 280 }),
    tier({ id: 't-vip', name: 'VIP', price: 80, quantityTotal: 50, quantitySold: 50, quantityAvailable: 0, displayOrder: 1, isRefundable: true }),
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const overview = {
  event: baseEvent,
  money: { gross: 7400, orgReceives: 7000, refunded: 100, net: 7300, tickets: { orders: 90, gross: 7000 }, applications: { orders: 2, gross: 400 } },
  tickets: { issued: 170, checkedIn: 12, voided: 2 },
  rsvp: null,
  addOns: {
    addOns: [
      { id: 'a1', name: 'Parking pass', scope: 'TICKET', price: 10, isActive: true, quantityTotal: 100, sold: 14, reserved: 0, remaining: 86, revenue: 140, orders: { quantity: 14, revenue: 140, lines: 14 }, applications: { quantity: 0, revenue: 0, lines: 0, held: 0, pending: 0 } },
    ],
    totals: { sold: 14, reserved: 0, revenue: 140 },
  },
  applications: {
    forms: [
      {
        id: 'form-1', name: 'Vendors', slug: 'vendors', kind: 'PAID', status: 'OPEN', opensAt: null, closesAt: null, paid: true,
        counts: { SUBMITTED: 3, WAITLISTED: 1, APPROVED: 4, REJECTED: 1, WITHDRAWN: 0 },
        total: 9, approvedSettled: 2, approvedAwaitingPayment: 2,
        tiers: [{ id: 'at-1', name: '10x10 Booth', price: 200, quantityTotal: 20, quantityApproved: 4, quantityReserved: 0, isActive: true, booths: 20 }],
      },
    ],
  },
  map: {
    id: 'map-1', name: 'Hall A', status: 'PUBLISHED', publishedAt: future, updatedAt: future,
    booths: { AVAILABLE: 15, HELD: 1, SOLD: 3, RESERVED: 1, BLOCKED: 0 }, boothTotal: 20, unassignedBooths: 2,
  },
};

const rsvpOverview = {
  ...overview,
  event: { ...baseEvent, id: RSVP_ID, name: 'Community Meetup', admissionMode: 'RSVP', rsvpLimit: 40, rsvpMaxPartySize: 2, rsvpRemaining: 31, priceTiers: [] },
  money: { gross: 0, orgReceives: 0, refunded: 0, net: 0, tickets: { orders: 0, gross: 0 }, applications: { orders: 0, gross: 0 } },
  tickets: null,
  rsvp: { going: 6, headcount: 9, cancelled: 1, remaining: 31 },
  addOns: { addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } },
  applications: { forms: [] },
  map: null,
};

async function mockApi(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Details Org', status: 'ACTIVE' }]))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) => route.fulfill(json(overview)));
  await page.route(`${API}/organizations/${ORG_ID}/events/${RSVP_ID}/overview`, (route) => route.fulfill(json(rsvpOverview)));
  await page.route(`${API}/organizations/${ORG_ID}/events/missing/overview`, (route) =>
    route.fulfill(json({ error: 'Event not found' }, 404))
  );
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'details-admin', email: 'details-admin@test.com', role: 'ADMIN' }, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
});

test('shows the event read-only, with an Edit link per section', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Game & Geek 2026' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/admin/events');

  // No form fields: this page never edits in place.
  await expect(page.getByRole('textbox')).toHaveCount(0);

  const edits: [string, string][] = [
    ['Edit tiers and add-ons', 'event-price-tiers'],
    ['Edit event details', 'event-details'],
    ['Edit date and venue', 'event-when-where'],
    ['Edit admission', 'event-admission'],
    ['Edit listing', 'event-listing'],
  ];
  for (const [name, anchor] of edits) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}#${anchor}`
    );
  }
  await expect(page.getByRole('link', { name: 'Open the map builder' })).toHaveAttribute('href', '/admin/maps/map-1');
  await expect(page.getByRole('link', { name: 'Edit form Vendors' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/applications/forms/form-1`);
});

test('headline numbers, tiers, applications and the map', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);

  const hero = page.getByRole('region', { name: 'Game & Geek 2026' });
  await expect(hero.getByText('$7,400.00')).toBeVisible();
  await expect(hero.getByText('170', { exact: true })).toBeVisible(); // tickets sold
  await expect(hero.getByText('3 to review')).toBeVisible();

  const sales = page.getByRole('region', { name: 'Sales' });
  await expect(sales.getByRole('cell', { name: 'General Admission' })).toBeVisible();
  await expect(sales.getByText('Parking pass')).toBeVisible();
  await expect(sales.getByRole('link', { name: /Orders/ })).toHaveAttribute('href', `/admin/orders?eventId=${EVENT_ID}`);

  const apps = page.getByRole('region', { name: 'Applications' });
  await expect(apps.getByRole('img', { name: /9 applications: 3 to review/ })).toBeVisible();
  await expect(apps.getByText('2 awaiting payment')).toBeVisible();

  const map = page.getByRole('region', { name: 'Floor map' });
  await expect(map.getByRole('img', { name: /20 booths: 3 sold/ })).toBeVisible();
  await expect(map.getByText(/2 booths have no vendor space tier/)).toBeVisible();

  // Venue wall clock with its zone (spec 033).
  await expect(page.getByRole('region', { name: 'Date & venue' }).getByText(/E[DS]T$/)).toBeVisible();
});

test('workspace tabs link the event pages together', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  const tabs = page.getByRole('navigation', { name: 'Event pages' });
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: /Applications/ })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/applications`);
  await expect(tabs.getByRole('link', { name: 'Floor map' })).toHaveAttribute('href', '/admin/maps/map-1');
  await expect(tabs.getByRole('link', { name: 'Analytics' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Door check-in' })).toBeVisible();
});

test('an RSVP event shows its guests instead of sales', async ({ page }) => {
  await page.goto(`/admin/events/${RSVP_ID}?orgId=${ORG_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Community Meetup' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sales' })).toHaveCount(0);
  const rsvps = page.getByRole('region', { name: 'RSVPs' });
  await expect(rsvps.getByText('of 40 guests')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Event pages' }).getByRole('link', { name: 'Guest list' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Applications' }).getByRole('link', { name: 'Set up an application form' })).toBeVisible();
});

test('an event of another organization reads as not found', async ({ page }) => {
  await page.goto(`/admin/events/missing?orgId=${ORG_ID}`);
  await expect(page.getByRole('alert').filter({ hasText: 'not in the selected organization' })).toBeVisible();
});

test('no horizontal scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Game & Geek 2026' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
