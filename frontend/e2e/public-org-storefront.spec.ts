// Organization storefront event list: ticket stubs grouped by month in the
// venue's zone, a "Next up" band on the cover, and the #events anchor.
// Backend mocked; no network.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-stubs';
const venue = { id: 'v1', name: 'The Pinhook', address: '117 W Main St, Durham, NC', timezone: 'America/New_York' };
const base = { venue, status: 'PUBLISHED', admissionMode: 'TICKETED', category: 'Tournament', priceRange: { min: 15, max: 25 }, availableTickets: 120 };
const events = [
  { ...base, id: 'e-oct', slug: 'melee-monthly', name: 'Melee Monthly', date: '2026-10-03T23:00:00Z' },
  { ...base, id: 'e-scarce', slug: 'swap-meet', name: 'Swap Meet', date: '2026-10-11T15:00:00Z', priceRange: { min: 5, max: 5 }, availableTickets: 6 },
  { ...base, id: 'e-soldout', slug: 'speedrun-night', name: 'Speedrun Night', date: '2026-10-31T23:30:00Z', availableTickets: 0 },
  // 04:30 UTC on Nov 1 is still Oct 31 at the venue: grouped under October.
  { ...base, id: 'e-late', slug: 'late-show', name: 'Late Show', date: '2026-11-01T03:30:00Z' },
  { ...base, id: 'e-rsvp', slug: 'free-play', name: 'Free Play Friday', date: '2026-11-06T22:00:00Z', admissionMode: 'RSVP', priceRange: null, availableTickets: 0, category: null },
];

async function mockOrg(page: Page, { coverUrl = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' as string | null } = {}) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const organization = { id: ORG_ID, name: 'Stub Org', logoUrl: null, coverUrl, brandColor: '#4338ca', themeMode: 'LIGHT', buyerSignInLinks: false };
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) => route.fulfill(json({ organization, locked: false, events })));
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (route) => route.fulfill(json({ main: [], footer: [] })));
}

test('events render as stubs grouped by month in the venue zone', async ({ page }) => {
  await mockOrg(page);
  await page.goto(`/organizations/${ORG_ID}`);

  const october = page.getByRole('region', { name: 'October' });
  const november = page.getByRole('region', { name: 'November' });
  await expect(october.getByTestId(/^event-card-e-/)).toHaveCount(4);
  await expect(november.getByTestId(/^event-card-e-/)).toHaveCount(1);
  await expect(october.getByTestId('event-card-e-late')).toContainText('31');

  const first = page.getByTestId('event-card-e-oct');
  await expect(first).toHaveAttribute('href', '/events/melee-monthly');
  await expect(first).toContainText('Oct');
  await expect(first).toContainText('7:00 PM EDT');
  await expect(first).toContainText('From');
  await expect(first.getByText('Get tickets')).toBeVisible();

  await expect(page.getByTestId('event-card-e-scarce')).toContainText('Only 6 left');
  await expect(page.getByTestId('event-card-e-oct')).not.toContainText('left');

  const soldOut = page.getByTestId('event-card-e-soldout');
  await expect(soldOut).toContainText('Sold out');
  await expect(soldOut.getByText('Get tickets')).toHaveCount(0);

  const rsvp = page.getByTestId('event-card-e-rsvp');
  await expect(rsvp).toContainText('Free');
  await expect(rsvp.getByText('RSVP', { exact: true })).toBeVisible();
});

test('the cover carries a "Next up" link to the first event', async ({ page }) => {
  await mockOrg(page);
  await page.goto(`/organizations/${ORG_ID}`);

  const nextUp = page.getByRole('link', { name: /Next up\s*Melee Monthly/ });
  await expect(nextUp).toHaveAttribute('href', '/events/melee-monthly');
  await expect(page.getByRole('img', { name: 'Stub Org cover' })).toBeVisible();
});

test('without a cover there is no "Next up" band', async ({ page }) => {
  await mockOrg(page, { coverUrl: null });
  await page.goto(`/organizations/${ORG_ID}`);

  await expect(page.getByTestId('event-card-e-oct')).toBeVisible();
  await expect(page.getByText('Next up')).toHaveCount(0);
});

test('#events scrolls to the list once it loads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await mockOrg(page);
  await page.goto(`/organizations/${ORG_ID}#events`);

  await expect(page.getByRole('heading', { name: 'Upcoming events' })).toBeInViewport();
});
