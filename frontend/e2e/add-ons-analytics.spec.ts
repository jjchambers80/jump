// Add-on sales on the event analytics page (spec 012 phase 3), backend
// mocked at the network layer: the table renders per-source counts and the
// purchasers CSV button downloads the export.

import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-addon-analytics';
const EVENT_ID = 'evt-addon-analytics';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const analytics = {
  event: { id: EVENT_ID, name: 'Maker Fair 2027', date: '2027-10-02T15:00:00.000Z', status: 'PUBLISHED', capacity: 500, venue: { id: 'v1', name: 'Maker Hall' } },
  totals: { sold: 3, redeemed: 0, remaining: 47, revenue: 60 },
  tiers: [{ id: 't-ga', name: 'GA', price: 20, quantityTotal: 50, sold: 3, redeemed: 0, remaining: 47, revenue: 60 }],
};

const sales = {
  addOns: [
    { id: 'addon-power', name: 'Booth power', scope: 'APPLICATION', price: 125, isActive: true, quantityTotal: 2, sold: 2, reserved: 0, remaining: 0, revenue: 250, orders: { quantity: 0, revenue: 0, lines: 0 }, applications: { quantity: 2, revenue: 250, lines: 2, held: 0, pending: 1 } },
    { id: 'addon-table', name: 'Table & chairs', scope: 'BOTH', price: 40, isActive: true, quantityTotal: null, sold: 4, reserved: 1, remaining: null, revenue: 160, orders: { quantity: 2, revenue: 80, lines: 1 }, applications: { quantity: 2, revenue: 80, lines: 2, held: 1, pending: 0 } },
    { id: 'addon-old', name: 'Old parking', scope: 'TICKET', price: 15, isActive: false, quantityTotal: null, sold: 0, reserved: 0, remaining: null, revenue: 0, orders: { quantity: 0, revenue: 0, lines: 0 }, applications: { quantity: 0, revenue: 0, lines: 0, held: 0, pending: 0 } },
  ],
  totals: { sold: 6, reserved: 1, revenue: 410 },
};

test('analytics page shows add-on sales and downloads the purchasers CSV', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'addon-analytics-admin', email: 'addon-analytics@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Durham Makers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/analytics`, (route) => route.fulfill(json(analytics)));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/sales`, (route) => route.fulfill(json(sales)));
  let csvRequested = false;
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/purchasers.csv`, (route) => {
    csvRequested = true;
    return route.fulfill({ status: 200, contentType: 'text/csv', body: 'addOn,quantity\r\nBooth power,1\r\n' });
  });

  await page.goto(`/admin/events/${EVENT_ID}/analytics`);
  const table = page.getByTestId('add-on-sales');
  await expect(table).toBeVisible();
  await expect(table).toContainText('6 sold · 1 held · $410.00 listed revenue');
  const power = page.getByTestId('add-on-sales-addon-power');
  await expect(power).toContainText('$125.00');
  await expect(power).toContainText('+1 pending');
  await expect(power.locator('td').nth(6)).toHaveText('0');
  const tableRow = page.getByTestId('add-on-sales-addon-table');
  await expect(tableRow.locator('td').nth(3)).toHaveText('2');
  await expect(tableRow.locator('td').nth(6)).toHaveText('∞');
  await expect(page.getByTestId('add-on-sales-addon-old')).toContainText('inactive');
  // Ticket tier amounts are dollars, not cents.
  await expect(page.getByText('$60.00').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByTestId('add-on-purchasers-csv').click();
  expect((await download).suggestedFilename()).toBe(`add-on-purchasers-${EVENT_ID}.csv`);
  expect(csvRequested).toBe(true);
});
