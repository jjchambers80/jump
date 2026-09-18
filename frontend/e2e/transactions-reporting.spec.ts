// Transactions phase 2 (spec 018): application money on the customer detail
// page, the analytics revenue-by-source block and the dashboard gross card.
// Backend mocked at the network layer; the sums are covered by
// backend/tests/contract/transactionsReporting.test.js.

import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-txn-rep';
const EVENT_ID = 'evt-txn-rep';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockOrg(page: import('@playwright/test').Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Reporting Org', status: 'ACTIVE' }])) : route.fallback()
  );
}

test('customer detail lists paid applications beside orders with combined totals', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'txn-rep-admin', email: 'txn-rep@test.com', role: 'ADMIN' }, baseURL!);
  await mockOrg(page);
  const event = { id: EVENT_ID, name: 'Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', logoUrl: null };
  await page.route(`${API}/admin/customers/c-both`, (route) =>
    route.fulfill(
      json({
        id: 'c-both',
        firstName: 'Bo',
        lastName: 'Both',
        email: 'both@example.com',
        location: null,
        note: null,
        emailSubscribed: false,
        createdAt: '2026-01-05T00:00:00.000Z',
        transactionCount: 2,
        orderCount: 2,
        ticketOrderCount: 1,
        applicationCount: 1,
        totalSpent: 236.95,
        totalRefunded: 5,
        lastActivityAt: '2026-09-05T12:00:00.000Z',
        lastOrderDate: '2026-09-05T12:00:00.000Z',
        orders: [{ id: 'o1', orderRef: 'JMP-1', totalAmount: 21.45, refunded: 0, quantity: 1, status: 'COMPLETED', createdAt: '2026-09-03T12:00:00.000Z', ticketCount: 1, event }],
        applications: [
          {
            id: 'a1',
            eventId: EVENT_ID,
            form: { id: 'f1', name: 'Vendors', kind: 'PAID' },
            tier: { id: 't1', name: '10x10' },
            businessName: 'Bo Co',
            status: 'APPROVED',
            paymentStatus: 'PARTIALLY_REFUNDED',
            paymentSource: 'stripe',
            applicantPays: 215.5,
            refunded: 5,
            paidAt: '2026-09-05T12:00:00.000Z',
            submittedAt: '2026-09-05T11:00:00.000Z',
            createdAt: '2026-09-05T10:00:00.000Z',
            event,
            detailUrl: `/admin/events/${EVENT_ID}/applications/a1`,
          },
        ],
      })
    )
  );

  await page.goto('/admin/customers/c-both');
  await expect(page.getByText('Amount spent')).toBeVisible();
  await expect(page.getByText('$236.95')).toBeVisible();
  await expect(page.getByText('$5.00 refunded').first()).toBeVisible();
  await expect(page.getByText('1 order · 1 application')).toBeVisible();
  const apps = page.getByTestId('customer-applications');
  await expect(apps).toContainText('Bo Co');
  await expect(apps).toContainText('Partially refunded');
  await expect(apps).toContainText('Geek Expo 2027 · Vendors — 10x10');
  await expect(apps).toContainText('$215.50');
  await expect(apps.getByRole('link')).toHaveAttribute('href', `/admin/events/${EVENT_ID}/applications/a1`);
});

test('analytics shows revenue by source and the dashboard shows gross revenue', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'txn-rep-admin', email: 'txn-rep@test.com', role: 'ADMIN' }, baseURL!);
  await mockOrg(page);
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/analytics`, (route) =>
    route.fulfill(
      json({
        event: { id: EVENT_ID, name: 'Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', status: 'PUBLISHED', capacity: 500, venue: { id: 'v1', name: 'Hall' } },
        totals: { sold: 3, redeemed: 0, remaining: 47, revenue: 60 },
        revenue: { tickets: 60, addOns: 40, applications: 932, applicationCount: 3, applicationRefunds: 100, net: 932 },
        tiers: [{ id: 't-ga', name: 'GA', price: 20, quantityTotal: 50, sold: 3, redeemed: 0, remaining: 47, revenue: 60 }],
      })
    )
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/sales`, (route) => route.fulfill(json({ addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } })));

  await page.goto(`/admin/events/${EVENT_ID}/analytics`);
  const breakdown = page.getByTestId('revenue-breakdown');
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText('Applications');
  await expect(breakdown).toContainText('$932.00');
  await expect(breakdown).toContainText('3 paid');
  await expect(breakdown).toContainText('−$100.00');
  await expect(page.getByText('net of application refunds')).toBeVisible();

  await page.route(`${API}/admin/dashboard/stats**`, (route) =>
    route.fulfill(json({ totalCapacity: 500, ticketsSold: 3, remainingCapacity: 497, ticketsRedeemed: 0, salesRate: 0, paymentSuccessRate: 100, revenue: { orders: 64.35, applications: 932, gross: 996.35 } }))
  );
  await page.route(`${API}/admin/events**`, (route) => route.fulfill(json({ events: [] })));
  await page.goto('/admin/dashboard');
  await expect(page.getByText('Gross Revenue')).toBeVisible();
  await expect(page.getByText('$996')).toBeVisible();
  await expect(page.getByText('$64 orders · $932 applications')).toBeVisible();
});
