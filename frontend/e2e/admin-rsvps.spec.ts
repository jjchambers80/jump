// Admin › Event › RSVPs (spec 034): the headcount an organizer watches on
// event day. It re-reads itself on a timer and on demand, keeps the last good
// numbers when a poll fails, and the table scrolls rather than clipping on a
// phone. Mock API, signInAsStaff.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-rsvps';
const EVENT_ID = 'evt-rsvps';
const STAFF = { id: 'user-rsvps', email: 'organizer@example.test', role: 'ADMIN' as const, name: 'Rosa Organizer' };

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const row = (id: string, firstName: string, partySize: number, status = 'GOING') => ({
  id,
  firstName,
  lastName: 'Guest',
  email: `${firstName.toLowerCase()}@example.test`,
  partySize,
  status,
  subscribed: status === 'GOING',
  createdAt: '2026-09-20T18:00:00Z',
  cancelledAt: status === 'CANCELLED' ? '2026-09-21T18:00:00Z' : null,
});

const firstLoad = {
  headcount: 6,
  rsvpCount: 3,
  cancelledCount: 0,
  data: [row('r1', 'Ada', 3), row('r2', 'Bea', 2), row('r3', 'Cy', 1)],
};

const secondLoad = {
  headcount: 7,
  rsvpCount: 3,
  cancelledCount: 1,
  data: [row('r2', 'Bea', 2), row('r3', 'Cy', 1), row('r4', 'Dee', 4), row('r1', 'Ada', 3, 'CANCELLED')],
};

/** Serves firstLoad, then every payload queued after it. Returns the call count. */
async function mockRsvps(page: Page, later: Array<unknown | 'error'> = []) {
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'RSVP Org', status: 'ACTIVE' }])));
  const calls = { count: 0 };
  await page.route(`${API}/admin/events/${EVENT_ID}/rsvps`, (route) => {
    const next = calls.count === 0 ? firstLoad : later[calls.count - 1] ?? later[later.length - 1] ?? firstLoad;
    calls.count += 1;
    if (next === 'error') return route.fulfill(json({ error: 'boom' }, 500));
    return route.fulfill(json(next));
  });
  return calls;
}

test('the headcount summary matches the rows and refreshes on demand', async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
  await mockRsvps(page, [secondLoad]);
  await page.goto(`/admin/events/${EVENT_ID}/rsvps`);

  await expect(page.getByTestId('rsvp-headcount')).toHaveText('6');
  await expect(page.getByTestId('rsvp-updated-at')).toBeVisible();
  // 3 going rows, 3 + 2 + 1 = the headcount above.
  await expect(page.locator('tbody tr')).toHaveCount(3);

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('rsvp-headcount')).toHaveText('7');
  // One more going row plus the cancelled one, still struck through in place.
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('tbody tr').filter({ hasText: 'Cancelled' })).toHaveCount(1);
});

test('a failed background refresh keeps the last good numbers on screen', async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
  await mockRsvps(page, ['error']);
  await page.goto(`/admin/events/${EVENT_ID}/rsvps`);
  await expect(page.getByTestId('rsvp-headcount')).toHaveText('6');

  await page.getByRole('button', { name: 'Refresh' }).click();
  // No error page, no empty table: the organizer keeps looking at real numbers.
  await expect(page.getByTestId('rsvp-headcount')).toHaveText('6');
  await expect(page.locator('tbody tr')).toHaveCount(3);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the summary cards stack and the table scrolls instead of clipping', async ({ page, baseURL }) => {
    await signInAsStaff(page, STAFF, baseURL!);
    await mockRsvps(page);
    await page.goto(`/admin/events/${EVENT_ID}/rsvps`);

    await expect(page.getByTestId('rsvp-headcount')).toHaveText('6');
    const scroller = page.locator('table').locator('..');
    const size = await scroller.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    // Wider content than the viewport must scroll, not be cut off.
    expect(size.scroll).toBeGreaterThan(size.client);
    await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(page.getByRole('columnheader', { name: "RSVP'd At" })).toBeInViewport();
  });
});
