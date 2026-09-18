// Transactions page (spec 018 phase 1): search finds both an order and an
// application for one contact, the refund history expands, an ADMIN refunds an
// application from the list, an ORGANIZER cannot. The API is mocked; the
// backend contract is covered by backend/tests/contract/transactions.test.js.

import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const DESKTOP = { width: 1440, height: 900 };
const ORG_ID = 'org-txn';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const orderRow = {
  type: 'ORDER',
  id: 'order-1',
  reference: 'JMP-ABC123',
  occurredAt: '2026-09-03T12:00:00.000Z',
  contact: { id: 'c1', name: 'Alice Anderson', email: 'alice@example.com' },
  businessName: null,
  event: { id: 'evt-1', name: 'Winter Market', date: '2026-09-28T12:00:00.000Z' },
  description: '1 × General Admission',
  subtotal: 25,
  platformFee: 1.25,
  processingFee: 1,
  tax: 0,
  gross: 27.25,
  refunded: 0,
  net: 27.25,
  amountDue: null,
  dueAt: null,
  status: 'PAID',
  sourceStatus: 'COMPLETED',
  paymentSource: 'stripe',
  stripeAccountId: null,
  stripePaymentIntentId: 'pi_order1',
  stripeCheckoutSessionId: null,
  detailUrl: '/admin/orders/order-1',
};

const applicationRow = {
  type: 'APPLICATION',
  id: 'app-1',
  reference: 'app-1',
  occurredAt: '2026-09-04T12:00:00.000Z',
  contact: { id: 'c1', name: 'Alice Anderson', email: 'alice@example.com' },
  businessName: 'Alice Crafts',
  event: { id: 'evt-2', name: 'Geek Expo 2027', date: '2026-09-30T12:00:00.000Z' },
  description: 'Vendor Space — 10x10',
  subtotal: 275,
  platformFee: 13.75,
  processingFee: 1,
  tax: 0,
  gross: 289.75,
  refunded: 0,
  net: 289.75,
  amountDue: null,
  dueAt: null,
  status: 'PAID',
  sourceStatus: 'PAID',
  paymentSource: 'stripe',
  stripeAccountId: null,
  stripePaymentIntentId: 'pi_app1',
  stripeCheckoutSessionId: 'cs_app1',
  detailUrl: '/admin/events/evt-2/applications/app-1',
};

async function mockAdminShell(page: import('@playwright/test').Page) {
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Txn Org', status: 'ACTIVE' }])));
  await page.route(`${API}/admin/events`, (route) => route.fulfill(json({ events: [{ id: 'evt-1', name: 'Winter Market' }, { id: 'evt-2', name: 'Geek Expo 2027' }] })));
}

test.describe('admin transactions', () => {
  test.use({ viewport: DESKTOP });

  test('ADMIN searches by email, sees both rows, expands refunds and refunds the application', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'txn-admin', email: 'txn-admin@test.com', role: 'ADMIN' }, baseURL!);
    await mockAdminShell(page);

    const listCalls: string[] = [];
    await page.route(`${API}/admin/transactions?**`, (route) => {
      const url = new URL(route.request().url());
      listCalls.push(url.search);
      const search = url.searchParams.get('search');
      const rows = search === 'alice@example.com' ? [applicationRow, orderRow] : search ? [] : [applicationRow, orderRow];
      return route.fulfill(json({ data: rows, pagination: { page: 1, pageSize: 50, total: rows.length, totalPages: 1 } }));
    });
    await page.route(`${API}/admin/transactions/APPLICATION/app-1/refunds`, (route) => route.fulfill(json({ refunds: [] })));
    let refundBody: Record<string, unknown> | null = null;
    await page.route(`${API}/admin/transactions/APPLICATION/app-1/refund`, (route) => {
      refundBody = route.request().postDataJSON();
      const refund = { id: 'ref-1', amount: 5, reason: 'Goodwill', status: 'SUCCEEDED', stripeRefundId: 're_1', initiatedBy: 'txn-admin', manual: false, detail: null, createdAt: '2026-09-05T12:00:00.000Z' };
      return route.fulfill(json({ transaction: { ...applicationRow, status: 'PARTIALLY_REFUNDED', refunded: 5, net: 284.75 }, refunds: [refund] }));
    });

    await page.goto('/admin/transactions');
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByTestId('transaction-APPLICATION-app-1')).toBeVisible();
    await expect(page.getByTestId('transaction-ORDER-order-1')).toBeVisible();

    await page.getByTestId('transactions-search').fill('alice@example.com');
    await page.getByTestId('transactions-search').press('Enter');
    await expect(page).toHaveURL(/search=alice%40example\.com/);
    await expect.poll(() => listCalls.some((q) => q.includes('search=alice%40example.com'))).toBe(true);

    const appRow = page.getByTestId('transaction-APPLICATION-app-1');
    await expect(appRow).toContainText('Alice Crafts');
    await expect(appRow).toContainText('Vendor Space — 10x10');
    await expect(appRow).toContainText('$289.75');
    await expect(page.getByTestId('transaction-ORDER-order-1')).toContainText('JMP-ABC123');

    await appRow.getByRole('button', { name: 'details' }).click();
    await expect(appRow).toContainText('No refunds.');
    await expect(appRow).toContainText('pi_app1');

    await page.getByTestId('refund-APPLICATION-app-1').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Up to $289.75 can be returned');
    await dialog.getByLabel('Amount').fill('5');
    await dialog.getByLabel('Reason (optional)').fill('Goodwill');
    await dialog.getByRole('button', { name: 'Refund $5.00' }).click();

    await expect.poll(() => refundBody).toEqual({ amount: 5, reason: 'Goodwill' });
    await expect(appRow).toContainText('Partially refunded');
    await expect(appRow).toContainText('$284.75');
    await expect(appRow.getByTestId('refunds-APPLICATION-app-1')).toContainText('re_1');
  });

  test('ORGANIZER sees the list but the refund action is disabled', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'txn-org', email: 'txn-org@test.com', role: 'ORGANIZER' }, baseURL!);
    await mockAdminShell(page);
    await page.route(`${API}/admin/transactions?**`, (route) => route.fulfill(json({ data: [orderRow], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } })));

    await page.goto('/admin/transactions');
    await expect(page.getByTestId('transaction-ORDER-order-1')).toBeVisible();
    await expect(page.getByTestId('refund-ORDER-order-1')).toBeDisabled();
    await expect(page.getByTestId('refund-ORDER-order-1')).toHaveAttribute('title', 'Refunds require the Admin role');
  });

  test('filters are written to the URL and sent to the API', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'txn-admin', email: 'txn-admin@test.com', role: 'ADMIN' }, baseURL!);
    await mockAdminShell(page);
    const calls: string[] = [];
    await page.route(`${API}/admin/transactions?**`, (route) => {
      calls.push(new URL(route.request().url()).search);
      return route.fulfill(json({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } }));
    });

    await page.goto('/admin/transactions?type=APPLICATION&status=PAYMENT_DUE&hasRefunds=true');
    await expect(page.getByText('No transactions match your filters.')).toBeVisible();
    await expect.poll(() => calls.at(-1)).toContain('type=APPLICATION');
    expect(calls.at(-1)).toContain('status=PAYMENT_DUE');
    expect(calls.at(-1)).toContain('hasRefunds=true');

    await page.getByRole('button', { name: 'Orders' }).click();
    await expect(page).toHaveURL(/type=ORDER/);
    await expect.poll(() => calls.at(-1)).toContain('type=ORDER');
  });
});
