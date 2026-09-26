// Public floor map (spec 014 phase 1): /events/:id/map — backend mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const EVENT = {
  id: 'ev-map',
  slug: 'ev-map',
  name: 'Map Expo',
  date: '2027-06-01T15:00:00.000Z',
  status: 'PUBLISHED',
  capacity: 100,
  venue: { id: 've-1', name: 'Hall', address: '1 St', city: 'Raleigh', state: 'NC' },
  priceTiers: [],
  organizationId: 'org-map',
  organizationName: 'Map Org',
  organizationLogoUrl: null,
  organizationBrandColor: '#b91c1c',
  organizationThemeMode: 'SYSTEM',
  taxRate: 0,
  taxInclusivePricing: false,
};
type MockVendor = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  socials: Record<string, string>;
  imageUrl: string | null;
  category: string;
  tier: { id: string; name: string } | null;
  booth: { id: string; label: string } | null;
};
const MAP = {
  id: 'map-1',
  eventId: 'ev-map',
  name: 'Main hall',
  width: 40,
  height: 20,
  unit: 'ft',
  gridSize: 10,
  layout: { version: 1, elements: [{ id: 'e1', kind: 'stage', x: 0, y: 14, w: 10, h: 4, caption: 'Stage' }] },
  underlayFileId: null,
  underlayUrl: null,
  underlayOpacity: 40,
  legend: [{ tierId: 't-1', name: '10×10 booth', price: 275, swatch: 0 }],
  vendors: [
    {
      id: 'application-acme',
      name: 'Acme Crafts',
      description: 'Handmade goods for curious people.',
      website: 'https://acme.example',
      socials: { instagram: 'acmecrafts' },
      imageUrl: null,
      category: 'Artisan vendors',
      tier: { id: 't-1', name: '10×10 booth' },
      booth: { id: 'b-1', label: 'A1' },
    },
  ] as MockVendor[],
  booths: [
    { id: 'b-1', label: 'A1', kind: 'BOOTH', x: 0, y: 0, w: 10, h: 10, rotation: 0, status: 'SOLD', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: 'Acme Crafts' },
    { id: 'b-2', label: 'A2', kind: 'BOOTH', x: 12, y: 0, w: 10, h: 10, rotation: 0, status: 'AVAILABLE', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: null },
    { id: 'b-3', label: 'A3', kind: 'BOOTH', x: 24, y: 0, w: 10, h: 10, rotation: 0, status: 'BLOCKED', tier: null, vendorName: null },
    // A vendor is mid-checkout on A4. Taken to every other visitor, but not
    // sold — so the map must not name a holder for it. See spec 014 phase 2.
    { id: 'b-4', label: 'A4', kind: 'BOOTH', x: 12, y: 11, w: 8, h: 8, rotation: 0, status: 'HELD', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: null },
  ],
  brandColor: '#b91c1c',
  themeMode: 'SYSTEM',
  updatedAt: '2026-09-21T00:00:00.000Z',
  etag: '"1"',
};

async function mockEvent(page: Page, { published = true, vendors = MAP.vendors } = {}) {
  await page.route(`${API}/events/ev-map/meta`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: 'ev-map' }) })
  );
  await page.route(`${API}/events/ev-map`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EVENT) })
  );
  await page.route(`${API}/events/ev-map/map`, (route) =>
    published
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store', ETag: MAP.etag },
          body: JSON.stringify({ ...MAP, vendors }),
        })
      : route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Map not published for this event' }),
        })
  );
  await page.route(`${API}/organizations/org-map/public/menus`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ main: [], footer: [] }) })
  );
}

test.describe('public floor map', () => {
  test('renders the legend, booth states and the sold vendor', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map/map');
    await expect(page.getByText('10×10 booth').first()).toBeVisible();
    await expect(page.getByText('$275.00').first()).toBeVisible();
    const sold = page.getByTestId('booth-A1');
    await expect(sold).toBeVisible();
    await expect(sold).toHaveAttribute('aria-label', /Booth A1, 10 by 10/);
    await expect(page.getByTestId('booth-A2')).toBeVisible();
    await expect(page.getByTestId('booth-A3')).toBeVisible();

    await sold.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Sheet (mobile) and popover (desktop) both mount; only the viewport's copy is visible.
    await expect(page.getByText('Sold to Acme Crafts').locator('visible=true')).toHaveCount(1);
  });

  test('tells open booths apart from taken ones, and never names a holder mid-checkout', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map/map');

    // Open vs. taken has to be legible at a glance, so each state carries its
    // own word in the accessible name — not just a fill colour.
    await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-label', /Available$/);
    await expect(page.getByTestId('booth-A1')).toHaveAttribute('aria-label', /Sold$/);
    await expect(page.getByTestId('booth-A4')).toHaveAttribute('aria-label', /Held$/);
    await expect(page.getByTestId('booth-A3')).toHaveAttribute('aria-label', /Blocked$/);

    // Every state on the map has to be named in the legend, Held included —
    // an amber booth with a clock on it is meaningless otherwise.
    for (const state of ['Available', 'Held', 'Sold', 'Reserved', 'Blocked']) {
      await expect(page.getByText(state, { exact: true }).locator('visible=true').first()).toBeVisible();
    }

    // test-results/ is gitignored; this is the open-vs-taken evidence shot,
    // taken before any selection so the whole floor is in frame.
    await page.screenshot({ path: 'test-results/public-map-booth-states.png', fullPage: true });

    await page.getByTestId('booth-A4').click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Booth A4' })).toBeVisible();
    // A hold is not a sale: whoever is checking out stays anonymous until they pay.
    await expect(page.getByText(/Sold to/).locator('visible=true')).toHaveCount(0);
  });

  test('?booth= accepts stable booth ids and legacy labels', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map/map?booth=b-2');
    await expect(page.getByTestId('booth-A2')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Booth A2' })).toBeVisible();

    await page.goto('/events/ev-map/map?booth=A1');
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Booth A1' })).toBeVisible();
  });

  test('renders, searches and locates vendors from the directory', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map/map');
    const directory = page.getByTestId('vendor-directory');
    await expect(directory.getByRole('heading', { name: 'Vendor directory' })).toBeVisible({ timeout: 15_000 });
    await expect(directory.getByRole('heading', { name: 'Acme Crafts' })).toBeVisible();
    await expect(directory.getByRole('listitem').getByText('Artisan vendors')).toBeVisible();
    await directory.getByPlaceholder('Search vendors, categories or booths').fill('missing');
    await expect(directory.getByText('No vendors match your search.')).toBeVisible();
    await directory.getByPlaceholder('Search vendors, categories or booths').fill('A1');
    const boothLink = directory.getByRole('link', { name: 'View booth A1' });
    await expect(boothLink).toHaveAttribute('href', '/events/ev-map/map?booth=b-1');
    await boothLink.press('Enter');
    await expect(page).toHaveURL(/\/events\/ev-map\/map\?booth=b-1$/);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Sold to Acme Crafts').locator('visible=true')).toHaveCount(1);
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Permanent link to Acme Crafts at booth A1' })).toHaveAttribute('href', '/events/ev-map/map?booth=b-1');

    await page.reload();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Booth A1' })).toBeVisible();
  });

  test('shows a clear fallback for an unassigned vendor', async ({ page }) => {
    await mockEvent(page, {
      vendors: [{ ...MAP.vendors[0], id: 'application-unassigned', name: 'No Booth Books', booth: null }],
    });
    await page.goto('/events/ev-map/map');
    const directory = page.getByTestId('vendor-directory');
    await expect(directory.getByRole('heading', { name: 'No Booth Books' })).toBeVisible();
    await expect(directory.getByText('Booth to be announced')).toBeVisible();
    await expect(directory.getByRole('link', { name: /View booth/ })).toHaveCount(0);
  });

  test('reports a booth id that does not belong to this event map', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map/map?booth=booth-from-another-event');
    await expect(page.getByText('Booth “booth-from-another-event” was not found on this event map.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('shows the directory empty state', async ({ page }) => {
    await mockEvent(page, { vendors: [] });
    await page.goto('/events/ev-map/map');
    await expect(page.getByText('Vendor directory coming soon')).toBeVisible();
  });

  test('an unpublished map is not available', async ({ page }) => {
    await mockEvent(page, { published: false });
    await page.goto('/events/ev-map/map');
    await expect(page.getByText('Floor Map Not Available')).toBeVisible();
    await expect(page.getByTestId('booth-A1')).toHaveCount(0);
  });

  test('the event page shows a floor map preview only when published', async ({ page }) => {
    await mockEvent(page);
    await page.goto('/events/ev-map');
    await expect(page.getByRole('heading', { name: 'Floor map' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /Open map/ })).toHaveAttribute('href', '/events/ev-map/map');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockEvent(page, { published: false });
    await page.goto('/events/ev-map');
    await expect(page.getByRole('heading', { name: 'Floor map' })).toHaveCount(0);
  });
});
