// Corrections on an application's money (spec 018 phase 3), backend mocked at
// the network layer: change tier with a dropped-add-on warning, add and
// remove an adjustment, ADMIN waives / records an offline payment, an offline
// row's refund is a recorded refund. The rules are enforced and tested in
// backend/tests/contract/applicationCorrections.test.js.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-apps-corr';
const EVENT_ID = 'evt-apps-corr';
const FORM_ID = 'form-corr';
const APP_ID = 'app-corr-1';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const POWER = { id: 'addon-power', name: 'Booth power', description: null, price: 125, taxable: false, applicantPays: 135.95, maxPerOrder: null, remaining: 2, soldOut: false, allTiers: true, isActive: true };
const BADGE = { id: 'addon-badge', name: 'Extra vendor badge', description: null, price: 10, taxable: false, applicantPays: 11.11, maxPerOrder: 4, remaining: null, soldOut: false, allTiers: false, isActive: true };

const tier = (id: string, name: string, price: number, applicantPays: number, addOns: unknown[], remaining = 4) => ({
  id,
  name,
  description: null,
  price,
  quantityTotal: 5,
  quantityApproved: 1,
  quantityReserved: 0,
  remaining,
  displayOrder: 0,
  isActive: true,
  amounts: { subtotal: price, platformFee: 0, processingFee: 0, tax: 0, applicantPays, orgReceives: price, feeMode: 'PASS' },
  addOns,
});
const boothTier = tier('t-booth', 'Booth', 275, 303.3, [POWER, BADGE]);
const cornerTier = tier('t-corner', 'Corner', 400, 440.3, [POWER], 1);

const adminForm = {
  id: FORM_ID,
  eventId: EVENT_ID,
  kind: 'PAID',
  name: 'Vendor Booth',
  slug: 'vendor-booth',
  intro: null,
  status: 'OPEN',
  opensAt: null,
  closesAt: null,
  chargeTiming: 'APPROVAL',
  feeMode: 'PASS',
  taxable: false,
  paymentDueDays: 7,
  overduePolicy: 'WITHDRAW',
  displayOrder: 0,
  paymentsEnabled: true,
  applicationCount: 1,
  tiers: [boothTier, cornerTier],
  questions: [],
  addOns: [POWER, BADGE],
};

const profile = { id: 'prof-1', businessName: 'Hidden Block Games', description: null, website: null, socials: {}, photos: [] };
const lines = [
  { id: 'line-1', addOnId: POWER.id, name: POWER.name, quantity: 1, unitPrice: 125, applicantPays: 135.95 },
  { id: 'line-2', addOnId: BADGE.id, name: BADGE.name, quantity: 2, unitPrice: 10, applicantPays: 22.22 },
];
const amounts = { subtotal: 420, platformFee: 21, processingFee: 20.4, tax: 0, applicantPays: 461.4, orgReceives: 420, feeMode: 'PASS', currency: 'usd' };
const payment = { stripePaymentIntentId: null, stripePaymentMethodId: 'on_file', stripeAccountId: null, applicationFee: null, chargeAttempts: 0, paidAt: null, paymentDueAt: null, overdue: false, refundedTotal: 0, refundable: 0, stripeDashboardUrl: null, canRefund: false, manualRefund: false, canRetryCharge: false };

function adminApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    form: { id: FORM_ID, name: 'Vendor Booth', slug: 'vendor-booth', kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW' },
    event: { id: EVENT_ID, name: 'Maker Fair 2027', date: '2027-10-02T15:00:00.000Z' },
    status: 'SUBMITTED',
    paymentStatus: 'CARD_ON_FILE',
    capacitySlot: 'NONE',
    contact: { id: 'c1', email: 'vee@hiddenblock.example', firstName: 'Vee', lastName: 'Vendor', accountCreatedAt: null },
    profile,
    tier: { id: boothTier.id, name: boothTier.name, price: 275 },
    amounts,
    pricing: { currentApplicantPays: 461.4, currentOrgReceives: 420, changed: false },
    addOns: lines,
    addOnsEditable: { allowed: true, reason: null },
    adjustments: [],
    amountEditable: { allowed: true, reason: null },
    canSettleOffline: false,
    paymentSource: 'stripe',
    offlinePayment: null,
    payment,
    answers: [],
    decisions: [],
    refunds: [],
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: null,
    decidedById: null,
    withdrawnBy: null,
    withdrawReason: null,
    boothLabel: null,
    internalNote: null,
    createdAt: '2026-09-16T13:55:00.000Z',
    updatedAt: '2026-09-16T14:00:00.000Z',
    ...over,
  };
}

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER', initial = adminApp()) {
  await signInAsStaff(page, { id: `corr-${role.toLowerCase()}`, email: `corr-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Durham Makers', status: 'ACTIVE' }])) : route.fallback()
  );
  const state = { app: initial };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const base = `/admin/events/${EVENT_ID}/applications/${APP_ID}`;
  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body });
    if (path === `/admin/events/${EVENT_ID}/application-forms/${FORM_ID}` && method === 'GET') return route.fulfill(json(adminForm));
    if (path === base && method === 'GET') return route.fulfill(json(state.app));
    if (path === `${base}/tier` && method === 'POST') {
      state.app = adminApp({
        tier: { id: cornerTier.id, name: 'Corner', price: 400 },
        addOns: [lines[0]],
        amounts: { ...amounts, applicantPays: 576.25 },
        decisions: [{ id: 'd1', action: 'TIER_CHANGED', byUserId: 'u1', note: 'Tier: Booth → Corner. Total $461.40 → $576.25. Dropped add-ons: Extra vendor badge ×2.', emailSubject: 'Your Maker Fair 2027 application was moved to Corner', emailBody: 'Hi Vee', createdAt: '2026-09-17T10:00:00.000Z' }],
      });
      return route.fulfill(json(state.app));
    }
    if (path === `${base}/adjustments` && method === 'POST') {
      const adj = { id: 'adj-1', kind: 'ADJUSTMENT', amount: body.amount, reason: body.reason, createdById: 'u1', createdAt: '2026-09-17T10:05:00.000Z' };
      state.app = adminApp({ ...state.app, adjustments: [adj], amounts: { ...amounts, applicantPays: 434.4 }, decisions: [...(state.app.decisions as unknown[]), { id: 'd2', action: 'ADJUSTED', byUserId: 'u1', note: '−$25.00 Returning vendor discount', emailSubject: null, emailBody: null, createdAt: '2026-09-17T10:05:00.000Z' }] });
      return route.fulfill(json(state.app, 201));
    }
    if (path === `${base}/adjustments/adj-1` && method === 'DELETE') {
      state.app = adminApp({ ...state.app, adjustments: [], amounts });
      return route.fulfill(json(state.app));
    }
    if (path === `${base}/waive` && method === 'POST') {
      state.app = adminApp({
        ...state.app,
        paymentStatus: 'NOT_REQUIRED',
        paymentSource: 'offline',
        capacitySlot: 'APPROVED',
        canSettleOffline: false,
        amountEditable: { allowed: false, reason: 'Settled outside Stripe — the amount is final' },
        amounts: { ...amounts, applicantPays: 0, orgReceives: 0 },
        adjustments: [{ id: 'adj-w', kind: 'WAIVER', amount: -461.4, reason: body.reason, createdById: 'u1', createdAt: '2026-09-17T10:10:00.000Z' }],
        decisions: [{ id: 'd3', action: 'WAIVED', byUserId: 'u1', note: `Waived $461.40: ${body.reason}`, emailSubject: 'Your balance for Maker Fair 2027 has been waived', emailBody: 'Hi', createdAt: '2026-09-17T10:10:00.000Z' }],
      });
      return route.fulfill(json(state.app));
    }
    if (path === `${base}/offline-payment` && method === 'POST') {
      state.app = adminApp({
        ...state.app,
        paymentStatus: 'PAID',
        paymentSource: 'offline',
        capacitySlot: 'APPROVED',
        canSettleOffline: false,
        amountEditable: { allowed: false, reason: 'Settled outside Stripe — the amount is final' },
        offlinePayment: { method: body.method, reference: body.reference, recordedById: 'u1' },
        payment: { ...payment, paidAt: body.paidAt, canRefund: true, manualRefund: true, refundable: 461.4 },
        decisions: [{ id: 'd4', action: 'OFFLINE_PAID', byUserId: 'u1', note: 'Cheque #1042, $461.40', emailSubject: 'Payment received for Maker Fair 2027', emailBody: 'Hi', createdAt: '2026-09-17T10:15:00.000Z' }],
      });
      return route.fulfill(json(state.app));
    }
    if (path === `${base}/refund` && method === 'POST') {
      state.app = adminApp({ ...state.app, paymentStatus: 'PARTIALLY_REFUNDED', refunds: [{ id: 'r1', amount: body.amount, status: 'SUCCEEDED', reason: body.reason, stripeRefundId: null, initiatedBy: 'u1', manual: true, createdAt: '2026-09-17T10:20:00.000Z' }], payment: { ...(state.app.payment as typeof payment), refundedTotal: body.amount, refundable: 461.4 - body.amount } });
      return route.fulfill(json(state.app));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls, state };
}

test('ORGANIZER changes the tier (with a dropped add-on warning) and adds / removes an adjustment', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!, 'ORGANIZER');
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await expect(page.getByTestId('application-payment-card')).toContainText('Booth');
  // No settle actions for organizers / non-PAYMENT_DUE rows.
  await expect(page.getByTestId('application-waive')).toHaveCount(0);

  await page.getByTestId('application-change-tier').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New tier').selectOption(cornerTier.id);
  await expect(page.getByTestId('change-tier-dropped')).toContainText('Corner does not offer Extra vendor badge ×2');
  await dialog.getByRole('button', { name: 'Change tier' }).click();
  await expect(page.getByRole('status')).toContainText('Moved to Corner. New total $576.25');
  expect(calls.find((c) => c.path.endsWith('/tier'))?.body).toEqual({ tierId: cornerTier.id });
  await expect(page.getByTestId('application-history')).toContainText('Tier changed');
  await expect(page.getByTestId('application-history')).toContainText('Dropped add-ons: Extra vendor badge ×2');
  await expect(page.getByTestId(`application-add-on-${BADGE.id}`)).toHaveCount(0);

  await page.getByTestId('application-add-adjustment').click();
  const adjust = page.getByRole('dialog');
  await adjust.getByLabel('Amount').fill('25');
  await adjust.getByLabel('Reason').fill('Returning vendor discount');
  await adjust.getByRole('button', { name: 'Discount $25.00' }).click();
  await expect(page.getByRole('status')).toContainText('Adjustment added. New total $434.40');
  expect(calls.find((c) => c.path.endsWith('/adjustments'))?.body).toEqual({ amount: -25, reason: 'Returning vendor discount' });
  const block = page.getByTestId('application-adjustments');
  await expect(block).toContainText('Returning vendor discount');
  await expect(block).toContainText('−$25.00');
  await expect(page.getByTestId('application-history')).toContainText('Amount adjusted');

  await block.getByRole('button', { name: 'Remove adjustment Returning vendor discount' }).click();
  await expect(page.getByRole('status')).toContainText('Adjustment removed.');
  await expect(block).toContainText('None');
  expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/adjustments/adj-1'))).toBe(true);
});

test('ADMIN waives a payment-due balance', async ({ page, baseURL }) => {
  const due = adminApp({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', canSettleOffline: true, payment: { ...payment, paymentDueAt: '2026-09-23T14:00:00.000Z', canRetryCharge: true } });
  const { calls } = await mockAdmin(page, baseURL!, 'ADMIN', due);
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await page.getByTestId('application-waive').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('owes $461.40');
  await dialog.getByLabel('Reason').fill('Sponsor trade');
  await dialog.getByRole('button', { name: 'Waive $461.40' }).click();
  await expect(page.getByRole('status')).toContainText('Balance waived');
  expect(calls.find((c) => c.path.endsWith('/waive'))?.body).toEqual({ reason: 'Sponsor trade' });
  await expect(page.getByTestId('application-payment-card')).toContainText('Waived');
  await expect(page.getByTestId('application-adjustments')).toContainText('−$461.40');
  await expect(page.getByTestId('application-history')).toContainText('Balance waived');
  await expect(page.getByTestId('application-waive')).toHaveCount(0);
  await expect(page.getByTestId('application-payment-card')).toContainText('Locked');
});

test('ADMIN records an offline payment, then a refund is recorded rather than sent to Stripe', async ({ page, baseURL }) => {
  const due = adminApp({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', canSettleOffline: true, payment: { ...payment, paymentDueAt: '2026-09-23T14:00:00.000Z', canRetryCharge: true } });
  const { calls } = await mockAdmin(page, baseURL!, 'ADMIN', due);
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await page.getByTestId('application-offline-payment').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('CHEQUE');
  await dialog.getByLabel('Reference (optional)').fill('#1042');
  await dialog.getByLabel('Date received').fill('2026-09-16');
  await dialog.getByRole('button', { name: 'Record $461.40' }).click();
  await expect(page.getByRole('status')).toContainText('Payment recorded');
  const call = calls.find((c) => c.path.endsWith('/offline-payment'))?.body as { method: string; amount: number; reference: string; paidAt: string };
  expect(call).toMatchObject({ method: 'CHEQUE', amount: 461.4, reference: '#1042' });
  expect(call.paidAt).toMatch(/^2026-09-16T/);
  await expect(page.getByTestId('application-payment-card')).toContainText('Cheque #1042 (offline)');
  await expect(page.getByTestId('application-history')).toContainText('Paid offline');

  await page.getByTestId('application-refund').click();
  const refund = page.getByRole('dialog');
  await expect(refund).toContainText('Record refund');
  await expect(refund).toContainText('no Stripe charge');
  await refund.getByLabel('Amount').fill('20');
  await refund.getByRole('button', { name: 'Record $20.00' }).click();
  await expect(page.getByRole('status')).toContainText('Refunded');
  expect(calls.find((c) => c.path.endsWith('/refund'))?.body).toEqual({ amount: 20, reason: null });
  await expect(page.getByTestId('application-refunds')).toContainText('(recorded offline)');
});
