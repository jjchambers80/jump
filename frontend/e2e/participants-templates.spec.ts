// Participants › Applications tab and form templates (spec 019 phase 2).
// Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-tpl';
const EXPO = { id: 'evt-expo', name: 'Gaming Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', status: 'PUBLISHED' };
const PAST = { id: 'evt-past', name: 'Retro Night 2025', date: '2025-01-10T15:00:00.000Z', status: 'PUBLISHED' };
const CANCELLED = { id: 'evt-cancelled', name: 'Cancelled Con', date: '2027-03-10T15:00:00.000Z', status: 'CANCELLED' };
const DRAFT_EVENT = { id: 'evt-draft', name: 'Winter Con 2028', date: '2028-01-10T15:00:00.000Z', status: 'DRAFT' };

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const boothTemplate = {
  id: 'tpl-booths',
  organizationId: ORG_ID,
  name: 'Exhibitor booths',
  kind: 'PAID',
  definition: {
    intro: 'Sell your wares.',
    chargeTiming: 'APPROVAL',
    feeMode: 'ABSORB',
    taxable: true,
    paymentDueDays: 10,
    overduePolicy: 'HOLD',
    tiers: [
      { name: '10x10', description: null, price: 275, quantityTotal: 5, isActive: true },
      { name: 'Corner', description: 'Two open sides', price: 350, quantityTotal: 2, isActive: false },
    ],
    questions: [
      { label: 'What do you sell?', helpText: null, type: 'LONG_TEXT', required: true, options: [] },
      { label: 'Booth style', helpText: null, type: 'SINGLE_CHOICE', required: false, options: ['Table', 'Pipe & drape'] },
    ],
  },
  sourceFormId: 'form-vendor',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};
const pressTemplate = {
  id: 'tpl-press',
  organizationId: ORG_ID,
  name: 'Press pass',
  kind: 'FREE',
  definition: { intro: null, chargeTiming: null, feeMode: null, taxable: null, paymentDueDays: null, overduePolicy: null, tiers: [], questions: [{ label: 'Outlet name', helpText: null, type: 'SHORT_TEXT', required: true, options: [] }] },
  sourceFormId: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
};
const summary = (t: typeof boothTemplate | typeof pressTemplate) => ({ id: t.id, name: t.name, kind: t.kind, tierCount: t.definition.tiers.length, questionCount: t.definition.questions.length, sourceFormId: t.sourceFormId, createdAt: t.createdAt, updatedAt: t.updatedAt });

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
  createdFromTemplateId: null as string | null,
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
    templates: (typeof boothTemplate | typeof pressTemplate)[];
    form: Omit<typeof vendorForm, 'tiers' | 'questions'> & { tiers: Record<string, unknown>[]; questions: Record<string, unknown>[] };
    createdForms: { id: string; eventId: string; body: unknown }[];
  } = { templates: [{ ...boothTemplate }, { ...pressTemplate }], form: { ...vendorForm }, createdForms: [] as { id: string; eventId: string; body: unknown }[] };
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
    if (path === '/admin/application-templates' && method === 'GET') return route.fulfill(json({ data: state.templates.map(summary) }));
    if (path === '/admin/application-templates' && method === 'POST') {
      seq += 1;
      const b = body as { name: string; kind: 'PAID' | 'FREE' };
      const t = { ...pressTemplate, id: `tpl-new-${seq}`, name: b.name, kind: b.kind, definition: { ...pressTemplate.definition, questions: [] }, sourceFormId: null };
      state.templates.push(t);
      return route.fulfill(json(t, 201));
    }
    const tpl = path.match(/^\/admin\/application-templates\/([^/]+)$/);
    if (tpl) {
      const t = state.templates.find((x) => x.id === tpl[1]);
      if (!t) return route.fulfill(json({ error: 'NotFoundError', message: 'Application form template not found' }, 404));
      if (method === 'GET') return route.fulfill(json(t));
      if (method === 'PUT') {
        const b = body as { name?: string; definition?: typeof t.definition };
        if (b.name) t.name = b.name;
        if (b.definition) t.definition = b.definition;
        t.updatedAt = '2026-09-18T00:00:00.000Z';
        return route.fulfill(json(t));
      }
      if (method === 'DELETE') {
        state.templates = state.templates.filter((x) => x.id !== t.id);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    const create = path.match(/^\/admin\/events\/([^/]+)\/application-forms$/);
    if (create && method === 'POST') {
      seq += 1;
      const b = body as { name: string; kind: string; templateId?: string };
      const t = b.templateId ? state.templates.find((x) => x.id === b.templateId) : null;
      const form = {
        ...vendorForm,
        id: `form-new-${seq}`,
        eventId: create[1],
        name: b.name,
        kind: b.kind,
        slug: b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        createdFromTemplateId: t?.id ?? null,
        tiers: t ? t.definition.tiers.map((x, i) => ({ ...vendorForm.tiers[0], id: `nt${i}`, ...x })) : [],
        questions: t ? t.definition.questions.map((q, i) => ({ id: `nq${i}`, displayOrder: i, ...q })) : [],
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
    const saveAs = path.match(/^\/admin\/events\/([^/]+)\/application-forms\/([^/]+)\/save-as-template$/);
    if (saveAs && method === 'POST') {
      const b = body as { name?: string; replaceTemplateId?: string };
      const definition = { intro: state.form.intro, chargeTiming: state.form.chargeTiming, feeMode: state.form.feeMode, taxable: state.form.taxable, paymentDueDays: state.form.paymentDueDays, overduePolicy: state.form.overduePolicy, tiers: state.form.tiers.map((t) => ({ name: t.name, description: t.description, price: t.price, quantityTotal: t.quantityTotal, isActive: t.isActive })), questions: state.form.questions.map((q) => ({ label: q.label, helpText: q.helpText, type: q.type, required: q.required, options: q.options })) };
      if (b.replaceTemplateId) {
        const t = state.templates.find((x) => x.id === b.replaceTemplateId)!;
        t.definition = definition as typeof t.definition;
        t.sourceFormId = state.form.id;
        return route.fulfill(json(t));
      }
      if (state.templates.some((x) => x.name === b.name)) return route.fulfill(json({ error: 'ConflictError', message: 'A template with that name already exists' }, 409));
      seq += 1;
      const t = { ...boothTemplate, id: `tpl-saved-${seq}`, name: b.name!, kind: state.form.kind, definition: definition as typeof boothTemplate.definition, sourceFormId: state.form.id };
      state.templates.push(t);
      return route.fulfill(json(t, 201));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `Unmocked ${method} ${path}` }, 404));
  });
  return { state, calls };
}

test('Applications tab: templates listed; New application offers upcoming events and same-kind templates; creating from a template lands in the editor', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants/applications');
  const templates = page.getByTestId('participants-templates');
  await expect(templates).toContainText('Exhibitor booths');
  await expect(page.getByTestId('participants-template-tpl-booths')).toContainText('Paid · 2 options · 2 questions');
  await expect(page.getByTestId('participants-template-tpl-press')).toContainText('Free · 1 question');

  await page.getByTestId('participants-new-application').click();
  const dialog = page.getByRole('dialog', { name: 'New application' });
  await expect(dialog).toBeVisible();
  // Past and cancelled events are not offered; the draft one is.
  await expect(dialog.getByLabel('Event').locator('option')).toHaveText(['Choose an event…', 'Gaming Geek Expo 2027 · Sep 18, 2027', 'Winter Con 2028 · Jan 10, 2028']);
  // Free by default → only the free template.
  await expect(dialog.getByLabel('Start from template').locator('option')).toHaveText(['Blank', 'Press pass']);
  await dialog.getByLabel('Type').selectOption('PAID');
  await expect(dialog.getByLabel('Start from template').locator('option')).toHaveText(['Blank', 'Exhibitor booths']);

  await dialog.getByLabel('Event').selectOption(DRAFT_EVENT.id);
  await dialog.getByLabel('Name').fill('Winter vendors');
  await dialog.getByLabel('Start from template').selectOption('tpl-booths');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await page.waitForURL(/\/admin\/events\/evt-draft\/applications\/forms\/form-new-\d+/);
  const create = calls.find((c) => c.method === 'POST' && c.path === `/admin/events/${DRAFT_EVENT.id}/application-forms`);
  expect(create?.body).toEqual({ kind: 'PAID', name: 'Winter vendors', templateId: 'tpl-booths' });
  await expect(page.getByTestId('form-created-from')).toContainText('Created from the Exhibitor booths template');
  await expect(page.getByTestId('form-questions')).toContainText('Booth style');
  await expect(page.getByTestId('form-questions')).toContainText('Table / Pipe & drape');
  await expect(page.getByTestId('form-tiers')).toContainText('Corner');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('Save as template from the form editor: new template appears in the Templates section; replace overwrites', async ({ page, baseURL }) => {
  const { calls, state } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EXPO.id}/applications/forms/${vendorForm.id}`);
  await page.getByTestId('form-save-as-template').click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  await expect(dialog.getByLabel('Template name')).toHaveValue('Vendor Space');
  await dialog.getByLabel('Template name').fill('Exhibitor booths');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await dialog.getByLabel('Template name').fill('Vendor space 2028');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Saved as the "Vendor space 2028" template.');
  expect(calls.find((c) => c.path.endsWith('/save-as-template'))?.body).toEqual({ name: 'Exhibitor booths' });
  expect(state.templates.map((t) => t.name)).toContain('Vendor space 2028');

  // Replace an existing one of the same kind.
  await page.getByTestId('form-save-as-template').click();
  await dialog.getByRole('radio', { name: 'Replace an existing template' }).check();
  await expect(dialog.getByLabel('Template', { exact: true }).locator('option')).toHaveText(['Exhibitor booths', 'Vendor space 2028']);
  await dialog.getByLabel('Template', { exact: true }).selectOption('tpl-booths');
  await dialog.getByRole('button', { name: 'Replace template' }).click();
  await expect(page.getByRole('status')).toContainText('Template "Exhibitor booths" replaced.');
  expect(state.templates.find((t) => t.id === 'tpl-booths')?.definition.tiers).toHaveLength(1);

  await page.goto('/admin/participants/applications');
  await expect(page.getByTestId('participants-templates')).toContainText('Vendor space 2028');
});

test('template editor: edit settings, add a question, reorder, save; unsaved guard; ORGANIZER sees no write controls', async ({ page, baseURL }) => {
  const { calls, state } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants/templates/tpl-booths');
  await expect(page.getByTestId('template-subtitle')).toContainText('Paid template');
  await expect(page.getByTestId('template-save')).toBeDisabled();
  // Event-only settings are hidden on a template.
  await expect(page.getByLabel('URL slug')).toHaveCount(0);
  await expect(page.getByLabel('Status')).toHaveCount(0);
  await expect(page.getByTestId('form-tiers')).toContainText('10x10');
  await expect(page.getByTestId('form-tiers')).not.toContainText('Applicant pays');

  await page.getByLabel('Name').fill('Exhibitor booths v2');
  await page.getByLabel('Intro shown to applicants').fill('Sell all the wares.');
  await page.getByLabel('Fees').selectOption('PASS');
  await expect(page.getByTestId('template-save')).toBeEnabled();

  const add = page.getByTestId('question-add');
  await add.getByLabel('Question').fill('Years exhibiting');
  await add.getByLabel('Type').selectOption('NUMBER');
  await add.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByTestId('form-questions')).toContainText('Years exhibiting');
  await page.getByRole('button', { name: 'Move up' }).nth(2).click();
  await expect(page.getByTestId('form-questions').locator('li').nth(1)).toContainText('Years exhibiting');

  const tierAdd = page.getByTestId('tier-add');
  await tierAdd.getByLabel('New option').fill('Premium');
  await tierAdd.getByLabel('Price').fill('500');
  await tierAdd.getByLabel('Spots').fill('1');
  await tierAdd.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByTestId('form-tiers')).toContainText('Premium');
  // Nothing was PUT yet — the cards edit local state.
  expect(calls.some((c) => c.method === 'PUT')).toBe(false);

  await page.getByTestId('template-save').click();
  await expect(page.getByRole('status')).toContainText('Template saved.');
  const put = calls.find((c) => c.method === 'PUT' && c.path === '/admin/application-templates/tpl-booths')?.body as { name: string; definition: typeof boothTemplate.definition };
  expect(put.name).toBe('Exhibitor booths v2');
  expect(put.definition.intro).toBe('Sell all the wares.');
  expect(put.definition.feeMode).toBe('PASS');
  expect(put.definition.tiers.map((t) => [t.name, t.price, t.quantityTotal])).toEqual([['10x10', 275, 5], ['Corner', 350, 2], ['Premium', 500, 1]]);
  expect(put.definition.questions.map((q) => q.label)).toEqual(['What do you sell?', 'Years exhibiting', 'Booth style']);
  expect(put.definition.questions[1]).toMatchObject({ type: 'NUMBER', required: false });
  await expect(page.getByTestId('template-save')).toBeDisabled();
  expect(state.templates.find((t) => t.id === 'tpl-booths')?.name).toBe('Exhibitor booths v2');

  // Unsaved guard: a dirty page asks before unloading.
  await page.getByLabel('Name').fill('Dirty again');
  await expect(page.getByTestId('template-save')).toBeEnabled();
  page.once('dialog', (d) => d.dismiss());
  await page.evaluate(() => {
    window.location.href = '/admin/participants/applications';
  });
  await expect(page).toHaveURL(/\/admin\/participants\/templates\/tpl-booths/);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => {
    window.location.href = '/admin/participants/applications';
  });
  await expect(page).toHaveURL(/\/admin\/participants\/applications/);

  // ORGANIZER: read-only.
  await page.context().clearCookies();
  await mockAdmin(page, baseURL!, 'ORGANIZER');
  await page.goto('/admin/participants/applications');
  await expect(page.getByTestId('participants-templates')).toContainText('Exhibitor booths');
  await expect(page.getByTestId('participants-new-application')).toHaveCount(0);
  await expect(page.getByTestId('participants-new-template')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.goto('/admin/participants/templates/tpl-booths');
  await expect(page.getByTestId('template-save')).toHaveCount(0);
  await expect(page.getByLabel('Name')).toBeDisabled();
  await expect(page.getByTestId('question-add')).toHaveCount(0);
});

test('New template creates an empty one and opens the editor; Delete removes it after confirming', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants/applications');
  await page.getByTestId('participants-new-template').click();
  const dialog = page.getByRole('dialog', { name: 'New template' });
  await dialog.getByLabel('Name').fill('Panel proposals');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/admin\/participants\/templates\/tpl-new-\d+/);
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/application-templates')?.body).toEqual({ name: 'Panel proposals', kind: 'FREE' });
  await expect(page.getByTestId('template-subtitle')).toContainText('Free template');
  await expect(page.getByTestId('form-tiers')).toHaveCount(0);

  await page.goto('/admin/participants/applications');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('participants-template-tpl-press').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status')).toContainText('Template "Press pass" deleted.');
  await expect(page.getByTestId('participants-template-tpl-press')).toHaveCount(0);
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/admin/application-templates/tpl-press')).toBe(true);
});

test('form editor: pin a second question as a list column; the third toggle is disabled at the cap; unpin frees it', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EXPO.id}/applications/forms/${vendorForm.id}`);
  await expect(page.getByTestId('question-pinned-q1')).toHaveText('List column');
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
  await expect(page.getByTestId('qn-pinned')).toBeDisabled();

  // Unpin q1 → q3 can be pinned.
  const rowQ1 = page.getByTestId('question-row-q1');
  await rowQ1.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('qe-q1-pinned').uncheck();
  await rowQ1.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('question-pinned-q1')).toHaveCount(0);
  await expect(page.getByTestId('qn-pinned')).toBeEnabled();
});
