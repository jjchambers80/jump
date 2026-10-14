// Pinned answer columns (spec 019) on the setup wizard's Fields step. Backend
// mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-tpl';
const EXPO = { id: 'evt-expo', name: 'Gaming Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', status: 'PUBLISHED' };
const PAST = { id: 'evt-past', name: 'Retro Night 2025', date: '2025-01-10T15:00:00.000Z', status: 'PUBLISHED' };
const CANCELLED = { id: 'evt-cancelled', name: 'Cancelled Con', date: '2027-03-10T15:00:00.000Z', status: 'CANCELLED' };
const DRAFT_EVENT = { id: 'evt-draft', name: 'Winter Con 2028', date: '2028-01-10T15:00:00.000Z', status: 'DRAFT' };

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const vendorForm = {
  id: 'form-vendor',
  eventId: EXPO.id,
  kind: 'PAID',
  name: 'Vendor Space',
  slug: 'vendor-space',
  intro: 'Sell your wares.',
  status: 'DRAFT',
  opensAt: null,
  closesAt: null,
  chargeTiming: 'APPROVAL',
  feeMode: 'ABSORB',
  taxable: true,
  paymentDueDays: 10,
  overduePolicy: 'HOLD',
  displayOrder: 0,
  acceptance: { open: false, reason: 'not_published' },
  paymentsEnabled: true,
  applicationCount: 0,
  tiers: [{ id: 't1', name: '10x10', description: null, price: 275, quantityTotal: 5, quantityApproved: 0, quantityReserved: 0, remaining: 5, displayOrder: 0, isActive: true, amounts: { subtotal: 275, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 275, orgReceives: 275, feeMode: 'ABSORB' }, addOns: [] }],
  questions: [
    { id: 'q1', label: 'What do you sell?', helpText: null, type: 'LONG_TEXT', required: true, options: [], displayOrder: 0, pinned: true },
    { id: 'q2', label: 'Website', helpText: null, type: 'URL', required: false, options: [], displayOrder: 1, pinned: false },
    { id: 'q3', label: 'Years exhibiting', helpText: null, type: 'NUMBER', required: false, options: [], displayOrder: 2, pinned: false },
  ],
  addOns: [],
};

const orgForms = [
  { id: vendorForm.id, eventId: EXPO.id, event: EXPO, kind: 'PAID', name: 'Vendor Space', slug: 'vendor-space', status: 'DRAFT', opensAt: null, closesAt: null, acceptance: { open: false, reason: 'not_published' }, applicationCount: 0, addOns: [], updatedAt: '2026-09-01T00:00:00.000Z' },
];

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' = 'ADMIN') {
  await signInAsStaff(page, { id: `tpl-${role.toLowerCase()}`, email: `tpl-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/organizations/${ORG_ID}/events?**`, (route) =>
    route.fulfill(json({ events: [PAST, EXPO, CANCELLED, DRAFT_EVENT].map((e) => ({ ...e, venue: { id: 'v1', name: 'RCC' }, priceTiers: [] })), pagination: { page: 1, limit: 100, total: 4, totalPages: 1 } }))
  );
  await page.route(`${API}/events/${EXPO.id}`, (route) => route.fulfill(json({ ...EXPO, organizationId: ORG_ID, venue: { id: 'v1', name: 'RCC' }, priceTiers: [] })));

  const state: {
    form: Omit<typeof vendorForm, 'tiers' | 'questions'> & { tiers: Record<string, unknown>[]; questions: Record<string, unknown>[] };
    createdForms: { id: string; eventId: string; body: unknown }[];
  } = { form: { ...vendorForm }, createdForms: [] as { id: string; eventId: string; body: unknown }[] };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let seq = 0;

  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body });

    if (path === '/admin/application-forms' && method === 'GET') return route.fulfill(json({ data: orgForms }));
    const create = path.match(/^\/admin\/events\/([^/]+)\/application-forms$/);
    if (create && method === 'POST') {
      seq += 1;
      const b = body as { name: string; kind: string; purpose?: string };
      const form = {
        ...vendorForm,
        id: `form-new-${seq}`,
        eventId: create[1],
        name: b.name,
        kind: b.kind,
        slug: b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        purpose: b.purpose ?? 'OTHER',
        tiers: [],
        questions: [],
      };
      state.createdForms.push({ id: form.id, eventId: create[1], body });
      state.form = form;
      return route.fulfill(json(form, 201));
    }
    if (create && method === 'GET') return route.fulfill(json({ data: [state.form] }));
    const question = path.match(/^\/admin\/events\/([^/]+)\/application-forms\/([^/]+)\/questions\/([^/]+)$/);
    if (question && method === 'PATCH') {
      const b = body as Record<string, unknown>;
      const pinnedAfter = state.form.questions.filter((x) => (x.id === question[3] ? b.pinned === true : x.pinned)).length;
      if (pinnedAfter > 2) return route.fulfill(json({ error: 'ValidationError', message: 'At most 2 questions can be pinned to the list' }, 400));
      state.form = { ...state.form, questions: state.form.questions.map((x) => (x.id === question[3] ? { ...x, ...b } : x)) };
      return route.fulfill(json(state.form.questions.find((x) => x.id === question[3])));
    }
    const one = path.match(/^\/admin\/events\/([^/]+)\/application-forms\/([^/]+)$/);
    if (one && method === 'GET') return route.fulfill(json(state.form));
    if (one && method === 'PATCH') {
      state.form = { ...state.form, ...(body as object) };
      return route.fulfill(json(state.form));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `Unmocked ${method} ${path}` }, 404));
  });
  return { state, calls };
}

/**
 * Since spec 050-P event forms are configured in the setup wizard (the old
 * forms pages redirect to its steps). These are the wizard's own reads,
 * registered after mockAdmin so they win over its `/admin/**` catch-all.
 */
async function mockWizard(page: Page, event: { id: string; name: string; date: string; status: string }) {
  const venue = { id: 'v1', name: 'RCC', address: '500 S Salisbury St', timezone: 'America/New_York' };
  const adminEvent = {
    ...event, slug: event.id, description: null, logoUrl: null, endDate: null, capacity: 100, category: null, admissionMode: 'TICKETED',
    setupStep: null, setupCompletedAt: '2026-01-01T00:00:00.000Z', rsvpLimit: null, rsvpMaxPartySize: 1, rsvpRemaining: null,
    tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false, organizationId: ORG_ID, venue, priceTiers: [],
  };
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([venue])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${event.id}/overview`, (route) =>
    route.fulfill(json({ event: adminEvent, applications: { forms: [] }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${event.id}/preview-payload`, (route) =>
    route.fulfill(json({ event: adminEvent, organization: { id: ORG_ID, name: 'Raleigh Retro Gamers' }, forms: [] }))
  );
}
const COLD = { timeout: 60000 };

test('wizard form editor: pin a second question as a list column; the third toggle is disabled at the cap; unpin frees it', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const { calls } = await mockAdmin(page, baseURL!);
  await mockWizard(page, EXPO);
  await page.goto(`/admin/events/${EXPO.id}/setup/other-applications?step=questions&form=${vendorForm.id}`);
  await expect(page.getByTestId('question-pinned-q1')).toHaveText('List column', COLD);
  await expect(page.getByTestId('question-pinned-q2')).toHaveCount(0);

  const rowQ2 = page.getByTestId('question-row-q2');
  await rowQ2.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('qe-q2-pinned')).toBeEnabled();
  await page.getByTestId('qe-q2-pinned').check();
  await rowQ2.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('question-pinned-q2')).toHaveText('List column');
  expect(calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/questions/q2'))?.body).toMatchObject({ pinned: true, label: 'Website' });

  // Two pinned: the third question's toggle and the add form's toggle are disabled.
  const rowQ3 = page.getByTestId('question-row-q3');
  await rowQ3.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('qe-q3-pinned')).toBeDisabled();
  await rowQ3.getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('question-add-open').click();
  await expect(page.getByTestId('qn-pinned')).toBeDisabled();

  // Unpin q1 → q3 can be pinned.
  const rowQ1 = page.getByTestId('question-row-q1');
  await rowQ1.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('qe-q1-pinned').uncheck();
  await rowQ1.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('question-pinned-q1')).toHaveCount(0);
  await expect(page.getByTestId('qn-pinned')).toBeEnabled();
});
