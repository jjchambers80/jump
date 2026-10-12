// Application setup flows (spec 051): one vendor, special guest, volunteer or
// other application form per run, step by step in the wizard shell, out of
// the event wizard. Runs as an ORGANIZER (050-E opened form configuration to
// them). Every API call is mocked by a small stateful fake, so a create, patch
// or delete changes what the next list returns. Assertions are scoped to the
// form pane (<main>): the preview frame repeats names.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-apps';
const EVENT_ID = 'evt-apps';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const VENUE = { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' };

const EVENT = {
  id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: null, logoUrl: null,
  date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 100, category: null, status: 'DRAFT',
  admissionMode: 'TICKETED', setupStep: 'vendors', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
  rsvpRemaining: null, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
  organizationId: ORG_ID, organizationName: 'Apps Org',
  venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: VENUE.timezone }, priceTiers: [],
};

/** Mirrors backend applicationFormDefaults.js closely enough for the UI. */
const DEFAULT_QUESTIONS: Record<string, string[]> = {
  VENDOR: ['What do you sell?', 'Do you need power?', 'How many tables do you need?'],
  VOLUNTEER: ['Which days are you available?', 'Which roles interest you?', 'T-shirt size', 'Emergency contact (name and phone)'],
};

let seq = 0;
function form(patch: Record<string, any> = {}) {
  const id = patch.id ?? `form-${++seq}`;
  const purpose = patch.purpose ?? 'OTHER';
  const paid = patch.kind === 'PAID';
  return {
    id, eventId: EVENT_ID, kind: 'FREE', purpose, name: 'Form', slug: id, intro: null, status: 'DRAFT', opensAt: null, closesAt: null,
    chargeTiming: 'APPROVAL', feeMode: 'PASS', taxable: false, paymentDueDays: 7, overduePolicy: 'WITHDRAW', reserveOnApproval: true,
    spaceSelection: paid ? 'TIERS' : null, displayOrder: 0, createdFromTemplateId: null, acceptance: { accepting: true, reason: null },
    paymentsEnabled: true, applicationCount: 0, collectBusiness: purpose !== 'VOLUNTEER', tiers: [], addOns: [],
    questions: (DEFAULT_QUESTIONS[purpose] ?? []).map((label, i) => ({ id: `${id}-q${i}`, label, helpText: null, type: 'SHORT_TEXT', required: false, options: [], displayOrder: i, pinned: false })),
    ...patch,
  };
}

const TEMPLATES = [
  { id: 'tpl-market', name: 'Makers market', kind: 'PAID', purpose: 'VENDOR', tierCount: 2, questionCount: 3, sourceFormId: null, createdAt: '2031-01-01T00:00:00Z', updatedAt: '2031-01-01T00:00:00Z' },
  { id: 'tpl-old', name: 'Old free form', kind: 'FREE', purpose: null, tierCount: 0, questionCount: 1, sourceFormId: null, createdAt: '2031-01-01T00:00:00Z', updatedAt: '2031-01-01T00:00:00Z' },
];

type Calls = { create: Request[]; patch: Request[]; remove: Request[]; questions: Request[] };

async function mockApi(page: Page, initialForms: Record<string, any>[] = []) {
  let forms = structuredClone(initialForms);
  const calls: Calls = { create: [], patch: [], remove: [], questions: [] };
  const list = `${API}/admin/events/${EVENT_ID}/application-forms`;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Apps Org', slug: 'apps-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  // ORGANIZER: the event features and form configuration (catalog `organizer: true`).
  await page.route(`${API}/admin/permissions`, (route) =>
    route.fulfill(json({ granted: ['dashboard', 'events', 'applications', 'applications.forms', 'addOns.manage', 'venues', 'maps'], hiddenPaths: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([VENUE])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event: EVENT, applications: { forms: [] }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event: EVENT, organization: { id: ORG_ID, name: 'Apps Org' }, forms }))
  );
  await page.route(`${API}/admin/application-templates`, (route) => route.fulfill(json({ data: TEMPLATES })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/guests`, (route) => route.fulfill(json({ data: [] })));
  await page.route(list, (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json({ data: forms }));
    calls.create.push(route.request());
    const created = form(route.request().postDataJSON());
    forms.push(created);
    return route.fulfill(json(created, 201));
  });
  await page.route(new RegExp(`${list}/[^/]+/questions$`), (route) => {
    const id = route.request().url().split('/').slice(-2)[0];
    const target = forms.find((f) => f.id === id)!;
    const body = route.request().postDataJSON();
    calls.questions.push(route.request());
    const q = { id: `${id}-q${target.questions.length}`, helpText: null, required: false, options: [], pinned: false, displayOrder: target.questions.length, ...body };
    target.questions.push(q);
    return route.fulfill(json(q, 201));
  });
  await page.route(new RegExp(`${list}/[^/]+$`), (route) => {
    const id = route.request().url().split('/').pop()!;
    if (route.request().method() === 'DELETE') {
      calls.remove.push(route.request());
      forms = forms.filter((f) => f.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    calls.patch.push(route.request());
    const target = forms.find((f) => f.id === id)!;
    Object.assign(target, route.request().postDataJSON());
    return route.fulfill(json(target));
  });
  return calls;
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const COLD = { timeout: 30000 };
test.describe.configure({ timeout: 90000 });
const STAFF = { id: 'apps-organizer', email: 'apps-organizer@test.com', role: 'ORGANIZER' as const };
const flowUrl = (flow: string, query = '') => `/admin/events/${EVENT_ID}/setup/${flow}${query ? `?${query}` : ''}`;

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const footer = (page: Page) => page.locator('footer');
const next = (page: Page, name: string | RegExp = 'Next') => footer(page).getByRole('button', { name });
const preview = (page: Page) => page.frameLocator('iframe[title="Event page preview"]');
const formPreview = (page: Page) => page.frameLocator('iframe[title="Application form preview"]');
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));
const noOverflow = (page: Page) =>
  page.evaluate(() => [document.documentElement, document.querySelector('main')].filter((el) => !!el && el.scrollWidth > el.clientWidth).length);

// Compile the flow route, the event wizard and the preview frame once, before any timed step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page, [form({ id: 'warm', purpose: 'VENDOR', kind: 'PAID', name: 'Warm-up' })]);
  for (const url of [flowUrl('vendors'), flowUrl('vendors', 'step=details&form=warm'), `/admin/events/${EVENT_ID}/setup?step=name`]) {
    await page.goto(url, { timeout: 120000 });
    await expect(page.locator('main h1')).toBeVisible({ timeout: 120000 });
  }
  await expect(preview(page).getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a paid vendor application, step by step: start, details, spaces, questions, review', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('vendors'));
    await expect(heading(page, 'Start a vendor application')).toBeFocused(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 1 of 5');
    await expect(main(page).getByLabel('Name')).toHaveValue('Spring Fair Vendor Application');
    await expect(main(page).getByLabel('Charge for space')).toBeChecked();
    // Before the form exists, the preview is already the application form, not the event page.
    await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Spring Fair Vendor Application' })).toBeVisible(COLD);
    await expect(page.getByRole('region', { name: 'Live preview of the application form' })).toBeVisible();
    // Purpose-matched templates only (the PAID vendor one).
    await expect(main(page).getByText('Makers market')).toBeVisible();
    await expect(main(page).getByText('Old free form')).toHaveCount(0);
    // No step menu or step labels: a progress bar, and Back / Next (spec 051).
    await expect(page.getByRole('button', { name: 'Setup steps' })).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 1 of 5');

    await next(page, 'Create form').click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toEqual({ name: 'Spring Fair Vendor Application', kind: 'PAID', purpose: 'VENDOR' });
    await expect(page).toHaveURL(/\/setup\/vendors\?step=details&form=form-/);
    await expect(heading(page, 'Form details')).toBeFocused();
    await expect(page.locator('[aria-live="polite"]')).toHaveText('Step 2 of 5, Form details');
    // The details part of the settings card only; the footer's Next saves it.
    await expect(main(page).getByLabel('Intro shown to applicants')).toBeVisible();
    await expect(main(page).getByTestId('form-space-tiers')).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Save settings' })).toHaveCount(0);
    await main(page).getByLabel('Intro shown to applicants').fill('Tables and power included.');
    await next(page).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().intro)).toContain('Tables and power included.');

    await expect(heading(page, 'Spaces and pricing')).toBeFocused();
    await expect(main(page).getByTestId('form-space-tiers')).toBeChecked();
    await expect(main(page).getByTestId('form-tiers')).toBeVisible();
    await next(page).click();
    await expect(heading(page, 'Questions')).toBeFocused();
    await expect(main(page).getByText('What do you sell?')).toBeVisible();
    await next(page).click();

    await expect(heading(page, 'Review and open')).toBeFocused();
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 5 of 5');
    const summary = main(page).getByRole('region', { name: 'Summary' });
    await expect(summary.getByText('3 questions')).toBeVisible();
    await expect(summary.getByRole('link', { name: 'Edit questions' })).toHaveAttribute('href', /step=questions&form=form-/);
    await main(page).getByLabel('Status').selectOption('OPEN');
    await next(page, 'Save and finish').click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().status)).toContain('OPEN');
    await expect(page).toHaveURL(new RegExp(`/admin/events/${EVENT_ID}(\\?saved=1)?$`));
  });

  test('the preview shows the application form and follows what is typed; the device switch keeps it', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths', intro: 'Bring a table.' })]);
    await page.goto(flowUrl('vendors', 'step=details&form=form-paid'));
    await expect(heading(page, 'Form details')).toBeVisible(COLD);
    const pane = page.getByRole('region', { name: 'Live preview of the application form' });
    const formFrame = page.frameLocator('iframe[title="Application form preview"]');
    await expect(formFrame.getByRole('heading', { level: 1, name: 'Vendor booths' })).toBeVisible(COLD);
    await expect(formFrame.getByText('Bring a table.')).toBeVisible();
    // Unsaved typing shows at once; nothing is sent until Next.
    await main(page).getByLabel('Name').fill('Makers market');
    await main(page).getByLabel('Intro shown to applicants').fill('Power at every booth.');
    await expect(formFrame.getByRole('heading', { level: 1, name: 'Makers market' })).toBeVisible();
    await expect(formFrame.getByText('Power at every booth.')).toBeVisible();
    expect(calls.patch).toHaveLength(0);
    await expect(formFrame.getByRole('button', { name: 'Submit application' })).toBeDisabled();
    // Phone and laptop frames share one iframe: switching does not reload it.
    await formFrame.locator('body').evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await pane.getByTitle('Desktop').click();
    await expect(pane.getByRole('radio', { name: 'Desktop' })).toBeChecked();
    await expect(pane.locator('iframe')).toHaveCSS('width', '1280px');
    expect(await formFrame.locator('body').evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
    await expect(formFrame.getByText('Power at every booth.')).toBeVisible();
    // Steps that do not shape the form keep the event page.
    await page.goto(flowUrl('special-guests', 'step=lineup'));
    await expect(page.getByRole('region', { name: 'Live preview of the event page' })).toBeVisible(COLD);
  });

  test('Start previews the form being set up: the name as it is typed, no business step for volunteers', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('volunteers'));
    await expect(heading(page, 'Start a volunteer application')).toBeVisible(COLD);
    await main(page).getByLabel('Name').fill('Crew sign-up');
    await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Crew sign-up' })).toBeVisible(COLD);
    await expect(formPreview(page).getByRole('heading', { name: /Your details/ })).toBeVisible();
    await expect(formPreview(page).getByRole('heading', { name: /Your business/ })).toHaveCount(0);
    await expect(formPreview(page).getByRole('button', { name: 'Submit application' })).toBeDisabled();
    expect(calls.create).toHaveLength(0);
  });

  test('switching a vendor form to MAP adds the Floor map step', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths' })]);
    await page.goto(flowUrl('vendors', 'step=payment&form=form-paid'));
    await expect(heading(page, 'Spaces and pricing')).toBeVisible(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 3 of 5');
    await main(page).getByTestId('form-space-map').check();
    await expect(main(page).getByRole('link', { name: 'Go to the Floor map step' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup/vendors?step=floor-map&form=form-paid`);
    await expect(main(page).getByTestId('form-tiers').getByRole('link', { name: 'Collect more step' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=collect-more`);
    await next(page).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().spaceSelection)).toContain('MAP');
    // The saved form decides the next step: the new Floor map step.
    await expect(heading(page, 'Floor map')).toBeFocused();
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 4 of 6');
  });

  test('a volunteer form is always free, then shifts and questions', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('volunteers'));
    await expect(heading(page, 'Start a volunteer application')).toBeVisible(COLD);
    await expect(main(page).getByText('Volunteer applications are always free: volunteers give their time.')).toBeVisible();
    await expect(main(page).getByRole('checkbox', { name: /Charge/ })).toHaveCount(0);
    await next(page, 'Create form').click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toMatchObject({ kind: 'FREE', purpose: 'VOLUNTEER' });
    await expect(heading(page, 'Form details')).toBeVisible();
    await next(page).click();
    await expect(heading(page, 'Shifts')).toBeVisible();
    await next(page).click();
    const questions = main(page).getByTestId('form-questions');
    await expect(questions.getByText('Name and email are always asked.')).toBeVisible();
    await expect(questions.getByText('Emergency contact (name and phone)')).toBeVisible();
    const add = main(page).getByTestId('question-add');
    await add.getByLabel('Question').fill('Years volunteering');
    await add.getByLabel('Type').selectOption('NUMBER');
    await add.getByRole('button', { name: 'Add question' }).click();
    await expect.poll(() => calls.questions.map((r) => r.postDataJSON())).toEqual([expect.objectContaining({ label: 'Years volunteering', type: 'NUMBER' })]);
    await expect(questions.getByText('Years volunteering')).toBeVisible();
  });

  test('other applications: purpose fixed once a form has applications; close, then delete a new one', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-sold', purpose: 'SPONSOR', name: 'Sponsors', applicationCount: 2, purposeLocked: true, status: 'OPEN' })]);
    await page.goto(flowUrl('other-applications', 'step=details&form=form-sold'));
    await expect(heading(page, 'Form details')).toBeVisible(COLD);
    await expect(main(page).getByLabel('What is this form for?')).toBeDisabled();
    await expect(main(page).getByText('Fixed: this form already has applications.')).toBeVisible();
    await page.goto(flowUrl('other-applications', 'step=review&form=form-sold'));
    await expect(main(page).getByRole('button', { name: /Delete form/ })).toHaveCount(0);
    await main(page).getByRole('button', { name: 'Close form' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ status: 'CLOSED' });
    await expect(main(page).getByText(/It is closed to new ones\./)).toBeVisible();

    // Start lists this event's forms of the type; a new one picks its purpose.
    await page.goto(flowUrl('other-applications'));
    await expect(main(page).getByRole('link', { name: /Sponsors/ })).toHaveAttribute('href', new RegExp(`/admin/events/${EVENT_ID}/setup/other-applications\\?step=details&form=form-sold`));
    await main(page).getByLabel('What is this form for?').selectOption('PRESS');
    await main(page).getByLabel('Name').fill('Press passes');
    await next(page, 'Create form').click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toEqual({ name: 'Press passes', kind: 'FREE', purpose: 'PRESS' });
    await expect(heading(page, 'Form details')).toBeVisible();
    await main(page).getByLabel('What is this form for?').selectOption('PANEL');
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ purpose: 'PANEL' });

    await page.goto(page.url().replace('step=details', 'step=review'));
    await expect(heading(page, 'Review and open')).toBeVisible(COLD);
    page.once('dialog', (d) => void d.accept());
    await main(page).getByRole('button', { name: 'Delete form' }).click();
    await expect.poll(() => calls.remove.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/admin/events/${EVENT_ID}(\\?saved=1)?$`));
  });

  test('a form opened in the wrong flow moves to the flow of its purpose; old wizard links follow', async ({ page }) => {
    await mockApi(page, [form({ id: 'form-sponsor', purpose: 'SPONSOR', name: 'Sponsors' })]);
    await page.goto(flowUrl('vendors', 'step=details&form=form-sponsor'));
    await expect(page).toHaveURL(/\/setup\/other-applications\?step=details&form=form-sponsor/, COLD);
    await expect(heading(page, 'Form details')).toBeVisible();
    // Spec 050 links (emails, bookmarks) to the event wizard's old application steps.
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=vendors&form=form-sponsor`);
    await expect(page).toHaveURL(/\/setup\/other-applications\?step=details&form=form-sponsor/, COLD);
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=volunteers`);
    await expect(page).toHaveURL(/\/setup\/volunteers(\?step=start)?$/, COLD);
    await expect(heading(page, 'Start a volunteer application')).toBeVisible();
  });

  test('the event wizard no longer has application steps', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=collect-more`);
    await expect(heading(page, 'Collect more')).toBeVisible(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 7 of 8');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings on the start and spaces steps (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths' })]);
      await page.goto(flowUrl('vendors'));
      await expect(heading(page, 'Start a vendor application')).toBeVisible(COLD);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Spring Fair Vendor Application' })).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
      await page.goto(flowUrl('vendors', 'step=payment&form=form-paid'));
      await expect(main(page).getByTestId('form-tiers')).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
      await page.goto(flowUrl('vendors', 'step=review&form=form-paid'));
      await expect(heading(page, 'Review and open')).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
    });
  }
});

test.describe('mobile', () => {
  for (const width of [390, 320]) {
    test(`vendor flow at ${width} px: 44 px targets, step sheet, axe, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockApi(page);
      await page.goto(flowUrl('vendors'));
      await expect(heading(page, 'Start a vendor application')).toBeVisible(COLD);
      const create = next(page, 'Create form');
      expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await noOverflow(page)).toBe(0);
      expect(await serious(page)).toEqual([]);
      await create.click();
      await expect(heading(page, 'Form details')).toBeVisible();
      expect((await footer(page).getByRole('button', { name: 'Back' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await noOverflow(page)).toBe(0);
      expect(await serious(page)).toEqual([]);
    });
  }
});
