// Add-ons on applications (spec 012 phase 2) with the backend mocked at the
// network layer: since spec 037 phase 5 the apply form carries none (they are
// chosen with the space after approval) — the choose-your-space picker and
// total line, the selection payload, the admin detail lines + edit dialog, the list column + filter,
// and the form editor's per-tier "Add-ons offered".

import { expect, test, type Page } from '@playwright/test';
import { LEGAL_VERSIONS, mockLegalVersions } from './helpers/legal';
import { signInAsStaff } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-apps-addons';
const EVENT_ID = 'evt-apps-addons';
const FORM_ID = 'form-vendor';
const APP_ID = 'app-addons-1';

const event = {
  id: EVENT_ID,
  name: 'Maker Fair 2027',
  description: 'Makers and vendors',
  date: '2027-10-02T15:00:00.000Z',
  capacity: 500,
  status: 'PUBLISHED',
  taxRate: 0.1,
  organizationId: ORG_ID,
  organizationName: 'Durham Makers',
  organizationBrandColor: '#0f766e',
  venue: { id: 'v1', name: 'Maker Hall', address: '1 Maker Way', city: 'Durham', state: 'NC', timezone: 'America/New_York' },
  priceTiers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const POWER = { id: 'addon-power', name: 'Booth power', description: 'One 110V drop', price: 125, taxable: false, applicantPays: 135.95, maxPerOrder: null, remaining: 2, soldOut: false };
const BADGE = { id: 'addon-badge', name: 'Extra vendor badge', description: null, price: 10, taxable: false, applicantPays: 11.11, maxPerOrder: 4, remaining: null, soldOut: false };
const TABLE = { id: 'addon-table', name: 'Table & chairs', description: null, price: 40, taxable: true, applicantPays: 48.76, maxPerOrder: null, remaining: null, soldOut: false };

const boothTier = { id: 't-booth', name: 'Booth', description: null, price: 275, applicantPays: 303.3, feesIncluded: 28.3, tax: 0, soldOut: false, addOns: [POWER, BADGE, TABLE] };
const cornerTier = { id: 't-corner', name: 'Corner', description: null, price: 400, applicantPays: 440.3, feesIncluded: 40.3, tax: 0, soldOut: false, addOns: [POWER, TABLE] };

const publicForm = {
  id: FORM_ID,
  kind: 'PAID',
  name: 'Vendor Booth',
  slug: 'vendor-booth',
  intro: null,
  acceptance: { open: true, reason: null },
  chargeTiming: 'APPROVAL',
  feeMode: 'PASS',
  tiers: [boothTier, cornerTier],
  questions: [],
};

const adminTier = (t: typeof boothTier) => ({
  ...t,
  quantityTotal: 5,
  quantityApproved: 1,
  quantityReserved: 0,
  remaining: 4,
  displayOrder: 0,
  isActive: true,
  amounts: { subtotal: t.price, platformFee: 0, processingFee: 0, tax: 0, applicantPays: t.applicantPays, orgReceives: t.price, feeMode: 'PASS' },
  addOns: t.addOns.map((a) => ({ ...a, allTiers: a.id !== BADGE.id, isActive: true })),
});

const adminForm = {
  ...publicForm,
  eventId: EVENT_ID,
  status: 'OPEN',
  opensAt: null,
  closesAt: null,
  taxable: false,
  paymentDueDays: 7,
  overduePolicy: 'WITHDRAW',
  displayOrder: 0,
  paymentsEnabled: true,
  applicationCount: 1,
  tiers: [adminTier(boothTier), adminTier(cornerTier)],
  addOns: [
    { id: POWER.id, name: POWER.name, price: POWER.price, allTiers: true, isActive: true, scope: 'APPLICATION' },
    { id: BADGE.id, name: BADGE.name, price: BADGE.price, allTiers: false, isActive: true, scope: 'APPLICATION' },
    { id: TABLE.id, name: TABLE.name, price: TABLE.price, allTiers: true, isActive: true, scope: 'BOTH' },
  ],
};

const profile = { id: 'prof-1', businessName: 'Hidden Block Games', description: null, website: null, socials: {}, photos: [] };
const lines = [
  { id: 'line-1', addOnId: POWER.id, name: POWER.name, quantity: 1, unitPrice: 125, applicantPays: 135.95 },
  { id: 'line-2', addOnId: BADGE.id, name: BADGE.name, quantity: 2, unitPrice: 10, applicantPays: 22.22 },
];
const amounts = { subtotal: 420, platformFee: 21, processingFee: 20.4, tax: 0, applicantPays: 461.4, orgReceives: 420, feeMode: 'PASS', currency: 'usd' };

function adminApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    form: { id: FORM_ID, name: 'Vendor Booth', slug: 'vendor-booth', kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
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
    payment: { stripePaymentIntentId: null, stripePaymentMethodId: 'on_file', stripeAccountId: null, applicationFee: null, chargeAttempts: 0, paidAt: null, paymentDueAt: null, overdue: false, refundedTotal: 0, refundable: 0, stripeDashboardUrl: null, canRefund: false, canRetryCharge: false },
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

const rows = [
  { id: APP_ID, formId: FORM_ID, formName: 'Vendor Booth', formKind: 'PAID', status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', businessName: 'Hidden Block Games', contact: { email: 'vee@hiddenblock.example', firstName: 'Vee', lastName: 'Vendor' }, tier: { id: boothTier.id, name: 'Booth' }, applicantPays: 461.4, addOns: lines.map((l) => ({ addOnId: l.addOnId, name: l.name, quantity: l.quantity })), submittedAt: '2026-09-16T14:00:00.000Z', decidedAt: null, paymentDueAt: null, overdue: false, boothLabel: null },
  { id: 'app-2', formId: FORM_ID, formName: 'Vendor Booth', formKind: 'PAID', status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', businessName: 'Pixel Pins', contact: { email: 'pins@example.com', firstName: 'Pix', lastName: 'Pins' }, tier: { id: cornerTier.id, name: 'Corner' }, applicantPays: 440.3, addOns: [], submittedAt: '2026-09-16T12:00:00.000Z', decidedAt: null, paymentDueAt: null, overdue: false, boothLabel: null },
];

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' = 'ORGANIZER') {
  await signInAsStaff(page, { id: `addons-${role.toLowerCase()}`, email: `addons-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Durham Makers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  const state = { app: adminApp(), form: adminForm };
  const calls: { method: string; path: string; body?: unknown; search?: string }[] = [];
  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body, search: url.search });
    if (path === `/admin/events/${EVENT_ID}/applications` && method === 'GET') {
      const addOn = url.searchParams.get('addOn');
      const data = rows.filter((r) => !addOn || r.addOns.some((l) => l.addOnId === addOn));
      return route.fulfill(json({ data, total: data.length, page: 1, pageSize: 50, summary: { SUBMITTED: 2 } }));
    }
    if (path === `/admin/events/${EVENT_ID}/application-forms` && method === 'GET') return route.fulfill(json({ data: [state.form] }));
    if (path === `/admin/events/${EVENT_ID}/application-forms/${FORM_ID}` && method === 'GET') return route.fulfill(json(state.form));
    if (path === `/admin/events/${EVENT_ID}/application-forms/${FORM_ID}/tiers/${cornerTier.id}` && method === 'PATCH') return route.fulfill(json(state.form.tiers[1]));
    if (path === `/admin/events/${EVENT_ID}/application-forms/${FORM_ID}/tiers/${cornerTier.id}/add-ons` && method === 'PUT') {
      const attached = state.form.addOns.filter((a) => !a.allTiers && body.addOnIds.includes(a.id));
      const tier = { ...state.form.tiers[1], addOns: [...state.form.tiers[1].addOns, ...attached.map((a) => ({ ...BADGE, allTiers: false, isActive: true }))] };
      state.form = { ...state.form, tiers: [state.form.tiers[0], tier] };
      return route.fulfill(json(tier));
    }
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}` && method === 'GET') return route.fulfill(json(state.app));
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}/add-ons` && method === 'PATCH') {
      const next = (body.addOns as { addOnId: string; quantity: number }[]).map((l, i) => {
        const a = boothTier.addOns.find((x) => x.id === l.addOnId)!;
        return { id: `line-${i}`, addOnId: a.id, name: a.name, quantity: l.quantity, unitPrice: a.price, applicantPays: Math.round(a.applicantPays * l.quantity * 100) / 100 };
      });
      const total = Math.round((303.3 + next.reduce((s, l) => s + l.applicantPays, 0)) * 100) / 100;
      state.app = adminApp({
        addOns: next,
        amounts: { ...amounts, applicantPays: total },
        decisions: [{ id: 'd1', action: 'ADD_ONS_CHANGED', byUserId: 'u1', note: 'Add-ons: Booth power ×1, Extra vendor badge ×2 → Booth power ×2. Total $461.40 → $575.20.', emailSubject: 'Your Maker Fair 2027 application was updated', emailBody: 'Hi Vee', createdAt: '2026-09-17T10:00:00.000Z' }],
      });
      return route.fulfill(json(state.app));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls, state };
}

// ─── Public ──────────────────────────────────────────────────────────────────

test('apply form (spec 037 phase 5): no category, no add-ons, no total and no card — the submission carries none', async ({ page }) => {
  await mockLegalVersions(page, API);
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/events/${EVENT_ID}/applications/forms/vendor-booth`, (route) => route.fulfill(json(publicForm)));
  let payload: Record<string, unknown> | null = null;
  await page.route(`${API}/events/${EVENT_ID}/applications`, async (route) => {
    const raw = route.request().postData() ?? '';
    const match = raw.match(/name="payload"\r?\n\r?\n([\s\S]*?)\r?\n--/);
    payload = match ? JSON.parse(match[1]) : null;
    return route.fulfill(json({ applicationId: APP_ID, orderRef: null, statusUrl: `http://localhost:3001/events/${EVENT_ID}/apply/status/${APP_ID}?token=t`, next: 'done' }, 201));
  });
  await page.route(`${API}/applications/${APP_ID}/status**`, (route) => route.fulfill(json({ error: 'NotFoundError', message: 'later' }, 404)));

  await page.goto(`/events/${EVENT_ID}/apply/vendor-booth`);
  await expect(page.getByTestId('apply-form')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Booth/ })).toHaveCount(0);
  await expect(page.getByTestId('add-on-picker')).toHaveCount(0);
  await expect(page.getByTestId('apply-card-authorization')).toHaveCount(0);
  const summary = page.getByRole('complementary', { name: 'Application summary' });
  await expect(summary).toContainText('Cost to apply');
  await expect(summary).toContainText('Free');
  await expect(page.getByTestId('apply-next-steps')).toContainText('Choose your space and pay');

  await page.getByLabel('First name').fill('Vee');
  await page.getByLabel('Last name').fill('Vendor');
  await page.getByRole('textbox', { name: 'Email' }).fill('vee@hiddenblock.example');
  await page.getByLabel('Business or outlet name').fill('Hidden Block Games');
  await page.getByTestId('apply-consent').check();
  await summary.getByRole('button', { name: 'Submit application' }).click();
  await expect.poll(() => payload).not.toBeNull();
  expect(payload).not.toHaveProperty('tierId');
  expect(payload).not.toHaveProperty('addOns');
  expect(payload).toMatchObject({
    formSlug: 'vendor-booth',
    optInAccount: true,
    acceptances: [
      { document: 'TERMS', version: LEGAL_VERSIONS.terms },
      { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
    ],
  });
  await expect(page).toHaveURL(new RegExp(`/apply/status/${APP_ID}`));
});

test('choose your space: the category offers its add-ons, the total line updates, and the hold carries the lines', async ({ page }) => {
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  let selectBody: Record<string, unknown> | null = null;
  await page.route(`${API}/applications/${APP_ID}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) {
      return route.fulfill(
        json({
          id: APP_ID,
          orderRef: null,
          form: { id: FORM_ID, name: 'Vendor Booth', kind: 'PAID' },
          event: { id: EVENT_ID, name: event.name, date: event.date },
          organization: { id: ORG_ID, name: 'Durham Makers' },
          status: 'APPROVED',
          paymentStatus: 'AWAITING_SELECTION',
          tier: { id: boothTier.id, name: 'Booth', mapBound: false },
          amounts: { ...amounts, subtotal: 0, applicantPays: 0, orgReceives: 0, platformFee: 0, processingFee: 0 },
          addOns: [],
          paymentDueAt: '2026-10-01T00:00:00.000Z',
          selection: {
            state: 'CHOOSE',
            heldUntil: null,
            dueAt: '2026-10-01T00:00:00.000Z',
            reserveOnApproval: false,
            category: { id: boothTier.id, name: 'Booth', description: null, price: 275, applicantPays: 303.3, feesIncluded: 28.3, tax: 0, spacesLeft: 4, guaranteed: false },
            addOns: [POWER, BADGE, TABLE],
            map: { available: false, mapId: null, boothsAvailable: 0 },
            placedBooth: null,
            savedCard: null,
          },
          profile,
          answers: [],
          boothLabel: null,
          booth: null,
          hasCardOnFile: false,
          submittedAt: '2026-09-16T14:00:00.000Z',
          decidedAt: '2026-09-17T09:00:00.000Z',
          paidAt: null,
          refundedTotal: 0,
          canWithdraw: false,
          canResume: false,
          canPay: false,
          canUpdateCard: false,
        })
      );
    }
    if (url.pathname.endsWith('/select')) {
      selectBody = route.request().postDataJSON();
      return route.fulfill(json({ error: 'ConflictError', message: 'No Booth spaces are left.', code: 'SOLD_OUT' }, 409));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: 'unmocked' }, 404));
  });

  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=tok`);
  const choose = page.getByTestId('choose-space');
  await expect(choose).toBeVisible();
  // No map for this event: no tabs, the list only.
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByTestId('space-left')).toContainText('4 spaces left');
  await expect(choose).toContainText('Spaces go to whoever pays first');
  await expect(page.getByTestId(`add-on-${POWER.id}`)).toContainText('$135.95');

  await page.getByRole('button', { name: `Increase ${POWER.name} quantity` }).click();
  await page.getByRole('button', { name: `Increase ${BADGE.name} quantity` }).click();
  await page.getByRole('button', { name: `Increase ${BADGE.name} quantity` }).click();
  await expect(page.getByTestId('space-total')).toContainText('$461.47');
  await page.getByTestId('space-hold').click();
  await expect.poll(() => selectBody).not.toBeNull();
  expect(selectBody).toEqual({ addOns: [{ addOnId: POWER.id, quantity: 1 }, { addOnId: BADGE.id, quantity: 2 }], useSavedCard: false });
  // Someone took the last space first: the vendor is told plainly.
  await expect(page.getByTestId('space-notice')).toContainText('No Booth spaces are left right now');
});

test('status page itemises the tier and add-on lines', async ({ page }) => {
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/applications/${APP_ID}/status**`, (route) =>
    route.fulfill(
      json({
        id: APP_ID,
        form: { id: FORM_ID, name: 'Vendor Booth', kind: 'PAID' },
        event: { id: EVENT_ID, name: event.name, date: event.date },
        organization: { id: ORG_ID, name: 'Durham Makers' },
        status: 'SUBMITTED',
        paymentStatus: 'CARD_ON_FILE',
        tier: { id: boothTier.id, name: 'Booth' },
        amounts,
        addOns: lines,
        paymentDueAt: null,
        profile,
        answers: [],
        boothLabel: null,
        submittedAt: '2026-09-16T14:00:00.000Z',
        decidedAt: null,
        paidAt: null,
        refundedTotal: 0,
        canWithdraw: true,
        canResume: false,
        canPay: false,
        canUpdateCard: true,
      })
    )
  );
  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=tok`);
  const list = page.getByTestId('apply-add-ons');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Booth');
  await expect(list).toContainText('$303.23');
  await expect(list).toContainText('Booth power ×1');
  await expect(list).toContainText('$135.95');
  await expect(list).toContainText('Extra vendor badge ×2');
  await expect(page.getByTestId('apply-payment')).toContainText('$461.40');
});

// ─── Admin ───────────────────────────────────────────────────────────────────

test('admin detail: lines, edit dialog sends the full set and records ADD_ONS_CHANGED', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  const block = page.getByTestId('application-add-ons');
  await expect(block).toBeVisible();
  await expect(page.getByTestId(`application-add-on-${POWER.id}`)).toContainText('Booth power ×1 @ $125.00');
  await expect(page.getByTestId(`application-add-on-${BADGE.id}`)).toContainText('$22.22');

  await page.getByTestId('application-edit-add-ons').click();
  const dialog = page.getByTestId('edit-add-ons-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(`add-on-${TABLE.id}`)).toBeVisible();
  await expect(page.getByTestId('edit-add-ons-estimate')).toContainText('$461.40');

  // Drop both badges, add a second power drop.
  await page.getByRole('button', { name: `Decrease ${BADGE.name} quantity` }).click();
  await page.getByRole('button', { name: `Decrease ${BADGE.name} quantity` }).click();
  await page.getByRole('button', { name: `Increase ${POWER.name} quantity` }).click();
  await expect(page.getByTestId('edit-add-ons-estimate')).toContainText('$575.13');
  await page.getByRole('button', { name: 'Save and email applicant' }).click();

  await expect(page.getByRole('status')).toContainText('Add-ons updated. New total $575.20');
  const patch = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/add-ons'));
  expect(patch?.body).toEqual({ addOns: [{ addOnId: POWER.id, quantity: 2 }] });
  await expect(page.getByTestId(`application-add-on-${POWER.id}`)).toContainText('×2');
  await expect(page.getByTestId(`application-add-on-${BADGE.id}`)).toHaveCount(0);
  await expect(page.getByTestId('application-history')).toContainText('Add-ons changed');
  await expect(page.getByTestId('application-history')).toContainText('Total $461.40 → $575.20');
});

test('admin detail: paid application shows the lines locked', async ({ page, baseURL }) => {
  const { state } = await mockAdmin(page, baseURL!);
  state.app = adminApp({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', addOnsEditable: { allowed: false, reason: 'Already paid — refund part of the amount instead' } });
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await expect(page.getByTestId('application-add-ons')).toContainText('Locked');
  await expect(page.getByTestId('application-add-ons')).toContainText('Already paid');
  await expect(page.getByTestId('application-edit-add-ons')).toHaveCount(0);
});

test('admin list: add-ons column and "has add-on" filter', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  await expect(page.getByTestId(`application-add-ons-${APP_ID}`)).toContainText('Booth power ×1, Extra vendor badge ×2');
  await expect(page.getByTestId('application-add-ons-app-2')).toContainText('—');
  await page.getByTestId('applications-add-on-filter').selectOption(BADGE.id);
  await expect(page.getByTestId('application-row-app-2')).toHaveCount(0);
  await expect(page.getByTestId(`application-row-${APP_ID}`)).toBeVisible();
  expect(calls.some((c) => c.path.endsWith('/applications') && c.search?.includes(`addOn=${BADGE.id}`))).toBe(true);
  await expect(page).toHaveURL(/addOn=addon-badge/);
});

test('form editor: tier rows show offered add-ons; ADMIN attaches a restricted one on save', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!, 'ADMIN');
  await page.goto(`/admin/events/${EVENT_ID}/applications/forms/${FORM_ID}`);
  await expect(page.getByTestId(`tier-add-ons-summary-${cornerTier.id}`)).toContainText('Booth power, Table & chairs');
  await page.getByTestId(`tier-row-${cornerTier.id}`).getByRole('button', { name: 'Edit' }).click();
  const fieldset = page.getByTestId(`tier-add-ons-${cornerTier.id}`);
  await expect(fieldset).toContainText('Included on every option: Booth power, Table & chairs');
  await fieldset.getByRole('checkbox', { name: /Extra vendor badge/ }).check();
  await page.getByTestId('form-tiers').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Add-ons saved.');
  const put = calls.find((c) => c.method === 'PUT' && c.path.endsWith(`/tiers/${cornerTier.id}/add-ons`));
  expect(put?.body).toEqual({ addOnIds: [BADGE.id] });
  await expect(page.getByTestId(`tier-add-ons-summary-${cornerTier.id}`)).toContainText('Extra vendor badge');
});
