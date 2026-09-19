// Orders page (spec 024 phase 2): order-level rows for ticket orders and
// application orders with the Tickets toggle, search / kind filter, the
// order detail of an application order with its Application panel and the
// amount-based refund dialog. Backend mocked at the network layer; the list
// semantics are covered by backend/tests/contract/ordersList.test.js.

import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-orders';
const EVENT_ID = 'evt-orders';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const contact = { firstName: 'Vic', lastName: 'Vendor', email: 'vic@example.com' };
const rows = [
  {
    id: 'ord-app',
    orderRef: 'JMP-APP001',
    kind: 'APPLICATION',
    applicationId: 'app-1',
    eventId: EVENT_ID,
    eventName: 'Geek Expo 2027',
    eventDate: '2027-09-18T15:00:00.000Z',
    quantity: 1,
    description: '10x10 + Power ×1',
    businessName: 'Vic Co',
    subtotalAmount: 265,
    platformFeeAmount: 13.25,
    processingFeeAmount: 1,
    taxAmount: 0,
    totalAmount: 279.25,
    refunded: 0,
    net: 279.25,
    currency: 'usd',
    status: 'COMPLETED',
    statusDetail: null,
    paymentSource: 'stripe',
    contact,
    application: { id: 'app-1', status: 'APPROVED', paymentStatus: 'PAID', formName: 'Vendors', tierName: '10x10' },
    paidAt: '2026-09-04T12:00:00.000Z',
    createdAt: '2026-09-03T12:00:00.000Z',
  },
  {
    id: 'ord-due',
    orderRef: 'JMP-DUE001',
    kind: 'APPLICATION',
    applicationId: 'app-2',
    eventId: EVENT_ID,
    eventName: 'Geek Expo 2027',
    eventDate: '2027-09-18T15:00:00.000Z',
    quantity: 1,
    description: 'Corner',
    businessName: 'Bo Co',
    subtotalAmount: 400,
    platformFeeAmount: 20,
    processingFeeAmount: 1,
    taxAmount: 0,
    totalAmount: 421,
    refunded: 0,
    net: 421,
    currency: 'usd',
    status: 'PENDING',
    statusDetail: { paymentStatus: 'PAYMENT_DUE', label: 'Payment due', dueAt: '2026-09-26T12:00:00.000Z' },
    paymentSource: 'stripe',
    contact: { firstName: 'Bo', lastName: 'Both', email: 'bo@example.com' },
    application: { id: 'app-2', status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', formName: 'Vendors', tierName: 'Corner' },
    paidAt: null,
    createdAt: '2026-09-02T12:00:00.000Z',
  },
  {
    id: 'ord-ticket',
    orderRef: 'JMP-TIX001',
    kind: 'TICKET',
    applicationId: null,
    eventId: EVENT_ID,
    eventName: 'Geek Expo 2027',
    eventDate: '2027-09-18T15:00:00.000Z',
    quantity: 2,
    description: '2 × General',
    businessName: null,
    subtotalAmount: 40,
    platformFeeAmount: 2,
    processingFeeAmount: 1,
    taxAmount: 1.9,
    totalAmount: 44.9,
    refunded: 10,
    net: 34.9,
    currency: 'usd',
    status: 'PARTIALLY_REFUNDED',
    statusDetail: null,
    paymentSource: 'stripe',
    contact: { firstName: 'Bea', lastName: 'Buyer', email: 'bea@example.com' },
    application: null,
    paidAt: '2026-09-01T12:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
];

const detail = {
  id: 'ord-app',
  orderRef: 'JMP-APP001',
  kind: 'APPLICATION',
  event: { id: EVENT_ID, name: 'Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', venue: { id: 'v1', name: 'RCC', address: '500 S Salisbury St' } },
  contact,
  quantity: 1,
  items: [
    { id: 'i1', kind: 'APPLICATION_TIER', priceTierId: null, priceTierName: '10x10', applicationTierId: 't1', description: '10x10', quantity: 1, unitPrice: 275, platformFee: 12.5, processingFee: 1, tax: 0, lineTotal: 288.5 },
    { id: 'i2', kind: 'ADJUSTMENT', priceTierId: null, priceTierName: null, description: 'Returning vendor', quantity: 1, unitPrice: -25, platformFee: 0, processingFee: 0, tax: 0, lineTotal: -25 },
  ],
  addOns: [{ id: 'l1', addOnId: 'a1', name: 'Power', quantity: 1, unitPrice: 15, platformFee: 0.75, processingFee: 0, tax: 0, lineTotal: 15.75, refundedAt: null }],
  subtotalAmount: 265,
  platformFeeAmount: 13.25,
  processingFeeAmount: 1,
  taxAmount: 0,
  totalAmount: 279.25,
  orgReceives: 265,
  feeMode: 'PASS',
  currency: 'usd',
  status: 'COMPLETED',
  paidAt: '2026-09-04T12:00:00.000Z',
  dueAt: null,
  tickets: [],
  payment: { id: 'p1', amount: 279.25, currency: 'usd', status: 'SUCCEEDED', failureReason: null, source: 'STRIPE', offlineMethod: null, offlineReference: null, stripePaymentIntentId: 'pi_test_123', createdAt: '2026-09-04T12:00:00.000Z' },
  application: { id: 'app-1', eventId: EVENT_ID, status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', formName: 'Vendors', formKind: 'PAID', tierName: '10x10', businessName: 'Vic Co' },
  createdAt: '2026-09-03T12:00:00.000Z',
};

async function mockCommon(page: import('@playwright/test').Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Orders Org', status: 'ACTIVE' }])) : route.fallback()
  );
  await page.route(`${API}/admin/events`, (route) => route.fulfill(json({ events: [{ id: EVENT_ID, name: 'Geek Expo 2027' }] })));
}

test('Orders lists both kinds, filters by kind, searches, and the Tickets toggle shows the ticket-level view', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'orders-admin', email: 'orders-admin@test.com', role: 'ADMIN' }, baseURL!);
  await mockCommon(page);
  const listCalls: string[] = [];
  await page.route(`${API}/admin/orders?**`, (route) => {
    const url = new URL(route.request().url());
    listCalls.push(url.search);
    const kind = url.searchParams.get('kind');
    const search = url.searchParams.get('search');
    let data = rows;
    if (kind) data = data.filter((r) => r.kind === kind);
    if (search) data = data.filter((r) => r.orderRef.includes(search) || r.businessName?.includes(search));
    return route.fulfill(json({ data, pagination: { page: 1, limit: 25, total: data.length, totalPages: 1 } }));
  });
  await page.route(`${API}/admin/tickets?**`, (route) => route.fulfill(json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })));

  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  const table = page.getByTestId('orders-table');
  await expect(table).toBeVisible();
  await expect(page.getByTestId('order-row')).toHaveCount(3);
  const appRow = page.getByTestId('order-row').filter({ hasText: 'JMP-APP001' });
  await expect(appRow).toContainText('Vic Co');
  await expect(appRow).toContainText('Application');
  await expect(appRow).toContainText('10x10 + Power ×1');
  await expect(appRow).toContainText('$279.25');
  await expect(appRow.getByTestId('order-status')).toHaveText('Paid');
  const dueRow = page.getByTestId('order-row').filter({ hasText: 'JMP-DUE001' });
  await expect(dueRow.getByTestId('order-status')).toContainText('Payment due · Sep 26');
  const ticketRow = page.getByTestId('order-row').filter({ hasText: 'JMP-TIX001' });
  await expect(ticketRow).toContainText('Tickets');
  await expect(ticketRow).toContainText('−$10.00');
  await expect(ticketRow.getByTestId('order-status')).toHaveText('Partially refunded');
  // No status filter sent: the backend default hides FAILED and CANCELLED.
  expect(listCalls[0]).not.toContain('status=');

  // Kind filter
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('orders-kind-APPLICATION').click();
  await expect(page.getByTestId('order-row')).toHaveCount(2);
  expect(listCalls.at(-1)).toContain('kind=APPLICATION');
  await page.getByTestId('orders-kind-all').click();
  await expect(page.getByTestId('order-row')).toHaveCount(3);

  // Search
  await page.getByTestId('orders-search').fill('Vic');
  await page.getByTestId('orders-search').press('Enter');
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  expect(listCalls.at(-1)).toContain('search=Vic');

  // Row links to the order detail
  await expect(appRow.getByRole('link', { name: 'JMP-APP001' })).toHaveAttribute('href', '/admin/orders/ord-app');

  // Tickets toggle: the ticket-level view, remembered across reloads
  await page.getByTestId('orders-view-tickets').click();
  await expect(page.getByPlaceholder(/confirmation code/i)).toBeVisible();
  await expect(page.getByTestId('orders-list-view')).toHaveCount(0);
  await page.reload();
  await expect(page.getByPlaceholder(/confirmation code/i)).toBeVisible();
  await page.getByTestId('orders-view-orders').click();
  await expect(page.getByTestId('orders-list-view')).toBeVisible();
});

test('an application order detail shows the lines, the payment, the Application panel and refunds by amount', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'orders-admin', email: 'orders-admin@test.com', role: 'ADMIN' }, baseURL!);
  await mockCommon(page);
  let refunded = false;
  const refundCalls: unknown[] = [];
  await page.route(`${API}/admin/orders/ord-app`, (route) => route.fulfill(json(refunded ? { ...detail, status: 'PARTIALLY_REFUNDED' } : detail)));
  await page.route(`${API}/admin/orders/ord-app/refunds`, (route) =>
    route.fulfill(json({ refunds: refunded ? [{ id: 'r1', amount: 40, reason: 'Smaller table', status: 'SUCCEEDED', ticket: null, addOn: null, manual: false, createdAt: '2026-09-05T12:00:00.000Z' }] : [] }))
  );
  await page.route(`${API}/admin/orders/ord-app/refund`, (route) => {
    refundCalls.push(route.request().postDataJSON());
    refunded = true;
    return route.fulfill(json({ id: 'r1', amount: 40, status: 'SUCCEEDED', manual: false, orderRef: 'JMP-APP001' }));
  });

  await page.goto('/admin/orders/ord-app');
  await expect(page.getByRole('heading', { name: 'JMP-APP001' })).toBeVisible();
  await expect(page.getByTestId('order-detail-kind')).toHaveText('Application');
  await expect(page.getByTestId('order-detail-status')).toHaveText('Paid');
  const panel = page.getByTestId('order-application-panel');
  await expect(panel).toContainText('Vic Co');
  await expect(panel).toContainText('Vendors · 10x10');
  await expect(panel).toContainText('Approved');
  await expect(page.getByTestId('order-open-application')).toHaveAttribute('href', `/admin/events/${EVENT_ID}/applications/app-1`);

  const items = page.getByTestId('order-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('10x10');
  await expect(items.nth(1)).toContainText('Adjustment');
  await expect(items.nth(1)).toContainText('Returning vendor');
  await expect(items.nth(1)).toContainText('-$25.00');
  await expect(page.getByTestId('order-add-on-line')).toContainText('Power');
  await expect(page.getByTestId('order-add-on-line').getByRole('button', { name: 'Refund' })).toHaveCount(0);
  await expect(page.getByText('You receive')).toBeVisible();
  await expect(page.getByTestId('order-payment')).toContainText('pi_test_123');
  await expect(page.getByText('Tickets (')).toHaveCount(0);

  // Refund by amount
  await page.getByTestId('order-refund-button').click();
  await expect(page.getByRole('heading', { name: 'Refund application' })).toBeVisible();
  await expect(page.getByText('Up to $279.25 can be returned to their card')).toBeVisible();
  await page.getByLabel('Amount').fill('40');
  await page.getByTestId('order-refund-confirm').click();
  await expect(page.getByTestId('order-detail-status')).toHaveText('Partially refunded');
  await expect(page.getByText('Refunds (1)')).toBeVisible();
  await expect(page.getByText('Smaller table')).toBeVisible();
  expect(refundCalls).toEqual([{ amount: 40 }]);
});

test('an ORGANIZER sees the application order without refund controls', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'orders-organizer', email: 'orders-organizer@test.com', role: 'ORGANIZER' }, baseURL!);
  await mockCommon(page);
  await page.route(`${API}/admin/orders/ord-app`, (route) => route.fulfill(json(detail)));
  await page.route(`${API}/admin/orders/ord-app/refunds`, (route) => route.fulfill(json({ refunds: [] })));
  await page.goto('/admin/orders/ord-app');
  await expect(page.getByTestId('order-application-panel')).toBeVisible();
  await expect(page.getByTestId('order-refund-button')).toHaveCount(0);
});
