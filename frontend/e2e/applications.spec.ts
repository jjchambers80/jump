// Applications (spec 011 phase 1): public apply flow, status page, admin
// list + detail + decision dialog, forms editor, templates settings.
// Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';
import { LEGAL_VERSIONS, mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const ORG_ID = 'org-apps';
const EVENT_ID = 'evt-apps';
const APP_ID = 'app-1';

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

const questions = [
  { id: 'q-outlet', label: 'Outlet name', helpText: null, type: 'SHORT_TEXT', required: true, options: [], displayOrder: 0 },
  { id: 'q-type', label: 'Coverage type', helpText: 'Pick the closest', type: 'SINGLE_CHOICE', required: true, options: ['Print', 'Video', 'Podcast'], displayOrder: 1 },
  { id: 'q-policy', label: 'Agree to media policy', helpText: null, type: 'CHECKBOX', required: true, options: [], displayOrder: 2 },
];

const publicPress = {
  id: 'form-press',
  kind: 'FREE',
  name: 'Press & Media',
  slug: 'press-media',
  intro: 'Tell us about your outlet.',
  acceptance: { open: true, reason: null },
  chargeTiming: null,
  feeMode: null,
  tiers: [],
  questions,
};
const publicVendor = {
  id: 'form-vendor',
  kind: 'PAID',
  name: 'Vendor Space',
  slug: 'vendor-space',
  intro: null,
  acceptance: { open: false, reason: 'not_yet_open', opensAt: '2027-01-15T00:00:00.000Z' },
  chargeTiming: 'APPROVAL',
  feeMode: 'PASS',
  tiers: [{ id: 't1', name: '10x10', description: null, price: 275, applicantPays: 303.3, feesIncluded: 28.3, tax: 0, soldOut: false }],
  questions: [],
};

const adminPress = {
  ...publicPress,
  eventId: EVENT_ID,
  status: 'OPEN',
  opensAt: null,
  closesAt: null,
  chargeTiming: 'APPROVAL',
  feeMode: 'PASS',
  taxable: false,
  paymentDueDays: 7,
  overduePolicy: 'WITHDRAW',
  displayOrder: 0,
  paymentsEnabled: false,
  applicationCount: 2,
};

const profile = { id: 'prof-1', businessName: 'Retro Weekly', description: 'Raleigh retro gaming news', website: 'https://retroweekly.example', socials: { instagram: '@retroweekly' }, photos: [] };
const amounts = { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' };

function adminApp(status = 'SUBMITTED', decisions: unknown[] = []) {
  return {
    id: APP_ID,
    form: { id: 'form-press', name: 'Press & Media', slug: 'press-media', kind: 'FREE', chargeTiming: 'APPROVAL', feeMode: 'PASS' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
    status,
    paymentStatus: 'NOT_REQUIRED',
    capacitySlot: 'NONE',
    contact: { id: 'c1', email: 'pat@retroweekly.example', firstName: 'Pat', lastName: 'Press', accountCreatedAt: null },
    profile,
    tier: null as null | Record<string, unknown>,
    amounts,
    payment: { stripePaymentIntentId: null, stripePaymentMethodId: null, stripeAccountId: null, applicationFee: null, chargeAttempts: 0, paidAt: null, paymentDueAt: null, overdue: false },
    answers: [
      { questionId: 'q-outlet', label: 'Outlet name', type: 'SHORT_TEXT', archived: false, value: 'Retro Weekly', image: null },
      { questionId: 'q-type', label: 'Coverage type', type: 'SINGLE_CHOICE', archived: false, value: 'Video', image: null },
      { questionId: 'q-policy', label: 'Agree to media policy', type: 'CHECKBOX', archived: false, value: 'true', image: null },
    ],
    decisions,
    refunds: [],
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: null,
    decidedById: null,
    withdrawnBy: null,
    withdrawReason: null,
    boothLabel: null,
    internalNote: null,
  };
}

const rows = [
  { id: APP_ID, formId: 'form-press', formName: 'Press & Media', formKind: 'FREE', status: 'SUBMITTED', paymentStatus: 'NOT_REQUIRED', businessName: 'Retro Weekly', contact: { email: 'pat@retroweekly.example', firstName: 'Pat', lastName: 'Press' }, tier: null, applicantPays: 0, submittedAt: '2026-09-16T14:00:00.000Z', decidedAt: null, paymentDueAt: null, overdue: false, boothLabel: null },
  { id: 'app-2', formId: 'form-press', formName: 'Press & Media', formKind: 'FREE', status: 'APPROVED', paymentStatus: 'NOT_REQUIRED', businessName: 'Pia Talks', contact: { email: 'pia@example.com', firstName: 'Pia', lastName: 'Panel' }, tier: null, applicantPays: 0, submittedAt: '2026-09-15T10:00:00.000Z', decidedAt: '2026-09-16T09:00:00.000Z', paymentDueAt: null, overdue: false, boothLabel: 'Media row 3' },
  { id: 'app-3', formId: 'form-vendor', formName: 'Vendor Space', formKind: 'PAID', status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', businessName: 'Pixel Pins', contact: { email: 'pins@example.com', firstName: 'Pix', lastName: 'Pins' }, tier: { id: 't1', name: '10x10' }, applicantPays: 303.3, submittedAt: '2026-09-16T12:00:00.000Z', decidedAt: null, paymentDueAt: null, overdue: false, boothLabel: null },
];

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockPublic(page: Page) {
  const calls: { method: string; path: string; payload?: unknown }[] = [];
  await mockLegalVersions(page, API);
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/events/${EVENT_ID}/applications/forms`, (route) => route.fulfill(json({ data: [publicPress, publicVendor] })));
  await page.route(`${API}/events/${EVENT_ID}/applications/forms/press-media`, (route) => route.fulfill(json(publicPress)));
  await page.route(`${API}/events/${EVENT_ID}/applications`, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const raw = req.postData() || '';
    const m = raw.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/);
    calls.push({ method: 'POST', path: '/applications', payload: m ? JSON.parse(m[1]) : null });
    return route.fulfill(json({ applicationId: APP_ID, statusUrl: `http://localhost:3001/events/${EVENT_ID}/apply/status/${APP_ID}?token=tok123`, next: 'done' }, 201));
  });
  await page.route(`${API}/applications/${APP_ID}/status**`, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('token') !== 'tok123') return route.fulfill(json({ error: 'NotFoundError', message: 'Application not found' }, 404));
    return route.fulfill(
      json({
        id: APP_ID,
        form: { id: 'form-press', name: 'Press & Media', kind: 'FREE' },
        event: { id: EVENT_ID, name: event.name, date: event.date },
        organization: { id: ORG_ID, name: 'Raleigh Retro Gamers' },
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        tier: null,
        amounts,
        paymentDueAt: null,
        profile,
        answers: adminApp().answers,
        boothLabel: null,
        submittedAt: '2026-09-16T14:00:00.000Z',
        decidedAt: null,
        canWithdraw: true,
      })
    );
  });
  return { calls };
}

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' = 'ADMIN') {
  await signInAsStaff(page, { id: `apps-${role.toLowerCase()}`, email: `apps-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));

  const state: {
    app: ReturnType<typeof adminApp> & Record<string, unknown>;
    forms: typeof adminPress[];
    templates: { action: string; subject: string; body: string; isDefault: boolean; updatedAt: string | null }[];
    digest: { enabled: boolean; lastRunAt: string | null };
  } = { app: adminApp(), forms: [adminPress], templates: [{ action: 'APPROVED', subject: 'You are approved for {{event.name}}', body: 'Hi {{applicant.firstName}},\n\nGood news.', isDefault: true, updatedAt: null }], digest: { enabled: true, lastRunAt: null as string | null } };
  const calls: { method: string; path: string; body?: unknown }[] = [];

  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body });

    if (path === `/admin/events/${EVENT_ID}/applications` && method === 'GET') {
      const status = url.searchParams.get('status');
      const q = url.searchParams.get('q')?.toLowerCase();
      const data = rows.filter((r) => (!status || r.status === status) && (!q || r.businessName.toLowerCase().includes(q)));
      return route.fulfill(json({ data, total: data.length, page: 1, pageSize: 50, summary: { SUBMITTED: 2, APPROVED: 1 } }));
    }
    if (path === `/admin/events/${EVENT_ID}/application-forms` && method === 'GET') return route.fulfill(json({ data: state.forms }));
    if (path === `/admin/events/${EVENT_ID}/application-forms` && method === 'POST') {
      const form = { ...adminPress, id: 'form-new', name: body.name, slug: 'panels', kind: body.kind, status: 'DRAFT', questions: [], tiers: [], applicationCount: 0 };
      state.forms = [...state.forms, form];
      return route.fulfill(json(form, 201));
    }
    if (path === `/admin/events/${EVENT_ID}/application-forms/form-press` && method === 'GET') return route.fulfill(json(state.forms[0]));
    if (path === `/admin/events/${EVENT_ID}/application-forms/form-press` && method === 'PATCH') {
      state.forms[0] = { ...state.forms[0], ...body, acceptance: body.status === 'CLOSED' ? { open: false, reason: 'closed' } : state.forms[0].acceptance };
      return route.fulfill(json(state.forms[0]));
    }
    if (path === `/admin/events/${EVENT_ID}/application-forms/form-press/questions` && method === 'POST') {
      const q = { id: `q-${Date.now()}`, helpText: null, options: [], displayOrder: state.forms[0].questions.length, ...body };
      state.forms[0] = { ...state.forms[0], questions: [...state.forms[0].questions, q] };
      return route.fulfill(json(q, 201));
    }
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}` && method === 'GET') return route.fulfill(json(state.app));
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}` && method === 'PATCH') {
      state.app = { ...state.app, ...body };
      return route.fulfill(json(state.app));
    }
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}/preview`) {
      return route.fulfill(json({ subject: `You are on the waitlist for ${event.name}`, body: 'Hi Pat,\n\nRetro Weekly is on the waitlist for Gaming Geek Expo 2027.' }));
    }
    if (path === `/admin/events/${EVENT_ID}/applications/${APP_ID}/decision`) {
      const to = { APPROVE: 'APPROVED', REJECT: 'REJECTED', WAITLIST: 'WAITLISTED', WITHDRAW: 'WITHDRAWN' }[body.decision as string];
      state.app = adminApp(to, [{ id: 'd1', action: to, byUserId: 'u1', note: body.note ?? null, emailSubject: body.message?.subject ?? 'Templated subject', emailBody: body.message?.body ?? 'Templated body', createdAt: '2026-09-16T15:00:00.000Z' }]);
      return route.fulfill(json(state.app));
    }
    if (path === '/admin/settings/application-templates' && method === 'GET') {
      return route.fulfill(json({ data: state.templates, mergeFields: [{ key: 'applicant.firstName', description: 'First name' }, { key: 'event.name', description: 'Event' }] }));
    }
    if (path === '/admin/settings/application-templates/APPROVED' && method === 'PUT') {
      state.templates = [{ action: 'APPROVED', ...body, isDefault: false, updatedAt: '2026-09-16T15:00:00.000Z' }];
      return route.fulfill(json(state.templates[0]));
    }
    if (path === '/admin/settings/application-digest' && method === 'GET') return route.fulfill(json(state.digest));
    if (path === '/admin/settings/application-digest' && method === 'PATCH') {
      state.digest = { ...state.digest, enabled: body.enabled };
      return route.fulfill(json(state.digest));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls, state };
}

// ─── Public ──────────────────────────────────────────────────────────────────

test('event page lists open forms; apply index shows availability', async ({ page }) => {
  await mockPublic(page);
  await page.goto(`/events/${EVENT_ID}`);
  const strip = page.getByTestId('get-involved');
  await expect(strip).toContainText('Press & Media');
  await expect(strip.getByRole('link', { name: /Press & Media/ })).toBeVisible();
  await strip.getByRole('link', { name: /Press & Media/ }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}/apply/press-media$`));

  await page.goto(`/events/${EVENT_ID}/apply`);
  await expect(page.getByTestId('apply-form-press-media')).toContainText('Free to apply');
  await expect(page.getByTestId('apply-form-vendor-space')).toContainText('$303.30');
  await expect(page.getByTestId('apply-form-vendor-space')).toContainText('Opens');
});

test('press applicant fills the form and lands on the status page', async ({ page }) => {
  const api = await mockPublic(page);
  await page.goto(`/events/${EVENT_ID}/apply/press-media`);
  await expect(page.getByRole('heading', { name: 'Press & Media' })).toBeVisible();
  await expect(page.getByText('Tell us about your outlet.')).toBeVisible();

  await page.getByLabel('First name').fill('Pat');
  await page.getByLabel('Last name').fill('Press');
  await page.getByLabel('Email', { exact: true }).fill('pat@retroweekly.example');
  await page.getByLabel('Business or outlet name').fill('Retro Weekly');
  await page.getByLabel('Website').fill('retroweekly.example');
  await page.getByLabel('Instagram').fill('@retroweekly');
  await page.getByLabel('Outlet name *').fill('Retro Weekly');
  await page.getByRole('radio', { name: 'Video' }).check();
  await page.getByRole('checkbox', { name: 'Agree to media policy' }).check();

  // Spec 024 phase 3: account (default on), marketing, and the required consent; no card authorization on a FREE form
  await expect(page.getByTestId('apply-opt-in-account')).toBeChecked();
  await page.getByTestId('apply-opt-in-marketing').check();
  await expect(page.getByTestId('apply-card-authorization')).toHaveCount(0);
  await expect(page.getByTestId('apply-privacy-link')).toHaveCount(0); // legal pages dark

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);

  // Consent is required before anything is sent
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('Please agree to the collection')).toBeVisible();
  expect(api.calls.find((c) => c.method === 'POST')).toBeUndefined();
  await page.getByTestId('apply-consent').check();

  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}/apply/status/${APP_ID}\\?token=tok123$`));
  const payload = api.calls.find((c) => c.method === 'POST')?.payload as Record<string, unknown>;
  expect(payload).toMatchObject({
    formSlug: 'press-media',
    contact: { email: 'pat@retroweekly.example', firstName: 'Pat', lastName: 'Press' },
    profile: { businessName: 'Retro Weekly', website: 'retroweekly.example', socials: { instagram: '@retroweekly' } },
    answers: { 'q-outlet': 'Retro Weekly', 'q-type': 'Video', 'q-policy': true },
    optInAccount: true,
    optInMarketing: true,
    acceptances: [
      { document: 'TERMS', version: LEGAL_VERSIONS.terms },
      { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
    ],
  });

  await expect(page.getByTestId('apply-status-pill')).toHaveText('Submitted');
  await expect(page.getByTestId('apply-status')).toContainText('We have your application');
  await expect(page.getByTestId('apply-status')).toContainText('Retro Weekly');
  await expect(page.getByRole('link', { name: 'Sign in to your account' })).toHaveAttribute('href', `/organizations/${ORG_ID}/account`);
});

test('status page refuses a bad token', async ({ page }) => {
  await mockPublic(page);
  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=bad`);
  await expect(page.getByTestId('apply-status-error')).toContainText('Application not found');
});

// ─── Admin ───────────────────────────────────────────────────────────────────

test('admin list: summary, status filter, search, bulk bar', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(page.getByTestId('applications-summary')).toContainText('All 3');
  await expect(page.getByTestId('applications-table')).toContainText('Retro Weekly');
  await expect(page.getByTestId('applications-table')).toContainText('Pia Talks');

  await page.getByRole('button', { name: /^Approved/ }).click();
  await expect(page).toHaveURL(/status=APPROVED/);
  await expect(page.getByTestId('applications-table')).not.toContainText('Retro Weekly');
  await expect(page.getByTestId('applications-table')).toContainText('Media row 3');

  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByRole('textbox', { name: 'Search' }).fill('retro');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=retro/);
  await expect(page.getByTestId('applications-table')).not.toContainText('Pia Talks');

  await page.getByRole('checkbox', { name: 'Select Retro Weekly' }).check();
  await expect(page.getByTestId('applications-bulk-bar')).toContainText('1 selected');
});

test('admin detail: answers, notes, waitlist with edited email and history', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!, 'ORGANIZER');
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  await expect(page.getByTestId('application-status')).toHaveText('Submitted');
  await expect(page.getByTestId('application-profile')).toContainText('pat@retroweekly.example');
  await expect(page.getByTestId('application-answers')).toContainText('Coverage type');
  await expect(page.getByTestId('application-answers')).toContainText('Yes');
  await expect(page.getByTestId('application-payment-card')).toHaveCount(0);

  await page.getByLabel('Booth / placement').fill('Media row 1');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByRole('status')).toContainText('Notes saved');
  expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ boothLabel: 'Media row 1', internalNote: null });

  await page.getByRole('button', { name: 'Waitlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to waitlist' });
  await expect(dialog.getByLabel('Subject')).toHaveValue(`You are on the waitlist for ${event.name}`);
  await expect(dialog.getByLabel('Message')).toContainText('Retro Weekly is on the waitlist');
  await dialog.getByLabel('Internal note (optional)').fill('Second batch');
  await dialog.getByLabel('Message').fill('Custom waitlist note for Pat.');
  await expect(dialog).toContainText('Edited for this applicant only');
  await dialog.getByRole('button', { name: 'Waitlist' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('application-status')).toHaveText('Waitlisted');
  const decision = api.calls.find((c) => c.path.endsWith('/decision'))?.body as Record<string, unknown>;
  expect(decision).toMatchObject({ decision: 'WAITLIST', note: 'Second batch', sendEmail: true, message: { subject: `You are on the waitlist for ${event.name}`, body: 'Custom waitlist note for Pat.' } });
  await expect(page.getByTestId('application-history')).toContainText('Waitlisted');
  await expect(page.getByTestId('application-history')).toContainText('Second batch');
  // From WAITLISTED the actions are Approve / Reject / Withdraw
  await expect(page.getByTestId('application-actions')).toContainText('Approve');
  await expect(page.getByTestId('application-actions')).not.toContainText('Waitlist');
});

test('forms: create a free form, edit settings, add a question; ORGANIZER is read-only', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications/forms`);
  await expect(page.getByTestId('form-row-press-media')).toContainText('Open');
  await expect(page.getByTestId('form-row-press-media')).toContainText('3 questions');

  await page.getByTestId('forms-new').click();
  await page.getByLabel('Name').fill('Panels');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/forms/form-new$`));
  expect(api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/application-forms'))?.body).toEqual({ kind: 'FREE', name: 'Panels' });

  await page.goto(`/admin/events/${EVENT_ID}/applications/forms/form-press`);
  await expect(page.getByTestId('form-settings')).toBeVisible();
  await expect(page.getByTestId('form-tiers')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('CLOSED');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Form settings saved');
  expect(api.calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/form-press'))?.body).toMatchObject({ status: 'CLOSED', name: 'Press & Media', slug: 'press-media' });

  const add = page.getByTestId('question-add');
  await add.getByLabel('Question').fill('Years covering games');
  await add.getByLabel('Type').selectOption('NUMBER');
  await add.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByRole('status')).toContainText('Question added');
  await expect(page.getByTestId('form-questions')).toContainText('Years covering games');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('ORGANIZER sees forms read-only', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!, 'ORGANIZER');
  await page.goto(`/admin/events/${EVENT_ID}/applications/forms`);
  await expect(page.getByTestId('forms-new')).toHaveCount(0);
  await page.goto(`/admin/events/${EVENT_ID}/applications/forms/form-press`);
  await expect(page.getByLabel('Status')).toBeDisabled();
  await expect(page.getByTestId('question-add')).toHaveCount(0);
});

test('settings: application email templates edit and save', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!);
  await page.goto('/admin/settings/applications');
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Applications' })).toHaveAttribute('aria-current', 'page');
  const card = page.getByTestId('template-APPROVED');
  await expect(card).toContainText('Default');
  const save = card.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await card.getByLabel('Subject').fill('Approved: {{event.name}}');
  await save.click();
  await expect(page.getByRole('status')).toContainText('Approved template saved');
  await expect(card).toContainText('Customised');
  expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ subject: 'Approved: {{event.name}}', body: 'Hi {{applicant.firstName}},\n\nGood news.' });
});

// ─── Phase 3 ─────────────────────────────────────────────────────────────────

test('admin list: saved views round-trip through localStorage; bulk approve blocked with a PAID row selected', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  await expect(page.getByTestId('applications-table')).toContainText('Pixel Pins');
  await expect(page.getByTestId('applications-save-view')).toHaveCount(0);

  await page.getByRole('button', { name: /^Submitted/ }).click();
  await expect(page).toHaveURL(/status=SUBMITTED/);
  page.once('dialog', (d) => d.accept('Needs review'));
  await page.getByTestId('applications-save-view').click();
  await expect(page.getByTestId('applications-saved-views')).toHaveValue('Needs review');
  await expect(page.getByRole('button', { name: 'Delete view' })).toBeVisible();

  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByTestId('applications-saved-views').selectOption('Needs review');
  await expect(page).toHaveURL(/status=SUBMITTED/);
  await expect(page.getByTestId('applications-table')).not.toContainText('Pia Talks');
  expect(JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k) || '[]', `jump.applications.views.${EVENT_ID}`))).toEqual([{ name: 'Needs review', query: { status: 'SUBMITTED' } }]);

  await page.getByRole('checkbox', { name: 'Select Pixel Pins' }).check();
  const bar = page.getByTestId('applications-bulk-bar');
  await expect(bar).toContainText('1 selected');
  await expect(bar.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: 'Waitlist' })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Select Pixel Pins' }).uncheck();
  await page.getByRole('checkbox', { name: 'Select Retro Weekly' }).check();
  await expect(bar.getByRole('button', { name: 'Approve' })).toBeEnabled();
});

test('admin detail shows the price-changed note for a PAID application', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!);
  api.state.app = {
    ...adminApp(),
    form: { id: 'form-vendor', name: 'Vendor Space', slug: 'vendor-space', kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'PASS' },
    paymentStatus: 'CARD_ON_FILE',
    tier: { id: 't1', name: '10x10', price: 300 } as null | { id: string; name: string; price: number },
    amounts: { ...amounts, subtotal: 275, platformFee: 13.75, processingFee: 14.55, applicantPays: 303.3, orgReceives: 275 },
    pricing: { currentApplicantPays: 330.55, currentOrgReceives: 300, changed: true },
  };
  await page.goto(`/admin/events/${EVENT_ID}/applications/${APP_ID}`);
  const note = page.getByTestId('application-price-changed');
  await expect(note).toContainText('Price changed since submission');
  await expect(note).toContainText('$330.55');
  await expect(note).toContainText('keeps the $303.30');
});

test('settings: daily digest toggle', async ({ page, baseURL }) => {
  const api = await mockAdmin(page, baseURL!);
  await page.goto('/admin/settings/applications');
  const card = page.getByTestId('application-digest');
  await expect(card).toContainText('Daily digest');
  const toggle = card.getByRole('checkbox');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByRole('status')).toContainText('Daily digest off');
  expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/admin/settings/application-digest')?.body).toEqual({ enabled: false });
  await expect(card).toContainText('Off');
});

test('admin events: duplicate dialog creates a draft copy with forms', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!);
  const listed = { ...event, priceTiers: [] };
  const calls: unknown[] = [];
  await page.route(`${API}/organizations/${ORG_ID}/events**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET' && path === `/organizations/${ORG_ID}/events/summary`) {
      return route.fulfill(
        json({
          counts: { all: 1, DRAFT: 1, PUBLISHED: 0, CANCELLED: 0 },
          published: { count: 0, capacity: 0 },
          drafts: { count: 1 },
          registered: { tickets: 0, rsvps: 0 },
          inventory: { available: 0, tiers: 0 },
          categories: [],
        })
      );
    }
    if (req.method() === 'GET') return route.fulfill(json({ events: [listed], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }));
    if (path === `/organizations/${ORG_ID}/events/${EVENT_ID}/duplicate` && req.method() === 'POST') {
      calls.push(req.postDataJSON());
      return route.fulfill(json({ ...listed, id: 'evt-copy', name: 'Gaming Geek Expo 2028', status: 'DRAFT', copiedForms: 2 }, 201));
    }
    return route.fallback();
  });
  await page.goto('/admin/events');
  await page.getByRole('button', { name: `More actions for ${listed.name}` }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  const dialog = page.getByTestId('duplicate-event-dialog');
  await expect(dialog.getByLabel('Name')).toHaveValue('Copy of Gaming Geek Expo 2027');
  await dialog.getByLabel('Name').fill('Gaming Geek Expo 2028');
  await dialog.getByLabel('Date and time').fill('2028-09-16T10:00');
  await dialog.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('status').first()).toContainText('Created draft "Gaming Geek Expo 2028" with 2 application forms');
  expect(calls[0]).toMatchObject({ name: 'Gaming Geek Expo 2028' });
  expect((calls[0] as { date: string }).date).toMatch(/^2028-09-16T/);
});

