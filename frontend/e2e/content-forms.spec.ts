// Content › Forms (spec 044B): create a standing form, add a field, review a
// submission in the shared submissions table and decide on it. Backend mocked.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG = { id: 'org-forms', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers', status: 'ACTIVE' };
const FORM_ID = 'form-vendor';
const SUB = `/admin/standing-application-forms/${FORM_ID}/submissions`;
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

function standingForm(questions: unknown[]) {
  return {
    id: FORM_ID,
    eventId: null,
    organizationId: ORG.id,
    kind: 'FREE',
    name: 'Become a vendor',
    slug: 'become-a-vendor',
    intro: null,
    collectBusiness: true,
    buttonLabel: null,
    successMessage: null,
    status: 'OPEN',
    opensAt: null,
    closesAt: null,
    chargeTiming: 'APPROVAL',
    feeMode: 'PASS',
    taxable: false,
    paymentDueDays: 7,
    overduePolicy: 'WITHDRAW',
    reserveOnApproval: true,
    spaceSelection: null,
    displayOrder: 0,
    createdFromTemplateId: null,
    acceptance: { open: true, reason: null },
    paymentsEnabled: false,
    applicationCount: 1,
    tiers: [],
    questions,
    addOns: [],
    updatedAt: '2026-10-04T12:00:00.000Z',
  };
}

const row = {
  id: 'app-pixel',
  shortId: 'APPPIXEL',
  orderId: null,
  orderRef: null,
  eventId: null,
  event: null,
  formId: FORM_ID,
  formName: 'Become a vendor',
  formKind: 'FREE',
  status: 'SUBMITTED',
  paymentStatus: 'NOT_REQUIRED',
  businessName: 'Pixel Pins',
  logoUrl: null,
  contact: { email: 'pins@example.com', firstName: 'Pix', lastName: 'Pins' },
  tier: null,
  applicantPays: 0,
  addOns: [],
  submittedAt: '2026-10-03T14:00:00.000Z',
  decidedAt: null,
  paymentDueAt: null,
  overdue: false,
  boothLabel: null,
  tags: [],
  checkedInAt: null,
  checkedOutAt: null,
  pinnedAnswers: [],
  statusUrl: null,
};

function detail(status: string) {
  return {
    id: row.id,
    orderId: null,
    orderRef: null,
    form: { id: FORM_ID, name: 'Become a vendor', slug: 'become-a-vendor', kind: 'FREE', chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW' },
    event: null,
    status,
    paymentStatus: 'NOT_REQUIRED',
    capacitySlot: 'NONE',
    contact: { id: 'c1', ...row.contact, accountCreatedAt: null },
    profile: { id: 'p1', businessName: 'Pixel Pins', description: 'Enamel pins', website: null, socials: {}, photos: [], updatedAt: '2026-10-03T14:00:00.000Z' },
    tier: null,
    amounts: { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' },
    pricing: null,
    addOns: [],
    addOnsEditable: { allowed: false, reason: null },
    adjustments: [],
    amountEditable: { allowed: false, reason: null },
    canSettleOffline: false,
    paymentSource: 'stripe',
    offlinePayment: null,
    payment: { stripePaymentIntentId: null, stripePaymentMethodId: null, stripeAccountId: null, applicationFee: null, chargeAttempts: 0, lastChargeError: null, paidAt: null, refundedTotal: 0, payNowUrl: null },
    answers: [],
    decisions: [],
    refunds: [],
    submittedAt: row.submittedAt,
    decidedAt: null,
    decidedById: null,
    withdrawnBy: null,
    withdrawReason: null,
    boothLabel: null,
    internalNote: null,
    tags: [],
    checkedInAt: null,
    checkedOutAt: null,
  };
}

async function mockApi(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'forms-admin', email: 'forms-admin@test.com', role: 'ADMIN' }, baseURL);
  const state = { created: false, questions: [] as unknown[], status: 'SUBMITTED' };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData() as string) : undefined;
    calls.push({ method, path, body });
    if (path === '/organizations') return route.fulfill(json([ORG]));
    if (path === '/admin/application-templates') return route.fulfill(json({ data: [] }));
    if (path === '/admin/standing-application-forms' && method === 'GET') return route.fulfill(json({ data: state.created ? [standingForm(state.questions)] : [] }));
    if (path === '/admin/standing-application-forms' && method === 'POST') {
      state.created = true;
      return route.fulfill(json(standingForm([]), 201));
    }
    if (path === `/admin/standing-application-forms/${FORM_ID}` && method === 'GET') return route.fulfill(json(standingForm(state.questions)));
    if (path === `/admin/standing-application-forms/${FORM_ID}/questions` && method === 'POST') {
      const q = { id: 'q-1', label: body.label, helpText: body.helpText ?? null, type: body.type, required: body.required, options: [], displayOrder: 0, pinned: false };
      state.questions = [q];
      return route.fulfill(json(q, 201));
    }
    if (path === SUB) return route.fulfill(json({ data: [{ ...row, status: state.status }], total: 1, page: 1, pageSize: 50, summary: { [state.status]: 1 } }));
    if (path === `${SUB}/summary`) return route.fulfill(json({ [state.status]: 1 }));
    if (path === `${SUB}/tags`) return route.fulfill(json({ data: [] }));
    if (path === `${SUB}/${row.id}` && method === 'GET') return route.fulfill(json(detail(state.status)));
    if (path === `${SUB}/${row.id}/preview`) return route.fulfill(json({ subject: 'You are approved', body: 'Welcome aboard, Pix.' }));
    if (path === `${SUB}/${row.id}/decision`) {
      state.status = 'APPROVED';
      return route.fulfill(json(detail('APPROVED')));
    }
    return route.fulfill(json({}, 404));
  });
  return calls;
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`${viewport.name}: create a form, add a field, decide on a submission`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const calls = await mockApi(page, baseURL!);

    await page.goto('/admin/content/forms');
    await expect(page.getByTestId('forms-empty-state')).toContainText('No forms yet');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page.getByRole('link', { name: 'Create your first form' }).click();

    await page.locator('#new-form-name').fill('Become a vendor');
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/content/forms/${FORM_ID}\\?tab=fields`));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/standing-application-forms')?.body).toEqual({ name: 'Become a vendor' });
    await expect(page.getByTestId('form-tab-fields')).toHaveAttribute('aria-current', 'page');

    await page.getByLabel('Question', { exact: true }).fill('What do you sell?');
    await page.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByText('Question added.')).toBeVisible();
    await expect(page.getByTestId('question-row-q-1')).toContainText('What do you sell?');

    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);

    await page.getByTestId('form-tab-submissions').click();
    await expect(page).not.toHaveURL(/tab=/);
    const tableRow = page.getByTestId(`application-row-${row.id}`);
    await expect(tableRow).toContainText('Pixel Pins');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    // A standing form has no money: no Payment or Add-ons columns, no payment filter.
    await expect(page.getByRole('columnheader', { name: 'Payment' })).toHaveCount(0);
    await expect(page.getByLabel('Payment')).toHaveCount(0);

    await page.getByTestId(`application-actions-${row.id}`).click();
    const menu = page.getByRole('menu', { name: 'Actions for Pixel Pins' });
    await expect(menu.getByRole('menuitem', { name: 'Withdraw' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve application' });
    await expect(dialog.getByLabel('Subject')).toHaveValue('You are approved');
    await expect(dialog.getByLabel('Email the applicant')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tableRow).toContainText('Approved');
    expect(calls.some((c) => c.path === `${SUB}/${row.id}/decision` && (c.body as { decision: string }).decision === 'APPROVE')).toBe(true);

    await tableRow.getByRole('link', { name: 'Pixel Pins' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/content/forms/${FORM_ID}/submissions/${row.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Pixel Pins' })).toBeVisible();
    await expect(page.getByLabel('Booth / placement')).toHaveCount(0);
  });
}
