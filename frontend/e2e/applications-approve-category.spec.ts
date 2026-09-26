// Approving a PAID application (spec 037 phase 5, apply-then-choose), backend
// mocked at the network layer: the Approve dialog requires a category when the
// form has several, previews the choose-your-space email for it, warns when a
// reserving category is full, sends `tierId`, and nothing is charged — the
// detail page then shows the vendor as awaiting a space. The list offers an
// "Awaiting space" chip. Rules are enforced and tested in
// backend/tests/contract/applicationPayments.test.js.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-apps-approve';
const EVENT_ID = 'evt-apps-approve';
const FORM_ID = 'form-approve';
const APP_ID = 'app-approve-1';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const profile = { id: 'prof-1', businessName: 'Taco Truck Co', description: null, website: null, socials: {}, photos: [] };
const noAmounts = { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' };
const payment = { stripePaymentIntentId: null, stripePaymentMethodId: null, stripeAccountId: null, applicationFee: null, chargeAttempts: 0, paidAt: null, paymentDueAt: null, overdue: false, refundedTotal: 0, refundable: 0, stripeDashboardUrl: null, canRefund: false, manualRefund: false, canRetryCharge: false };
const categories = [
  { id: 't-truck', name: 'Food truck', price: 150, isActive: true, remaining: 3 },
  { id: 't-cart', name: 'Cart', price: 60, isActive: true, remaining: 0 },
];

function adminApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    orderId: null,
    orderRef: null,
    form: { id: FORM_ID, name: 'Food vendors', slug: 'food-vendors', kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW', reserveOnApproval: true },
    categories,
    event: { id: EVENT_ID, name: 'Street Food Fest', date: '2027-05-02T15:00:00.000Z' },
    status: 'SUBMITTED',
    paymentStatus: 'NOT_DUE',
    capacitySlot: 'NONE',
    selectionHeldUntil: null,
    contact: { id: 'c1', email: 'taco@example.com', firstName: 'Tia', lastName: 'Taco', accountCreatedAt: null },
    profile,
    tier: null,
    tierEditable: { allowed: true, reason: null },
    amounts: noAmounts,
    pricing: null,
    addOns: [],
    addOnsEditable: { allowed: false, reason: 'This form has no add-ons' },
    adjustments: [],
    amountEditable: { allowed: false, reason: 'This form has no amount to change' },
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
    booth: null,
    internalNote: null,
    tags: [],
    checkedInAt: null,
    checkedOutAt: null,
    createdAt: '2026-09-16T13:55:00.000Z',
    updatedAt: '2026-09-16T14:00:00.000Z',
    ...over,
  };
}

async function mockAdmin(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'approve-organizer', email: 'approve-organizer@test.com', role: 'ORGANIZER' }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Street Food Co', status: 'ACTIVE' }])) : route.fallback()
  );
  const state = { app: adminApp() };
  const calls: { method: string; path: string; body?: Record<string, unknown>; search?: string }[] = [];
  const base = `/admin/events/${EVENT_ID}/applications/${APP_ID}`;
  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body, search: url.search });
    if (path === base && method === 'GET') return route.fulfill(json(state.app));
    if (path === `${base}/preview` && method === 'POST') {
      const tier = categories.find((c) => c.id === body.tierId);
      return route.fulfill(json({ subject: 'You are approved for Street Food Fest: choose your space', body: `Hi Tia,\n\nGood news: Taco Truck Co is approved as ${tier?.name}.` }));
    }
    if (path === `${base}/decision` && method === 'POST') {
      state.app = adminApp({
        status: 'APPROVED',
        paymentStatus: 'AWAITING_SELECTION',
        capacitySlot: 'RESERVED',
        tier: { id: 't-truck', name: 'Food truck', price: 150, mapBound: false },
        pricing: { currentApplicantPays: 165.45, currentOrgReceives: 150, changed: false },
        canSettleOffline: true,
        payment: { ...payment, paymentDueAt: '2026-09-24T09:00:00.000Z' },
        decidedAt: '2026-09-17T09:00:00.000Z',
        decisions: [{ id: 'd1', action: 'APPROVED', byUserId: 'u1', note: null, emailSubject: 'You are approved for Street Food Fest: choose your space', emailBody: 'Hi Tia', createdAt: '2026-09-17T09:00:00.000Z' }],
      });
      return route.fulfill(json(state.app));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls, state };
}

test('approving a PAID application requires a category, previews the choose-your-space email, charges nothing', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await expect(page.getByTestId('application-category')).toContainText('Assigned on approval');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const picker = dialog.getByLabel('Category');
  await expect(picker).toHaveValue('');
  await expect(dialog).toContainText('Choose a category to preview the email.');
  await expect(dialog.getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(calls.filter((c) => c.path.endsWith('/preview'))).toHaveLength(0);

  // A full category on a reserving form warns before the organizer tries.
  await picker.selectOption('t-cart');
  await expect(dialog.getByTestId('decision-category-full')).toContainText('Cart is full');

  await picker.selectOption('t-truck');
  await expect(dialog.getByTestId('decision-category-full')).toHaveCount(0);
  await expect(dialog).toContainText('Approving reserves a space in this category. Nothing is charged');
  await expect(dialog.getByLabel('Subject')).toHaveValue('You are approved for Street Food Fest: choose your space');
  await expect(dialog.getByLabel('Message')).toHaveValue(/approved as Food truck/);
  expect(calls.filter((c) => c.path.endsWith('/preview')).at(-1)?.body).toEqual({ decision: 'APPROVE', tierId: 't-truck' });

  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const decision = calls.find((c) => c.path.endsWith('/decision'));
  expect(decision?.body).toMatchObject({ decision: 'APPROVE', tierId: 't-truck', sendEmail: true });
  expect(decision?.body?.message ?? null).toBeNull(); // the template as rendered, not an edit

  // Nothing was charged: the vendor now chooses a space.
  await expect(page.getByTestId('application-awaiting-space')).toContainText('Awaiting space');
  await expect(page.getByTestId('application-awaiting-space')).toContainText('a space in this category is reserved for them');
  await expect(page.getByTestId('application-category')).toContainText('Food truck');
});

test('the submissions list offers an "Awaiting space" chip that filters approved vendors still choosing', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'approve-list', email: 'approve-list@test.com', role: 'ORGANIZER' }, baseURL!);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Street Food Co', status: 'ACTIVE' }])) : route.fallback()
  );
  const searches: string[] = [];
  const row = { id: APP_ID, shortId: 'APPROVE1', orderId: null, orderRef: null, eventId: EVENT_ID, event: { id: EVENT_ID, name: 'Street Food Fest', date: '2027-05-02T15:00:00.000Z' }, formId: FORM_ID, formName: 'Food vendors', formKind: 'PAID', status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', businessName: 'Taco Truck Co', logoUrl: null, contact: { email: 'taco@example.com', firstName: 'Tia', lastName: 'Taco' }, tier: { id: 't-truck', name: 'Food truck' }, applicantPays: 0, addOns: [], submittedAt: '2026-09-16T14:00:00.000Z', decidedAt: '2026-09-17T09:00:00.000Z', paymentDueAt: '2026-09-24T09:00:00.000Z', overdue: false, boothLabel: null, booth: null, mapBound: false, selectionHeldUntil: null, tags: [], checkedInAt: null, checkedOutAt: null, pinnedAnswers: [], statusUrl: null };
  await page.route(`${API}/admin/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/admin/events/${EVENT_ID}/applications`) {
      searches.push(url.search);
      return route.fulfill(json({ data: [row], total: 1, page: 1, pageSize: 50, summary: { SUBMITTED: 2, APPROVED: 1 }, awaitingSpace: 1 }));
    }
    if (url.pathname === `/admin/events/${EVENT_ID}/application-forms`) return route.fulfill(json({ data: [] }));
    if (url.pathname.endsWith('/applications/tags')) return route.fulfill(json({ data: [] }));
    return route.fulfill(json({ data: [] }));
  });
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json({ id: EVENT_ID, name: 'Street Food Fest', date: '2027-05-02T15:00:00.000Z', status: 'PUBLISHED', venue: { id: 'v', name: 'Lot', timezone: 'America/New_York' }, priceTiers: [] })));
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  const chip = page.getByTestId('applications-awaiting-space');
  await expect(chip).toContainText('Awaiting space 1');
  await chip.click();
  await expect.poll(() => searches.at(-1) ?? '').toContain('payment=AWAITING_SELECTION');
  expect(searches.at(-1)).toContain('status=APPROVED');
  await expect(page.getByText('Awaiting space').first()).toBeVisible();
});
