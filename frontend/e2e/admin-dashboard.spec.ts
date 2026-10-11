// Admin dashboard: headline numbers, 14-day trend, upcoming events, needs
// attention (publish a draft, review applications) and recent orders, on a
// phone and on desktop. Backend mocked at the network layer; the overview
// payload is covered by backend/tests/contract/dashboardOverview.test.js.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const stats = { totalCapacity: 5000, ticketsSold: 17, remainingCapacity: 4983, ticketsRedeemed: 4, salesRate: 0, paymentSuccessRate: 98, revenue: { orders: 1144, applications: 160, gross: 1304 } };

function overview() {
  const trend = Array.from({ length: 14 }, (_, i) => ({
    date: `2027-03-${String(i + 1).padStart(2, '0')}`,
    revenue: i === 13 ? 40 : i === 10 ? 20 : 0,
    orders: i === 13 || i === 10 ? 1 : 0,
    tickets: i === 13 ? 2 : i === 10 ? 1 : 0,
  }));
  return {
    timeZone: 'America/New_York',
    trend,
    upcoming: [
      { id: 'evt-expo', name: 'Game and Geek Expo', date: '2027-04-10T14:00:00.000Z', status: 'PUBLISHED', admissionMode: 'TICKETED', venueName: 'Convention Center', timezone: 'America/New_York', sold: 15, capacity: 5000 },
      { id: 'evt-meetup', name: 'Retro Meetup', date: '2027-04-20T23:00:00.000Z', status: 'PUBLISHED', admissionMode: 'RSVP', venueName: 'Arcade', timezone: 'America/Chicago', sold: 12, capacity: 40 },
    ],
    recentOrders: [
      { id: 'ord-1', orderRef: 'A-1', kind: 'TICKET', status: 'COMPLETED', total: 40, quantity: 2, at: new Date().toISOString(), buyer: 'Bea Buyer', eventName: 'Game and Geek Expo' },
      { id: 'ord-2', orderRef: 'A-2', kind: 'APPLICATION', status: 'COMPLETED', total: 160, quantity: 1, at: new Date(Date.now() - 3_600_000).toISOString(), buyer: 'Vic Vendor', eventName: 'Game and Geek Expo' },
    ],
    checkedInLast24h: 3,
    attention: {
      draftEvents: [{ id: 'evt-draft', name: 'Summer Market', date: '2027-06-07T16:00:00.000Z', timezone: 'America/New_York' }],
      applicationsToReview: [{ eventId: 'evt-expo', formId: null, name: 'Game and Geek Expo', count: 3 }],
    },
  };
}

const notReady = {
  error: 'UnprocessableEntityError', message: 'This event is not ready to publish', code: 'EVENT_NOT_READY',
  details: { blockers: [{ code: 'NO_ACTIVE_TIER', step: 'tickets', message: 'Add at least one active ticket tier.' }], warnings: [] },
};

async function mockApi(page: Page, { refuse = false } = {}) {
  const calls = { publish: 0, overviewTz: '' };
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/organizations') return route.fulfill(json([{ id: 'org-dash', name: 'Raleigh Retro Gamers', status: 'ACTIVE' }]));
    if (url.pathname === '/admin/dashboard/stats') return route.fulfill(json(stats));
    if (url.pathname === '/admin/dashboard/overview') {
      calls.overviewTz = url.searchParams.get('tz') ?? '';
      return route.fulfill(json(overview()));
    }
    // Spec 050-C: the org-scoped publish route (the old /admin/events/:id/publish never existed).
    if (url.pathname === '/organizations/org-dash/events/evt-draft/publish') {
      calls.publish += 1;
      if (refuse) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(notReady) });
      return route.fulfill(json({ id: 'evt-draft', status: 'PUBLISHED' }));
    }
    return route.fulfill(json({}));
  });
  return calls;
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'dash-admin', email: 'dash-admin@test.com', role: 'ADMIN', name: 'Jo Organizer' }, baseURL!);
});

test('shows the bird’s-eye view and acts on what needs attention', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/admin/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Welcome back, Jo')).toBeVisible();

  const kpis = page.getByTestId('dashboard-kpis');
  await expect(kpis).toContainText('$1,304');
  await expect(kpis).toContainText('$1,144 orders · $160 applications');
  await expect(kpis).toContainText('3 in the last 24 hours');
  await expect(kpis).toContainText('$60 · 98% payment success');
  expect(calls.overviewTz).not.toBe('');

  const trend = page.getByTestId('sales-trend');
  await expect(trend).toContainText('$60');
  await page.getByRole('button', { name: 'Tickets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tickets', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(trend).toContainText('tickets sold');

  const upcoming = page.getByTestId('upcoming-events');
  await expect(upcoming.getByRole('link', { name: /Game and Geek Expo/ })).toHaveAttribute('href', '/admin/events/evt-expo');
  await expect(upcoming.getByRole('meter', { name: 'Retro Meetup: going' })).toHaveAttribute('aria-valuetext', '12 of 40 going, 30%');
  await expect(upcoming).toContainText('CDT');

  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByRole('link', { name: '3 applications to review' })).toHaveAttribute('href', '/admin/events/evt-expo/applications?status=SUBMITTED');
  await attention.getByRole('button', { name: 'Publish Summer Market' }).click();
  await expect.poll(() => calls.publish).toBe(1);

  const orders = page.getByTestId('recent-orders');
  await expect(orders.getByRole('link', { name: /Bea Buyer/ })).toHaveAttribute('href', '/admin/orders/ord-1');
  await expect(orders).toContainText('Application');

  const axe = await new AxeBuilder({ page }).include('main').analyze();
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
});

test('fits a 320px phone with attention before the chart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockApi(page);
  await page.goto('/admin/dashboard');
  await expect(page.getByTestId('dashboard-kpis')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const attentionTop = (await page.getByRole('region', { name: 'Needs attention' }).boundingBox())!.y;
  const chartTop = (await page.getByRole('region', { name: 'Sales, last 14 days' }).boundingBox())!.y;
  expect(attentionTop).toBeLessThan(chartTop);
});

test('a draft that is not ready shows what to fix instead of publishing', async ({ page }) => {
  const calls = await mockApi(page, { refuse: true });
  await page.goto('/admin/dashboard');
  await page.getByRole('region', { name: 'Needs attention' }).getByRole('button', { name: 'Publish Summer Market' }).click();
  await expect.poll(() => calls.publish).toBe(1);

  const alert = page.getByRole('alert').filter({ hasText: 'before publishing' });
  await expect(alert).toBeFocused();
  await expect(alert.getByRole('link', { name: /Add at least one active ticket tier/ })).toHaveAttribute(
    'href',
    '/admin/events/evt-draft/edit/sales?orgId=org-dash#event-price-tiers'
  );
});
