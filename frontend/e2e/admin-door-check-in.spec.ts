// Admin › Event › Door check-in (spec 036) — backend mocked.
//
// Everything here runs at a phone viewport, because that is the only device
// this page is ever used on. The tests cover the three things that decide
// whether the door works on event day: the arrivals count tracks the records,
// a double-tap sends exactly one request, and a request that fails on venue
// wifi is retried and visibly reported rather than silently lost.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-door';
const EVENT_ID = 'evt-door';

// An iPhone-sized window: this page is designed for one hand at a loading dock.
test.use({ viewport: { width: 390, height: 844 } });

type Vendor = {
  id: string;
  shortId: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  formName: string | null;
  tierName: string | null;
  booth: { id: string; mapId: string; label: string; status: string } | null;
  boothLabel: string | null;
  checkedInAt: string | null;
  checkedInById: string | null;
  checkedInVia: 'SEARCH' | 'SCAN' | 'TOGGLE' | null;
};

function vendor(id: string, businessName: string, boothLabel: string | null, checkedInAt: string | null = null): Vendor {
  return {
    id,
    shortId: id.slice(-8).toUpperCase(),
    businessName,
    contactName: 'Val Vendor',
    email: `${id}@vendors.test`,
    phone: null,
    formName: 'Vendors',
    tierName: '10x10 Booth',
    booth: boothLabel ? { id: `booth-${boothLabel}`, mapId: 'map-1', label: boothLabel, status: 'SOLD' } : null,
    boothLabel,
    checkedInAt,
    checkedInById: null,
    checkedInVia: null,
  };
}

/**
 * Mock the door API over an in-memory roster that behaves like the real one:
 * check-in is idempotent, so the second call returns the first timestamp and
 * `alreadyCheckedIn: true`.
 */
async function mockDoor(page: Page, vendors: Vendor[], opts: { failFirstCheckIn?: boolean } = {}) {
  const state = new Map(vendors.map((v) => [v.id, { ...v }]));
  const calls: string[] = [];
  let failedOnce = false;

  // The admin shell resolves the active org from this list; without it every
  // org-scoped page stays on its loading state.
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: ORG_ID, name: 'Door Org', slug: 'door-org', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }]),
    })
  );

  await page.route(`${API}/admin/events/${EVENT_ID}/check-in`, (route) => {
    // Mirror the service's ordering: people still to check in come first, so
    // the list reads as a work queue. Rows do not re-sort after a check-in —
    // the page keeps server order so a row never jumps under a staffer's thumb.
    const rows = [...state.values()].sort((a, b) => {
      if (Boolean(a.checkedInAt) !== Boolean(b.checkedInAt)) return a.checkedInAt ? 1 : -1;
      return a.businessName.localeCompare(b.businessName);
    });
    const arrived = rows.filter((v) => v.checkedInAt).length;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        event: { id: EVENT_ID, name: 'Spring Expo', date: '2027-04-10T15:00:00.000Z', venueName: 'Raleigh Hall', timezone: 'America/New_York' },
        counts: { expected: rows.length, arrived, awaiting: rows.length - arrived },
        data: rows,
      }),
    });
  });

  await page.route(`${API}/admin/events/${EVENT_ID}/check-in/*`, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const row = state.get(id);
    if (!row) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Application not found' }) });

    if (route.request().method() === 'DELETE') {
      row.checkedInAt = null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alreadyCheckedIn: false, vendor: row }) });
    }

    calls.push(id);
    if (opts.failFirstCheckIn && !failedOnce) {
      failedOnce = true;
      // What venue wifi actually does: the request dies in transit.
      return route.abort('connectionfailed');
    }

    const alreadyCheckedIn = Boolean(row.checkedInAt);
    if (!alreadyCheckedIn) row.checkedInAt = '2027-04-10T14:04:00.000Z';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alreadyCheckedIn, vendor: row }) });
  });

  return { calls, state };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'door-admin', email: 'door-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('shows the roster with arrivals count and booth assignments at a phone width', async ({ page }) => {
  await mockDoor(page, [
    vendor('app-clay', 'Clay & Co', 'B12'),
    vendor('app-amps', 'Amps Anonymous', 'A3', '2027-04-10T13:30:00.000Z'),
    vendor('app-nobooth', 'Nomad Knives', null),
  ]);
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await expect(page.getByRole('heading', { name: 'Door check-in' })).toBeVisible();
  await expect(page.getByTestId('arrived-count')).toHaveText('1');
  await expect(page.getByLabel('Arrivals')).toContainText('2 still to arrive');

  const rows = page.getByTestId('vendor-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Clay & Co');
  await expect(rows.nth(0)).toContainText('Booth B12');
  // A vendor with no booth is called out rather than shown blank — an
  // unassigned vendor at the door is a problem staff must notice.
  await expect(page.getByTestId('vendor-row').filter({ hasText: 'Nomad Knives' })).toContainText('No booth assigned');
  // Already-arrived vendors sink below the queue of people still to check in.
  await expect(rows.nth(2)).toContainText('Amps Anonymous');
  await expect(rows.nth(2)).toContainText('Arrived');

  // Evidence artifact, not a visual-diff gate: no other spec in this suite
  // keeps committed baselines, and a pixel comparison across CI platforms
  // would be a flake, not a check.
  await page.screenshot({ path: 'test-results/door-check-in-phone.png', fullPage: true });
});

test('search filters the roster but leaves the arrivals count alone', async ({ page }) => {
  await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12'), vendor('app-amps', 'Amps Anonymous', 'A3')]);
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);
  await expect(page.getByTestId('vendor-row')).toHaveCount(2);

  await page.getByLabel('Search vendors').fill('amps');
  await expect(page.getByTestId('vendor-row')).toHaveCount(1);
  await expect(page.getByTestId('vendor-row')).toContainText('Amps Anonymous');
  // The header describes the event, not the filter.
  await expect(page.getByLabel('Arrivals')).toContainText('/ 2');

  // Booth number is a first-class way to find someone at a door.
  await page.getByLabel('Search vendors').fill('B12');
  await expect(page.getByTestId('vendor-row')).toContainText('Clay & Co');
});

test('checking in updates the count and the row', async ({ page }) => {
  await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12')]);
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await expect(page.getByTestId('arrived-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Check in' }).click();

  await expect(page.getByTestId('vendor-row')).toContainText('Arrived');
  await expect(page.getByTestId('arrived-count')).toHaveText('1');
  await expect(page.getByTestId('vendor-row')).toHaveAttribute('data-arrived', 'true');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('a double-tap sends one check-in, not two', async ({ page }) => {
  const door = await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12')]);
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  const button = page.getByRole('button', { name: 'Check in' });
  await button.dblclick();

  await expect(page.getByTestId('vendor-row')).toContainText('Arrived');
  // The button disables itself while the request is in flight and the queue
  // drops a duplicate for the same vendor, so an impatient thumb at a busy
  // door cannot stack requests. (The backend would be idempotent anyway.)
  expect(door.calls).toEqual(['app-clay']);
});

test('a dropped request is retried and the row says so until it lands', async ({ page }) => {
  const door = await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12')], { failFirstCheckIn: true });
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await page.getByRole('button', { name: 'Check in' }).click();

  // Staff are told the check-in has not landed yet — never left guessing.
  await expect(page.getByTestId('vendor-row')).toContainText('Not sent — retrying');
  // …and the queue sends it again without anyone tapping.
  await expect(page.getByTestId('vendor-row')).toContainText('Arrived', { timeout: 15000 });
  await expect(page.getByTestId('arrived-count')).toHaveText('1');
  expect(door.calls).toEqual(['app-clay', 'app-clay']);
});

test('undo clears an arrival recorded by mistake', async ({ page }) => {
  await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12', '2027-04-10T13:30:00.000Z')]);
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await expect(page.getByTestId('arrived-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByTestId('arrived-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Check in' })).toBeVisible();
});

test('scanning a pass that is already checked in says so instead of stamping again', async ({ page }) => {
  await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12', '2027-04-10T13:30:00.000Z')]);
  await page.route(`${API}/admin/events/${EVENT_ID}/check-in/scan`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vendor('app-clay', 'Clay & Co', 'B12', '2027-04-10T13:30:00.000Z')),
    })
  );
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await page.getByRole('button', { name: 'Scan' }).click();
  // The camera is unavailable in CI, which is exactly why manual entry exists.
  await page.getByLabel('Vendor pass code').fill(`jump://vendor?id=app-clay&e=${EVENT_ID}&t=${'a'.repeat(64)}`);
  await page.getByRole('button', { name: 'Look up' }).click();

  await expect(page.getByTestId('door-notice')).toContainText('Clay & Co already arrived');
  await expect(page.getByTestId('arrived-count')).toHaveText('1');
});

test('a pass from another event is refused at this door', async ({ page }) => {
  await mockDoor(page, [vendor('app-clay', 'Clay & Co', 'B12')]);
  await page.route(`${API}/admin/events/${EVENT_ID}/check-in/scan`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'NotFoundError', message: 'No vendor on this event matches that pass' }),
    })
  );
  await page.goto(`/admin/events/${EVENT_ID}/check-in`);

  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByLabel('Vendor pass code').fill(`jump://vendor?id=app-rival&e=other-event&t=${'b'.repeat(64)}`);
  await page.getByRole('button', { name: 'Look up' }).click();

  await expect(page.getByTestId('door-error')).toContainText('No vendor on this event matches that pass');
  await expect(page.getByTestId('arrived-count')).toHaveText('0');
});
