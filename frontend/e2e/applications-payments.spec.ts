// Applications (spec 011 phase 2): paid-application UI with the backend mocked
// at the network layer — status page resume / pay-now and post-Checkout
// notices, admin payment card (retry charge, refund dialog, Stripe link).

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-apps-pay';
const EVENT_ID = 'evt-apps-pay';
const APP_ID = 'app-pay-1';
const TOKEN = 'tok-pay';

const event = {
  id: EVENT_ID,
  name: 'Gaming Geek Expo 2027',
  description: 'Retro gaming convention',
  date: '2027-09-18T15:00:00.000Z',
  capacity: 1000,
  status: 'PUBLISHED',
  taxRate: 0.0725,
  organizationId: ORG_ID,
  organizationName: 'Raleigh Retro Gamers',
  organizationBrandColor: '#1d4ed8',
  venue: { id: 'v1', name: 'Raleigh Convention Center', address: '500 S Salisbury St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' },
  priceTiers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const amounts = { subtotal: 275, platformFee: 13.75, processingFee: 14.55, tax: 0, applicantPays: 303.3, orgReceives: 275, feeMode: 'PASS', currency: 'usd' };
const profile = { id: 'prof-1', businessName: 'Hidden Block Games', description: null, website: null, socials: {}, photos: [] };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

function applicantApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    form: { id: 'form-vendor', name: 'Vendor Space', kind: 'PAID' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
    organization: { id: ORG_ID, name: 'Raleigh Retro Gamers' },
    status: 'APPROVED',
    paymentStatus: 'PAYMENT_DUE',
    tier: { id: 't1', name: '10x10' },
    amounts,
    paymentDueAt: '2026-09-24T00:00:00.000Z',
    profile,
    answers: [],
    boothLabel: null,
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: '2026-09-17T09:00:00.000Z',
    paidAt: null,
    refundedTotal: 0,
    canWithdraw: false,
    canResume: false,
    canPay: true,
    canUpdateCard: true,
    ...over,
  };
}

function adminApp(over: Record<string, unknown> = {}, payment: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    form: { id: 'form-vendor', name: 'Vendor Space', slug: 'vendor-space', kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
    status: 'APPROVED',
    paymentStatus: 'PAID',
    capacitySlot: 'APPROVED',
    contact: { id: 'c1', email: 'vee@hiddenblock.example', firstName: 'Vee', lastName: 'Vendor', accountCreatedAt: null },
    profile,
    tier: { id: 't1', name: '10x10', price: 275 },
    amounts,
    payment: {
      stripePaymentIntentId: 'pi_e2e_1',
      stripePaymentMethodId: 'on_file',
      stripeAccountId: null,
      applicationFee: null,
      chargeAttempts: 1,
      paidAt: '2026-09-17T09:00:05.000Z',
      paymentDueAt: null,
      overdue: false,
      refundedTotal: 0,
      refundable: 303.3,
      stripeDashboardUrl: 'https://dashboard.stripe.com/test/payments/pi_e2e_1',
      canRefund: true,
      canRetryCharge: false,
      ...payment,
    },
    answers: [],
    decisions: [{ id: 'd1', action: 'APPROVED', byUserId: 'u1', note: null, emailSubject: 'You are approved', emailBody: 'Hi Vee', createdAt: '2026-09-17T09:00:00.000Z' }],
    refunds: [],
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: '2026-09-17T09:00:00.000Z',
    decidedById: 'u1',
    withdrawnBy: null,
    withdrawReason: null,
    boothLabel: null,
    internalNote: null,
    createdAt: '2026-09-16T13:55:00.000Z',
    updatedAt: '2026-09-17T09:00:05.000Z',
    ...over,
  };
}

async function mockStatus(page: Page, state: { app: ReturnType<typeof applicantApp> }) {
  const calls: string[] = [];
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/applications/${APP_ID}/**`, (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.searchParams.get('token') !== TOKEN) return route.fulfill(json({ error: 'NotFoundError', message: 'Application not found' }, 404));
    if (url.pathname.endsWith('/status')) return route.fulfill(json(state.app));
    if (url.pathname.endsWith('/pay') || url.pathname.endsWith('/resume')) {
      // "Stripe" sends the applicant straight back with the outcome
      const outcome = url.pathname.endsWith('/pay') ? 'paid' : 'submitted';
      state.app = applicantApp(outcome === 'paid' ? { paymentStatus: 'PAID', canPay: false, paymentDueAt: null, paidAt: '2026-09-17T10:00:00.000Z' } : { status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', canResume: false, canPay: false, canWithdraw: true });
      return route.fulfill(json({ url: `http://localhost:3001/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}&checkout=${outcome}` }));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: 'unmocked' }, 404));
  });
  return calls;
}

// ─── Status page ─────────────────────────────────────────────────────────────

test('status page: payment due shows pay-now; back from Stripe the page confirms payment', async ({ page }) => {
  const state = { app: applicantApp() };
  const calls = await mockStatus(page, state);
  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}`);
  await expect(page.getByTestId('apply-status-pill')).toHaveText('Approved');
  const payment = page.getByTestId('apply-payment');
  await expect(payment).toContainText('Payment due · $303.30 · due');
  await expect(payment).toContainText('could not charge the card on file');

  await page.getByTestId('apply-pay-now').click();
  await expect(page).toHaveURL(/checkout=paid$/);
  expect(calls).toContain(`POST /applications/${APP_ID}/pay?token=${TOKEN}`);
  await expect(page.getByTestId('apply-checkout-notice')).toContainText('Payment received');
  await expect(page.getByTestId('apply-payment')).toContainText('Paid · $303.30');
  await expect(page.getByTestId('apply-pay-now')).toHaveCount(0);
});

test('status page: an abandoned checkout can be resumed', async ({ page }) => {
  const state = { app: applicantApp({ status: 'DRAFT', paymentStatus: 'AWAITING_CARD', canPay: false, canResume: true, canUpdateCard: false, submittedAt: null, decidedAt: null, paymentDueAt: null }) };
  await mockStatus(page, state);
  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}&checkout=cancelled`);
  await expect(page.getByTestId('apply-checkout-notice')).toContainText('Checkout was cancelled');
  await expect(page.getByTestId('apply-status')).toContainText('not finished yet');
  await page.getByTestId('apply-resume').click();
  await expect(page).toHaveURL(/checkout=submitted$/);
  await expect(page.getByTestId('apply-checkout-notice')).toContainText('your application is in');
  await expect(page.getByTestId('apply-status-pill')).toHaveText('Submitted');
  await expect(page.getByTestId('apply-payment')).toContainText('Card on file');
});

// ─── Admin ───────────────────────────────────────────────────────────────────

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER', initial: ReturnType<typeof adminApp>) {
  await signInAsStaff(page, { id: `apps-pay-${role.toLowerCase()}`, email: `apps-pay-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  const state = { app: initial };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body });
    const base = `/admin/events/${EVENT_ID}/applications/${APP_ID}`;
    if (path === base && method === 'GET') return route.fulfill(json(state.app));
    if (path === `${base}/refund`) {
      const amount = body.amount ?? state.app.payment.refundable;
      const refundedTotal = state.app.payment.refundedTotal + amount;
      const full = Math.abs(refundedTotal - amounts.applicantPays) < 0.005;
      state.app = adminApp(
        { paymentStatus: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refunds: [...state.app.refunds, { id: `r${state.app.refunds.length + 1}`, amount, status: 'SUCCEEDED', reason: body.reason ?? null, stripeRefundId: 're_1', initiatedBy: 'u1', createdAt: '2026-09-17T11:00:00.000Z' }] },
        { refundedTotal, refundable: Math.round((amounts.applicantPays - refundedTotal) * 100) / 100, canRefund: !full }
      );
      return route.fulfill(json(state.app));
    }
    if (path === `${base}/charge`) {
      state.app = adminApp({}, { chargeAttempts: 2 });
      return route.fulfill(json(state.app));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls, state };
}

test('admin detail: ADMIN refunds part of a paid application from the payment card', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!, 'ADMIN', adminApp());
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  const card = page.getByTestId('application-payment-card');
  await expect(card).toContainText('Applicant pays$303.30');
  await expect(card.getByRole('link', { name: 'View in Stripe ↗' })).toHaveAttribute('href', 'https://dashboard.stripe.com/test/payments/pi_e2e_1');
  await expect(page.getByTestId('application-retry-charge')).toHaveCount(0);

  await page.getByTestId('application-refund').click();
  const dialog = page.getByRole('dialog', { name: 'Refund application' });
  await expect(dialog).toContainText('Up to $303.30 can be returned');
  await expect(dialog.getByLabel('Amount')).toHaveValue('303.30');
  await dialog.getByLabel('Amount').fill('100');
  await dialog.getByLabel('Reason (optional)').fill('Smaller booth');
  await dialog.getByRole('button', { name: 'Refund $100.00' }).click();

  await expect(dialog).toHaveCount(0);
  expect(api.calls.find((c) => c.path.endsWith('/refund'))?.body).toEqual({ amount: 100, reason: 'Smaller booth' });
  await expect(page.getByTestId('application-payment')).toContainText('Partly refunded');
  await expect(card).toContainText('Refunded$100.00');
  await expect(page.getByTestId('application-refunds')).toContainText('$100.00 succeeded — Smaller booth');
  await expect(page.getByRole('status')).toContainText('Refunded. Partly refunded.');

  // Full refund of the remainder
  await page.getByTestId('application-refund').click();
  await expect(page.getByRole('dialog', { name: 'Refund application' }).getByLabel('Amount')).toHaveValue('203.30');
  await page.getByRole('dialog', { name: 'Refund application' }).getByRole('button', { name: 'Refund $203.30' }).click();
  await expect(page.getByTestId('application-payment')).toContainText('Refunded');
  expect(api.calls.filter((c) => c.path.endsWith('/refund')).at(-1)?.body).toEqual({ amount: null, reason: null });
  await expect(page.getByTestId('application-refund')).toHaveCount(0);
});

test('admin detail: ORGANIZER sees payment due, retries the card, cannot refund', async ({ page, baseURL }) => {
  const initial = adminApp(
    { paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' },
    { paidAt: null, paymentDueAt: '2026-09-24T00:00:00.000Z', canRefund: false, canRetryCharge: true, refundable: 0 }
  );
  const api = await mockAdmin(page, baseURL!, 'ORGANIZER', initial);
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  const card = page.getByTestId('application-payment-card');
  await expect(card).toContainText('card on file was declined');
  await expect(card).toContainText('Due');
  await expect(page.getByTestId('application-refund')).toHaveCount(0);

  await page.getByTestId('application-retry-charge').click();
  await expect(page.getByRole('status')).toContainText('Payment collected');
  expect(api.calls.some((c) => c.path.endsWith('/charge') && c.method === 'POST')).toBe(true);
  await expect(page.getByTestId('application-payment')).toContainText('Paid');
  await expect(page.getByTestId('application-retry-charge')).toHaveCount(0);
  // Refund stays admin-only even once paid
  await expect(page.getByTestId('application-refund')).toHaveCount(0);
});
