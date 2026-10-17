// Application setup flows (spec 051), since spec 057 the `registration` flow:
// a registration event's one form, step by step inside its event wizard
// (between Image and Collect more). A live event takes no new forms: its old
// flows send it back to the event, keeping only the special guest lineup.
// Runs as an ORGANIZER (050-E opened form configuration to them). Every API
// call is mocked by a small stateful fake, so a create, patch or delete changes
// what the next list returns. Assertions are scoped to the form pane (<main>):
// the preview frame repeats names.

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
  type: 'REGISTRATION', linkedEventId: null,
  admissionMode: 'TICKETED', setupStep: 'registration', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
  rsvpRemaining: null, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
  organizationId: ORG_ID, organizationName: 'Apps Org',
  venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: VENUE.timezone }, priceTiers: [],
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
    paymentsEnabled: true, applicationCount: 0, collectBusiness: false, collectName: false, tiers: [], addOns: [],
    // Like createForm: a new form starts blank (an email only).
    questions: [],
    ...patch,
  };
}

type Calls = { create: Request[]; patch: Request[]; remove: Request[]; questions: Request[] };

async function mockApi(page: Page, initialForms: Record<string, any>[] = [], event: Record<string, any> = EVENT) {
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
    route.fulfill(json({ event, applications: { forms: [] }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Apps Org' }, forms }))
  );
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
  for (const url of [flowUrl('registration', 'step=details&form=warm'), `/admin/events/${EVENT_ID}/setup?step=name`]) {
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

  test('a paid registration, step by step: who registers, details, spaces, fields, then the event wizard', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('registration'));
    await expect(heading(page, 'Who registers?')).toBeFocused(COLD);
    // One count for the event wizard and the flow: 6 event steps, then Start, Details, Fields, Collect more, Review.
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 7 of 11');
    await expect(main(page).getByLabel('Name')).toHaveValue('Spring Fair');
    // Generic: no type to pick, the name says who registers.
    await expect(main(page).getByLabel('What is this form for?')).toHaveCount(0);
    // A registration starts free; charging adds the options and payment steps.
    await expect(main(page).getByLabel('Charge applicants')).not.toBeChecked();
    await main(page).getByLabel('Charge applicants').check();
    await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
    await expect(page.getByRole('region', { name: 'Live preview of the application form' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Setup steps' })).toHaveCount(0);

    await next(page, 'Create form').click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toEqual({ name: 'Spring Fair', kind: 'PAID', purpose: 'OTHER', setup: true });
    await expect(page).toHaveURL(/\/setup\/registration\?step=details&form=form-/);
    await expect(heading(page, 'Form details')).toBeFocused();
    await expect(page.locator('[aria-live="polite"]')).toHaveText('Step 8 of 13, Form details');
    await expect(main(page).getByLabel('Intro shown to applicants')).toBeVisible();
    await expect(main(page).getByLabel('What is this form for?')).toHaveCount(0);
    await expect(main(page).getByLabel('Button label')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Save settings' })).toHaveCount(0);
    await main(page).getByLabel('Intro shown to applicants').fill('Tables and power included.');
    await next(page).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().intro)).toContain('Tables and power included.');

    await expect(heading(page, 'Options and pricing')).toBeFocused();
    await expect(main(page).getByTestId('form-tiers')).toBeVisible();
    await expect(formPreview(page).getByText('Add an option to see what vendors choose from.')).toBeVisible(COLD);
    await next(page).click();
    await expect(heading(page, 'How registrants choose and pay')).toBeFocused();
    await expect(main(page).getByTestId('form-reserve-on')).toBeChecked();
    // Not linked to a live event: no floor map to sell.
    await expect(main(page).getByTestId('form-space-map')).toHaveCount(0);
    await next(page).click();
    await expect(heading(page, 'Fields')).toBeFocused();
    const builtIns = main(page).getByTestId('form-builtin-fields');
    await expect(builtIns.getByText('Email')).toBeVisible();
    await expect(builtIns.getByText('Business name')).toHaveCount(0);
    // The add panel stays closed until asked for.
    await expect(main(page).getByTestId('question-add')).toHaveCount(0);
    await main(page).getByTestId('question-add-open').click();
    await main(page).getByTestId('builtin-add').getByRole('button', { name: '+ Business name' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ businessFields: ['businessName'] });
    await expect(main(page).getByTestId('builtin-businessName')).toBeVisible();
    await main(page).getByTestId('question-add-open').click();
    await main(page).getByTestId('builtin-add').getByRole('button', { name: '+ Website' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ businessFields: ['businessName', 'website'] });
    await main(page).getByRole('button', { name: 'Remove Website' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ businessFields: ['businessName'] });
    await expect(main(page).getByTestId('builtin-website')).toHaveCount(0);

    // The last flow step hands back to the event wizard; its Review publishes.
    await next(page).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${EVENT_ID}/setup\\?step=collect-more`), COLD);
    await expect(heading(page, 'Collect more')).toBeVisible(COLD);
  });

  test('the preview shows the form and follows what is typed; the device switch keeps it', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths', intro: 'Bring a table.' })]);
    await page.goto(flowUrl('registration', 'step=details&form=form-paid'));
    await expect(heading(page, 'Form details')).toBeVisible(COLD);
    const pane = page.getByRole('region', { name: 'Live preview of the application form' });
    const formFrame = page.frameLocator('iframe[title="Application form preview"]');
    await expect(formFrame.getByRole('heading', { level: 1, name: 'Vendor booths' })).toBeVisible(COLD);
    await expect(formFrame.getByText('Bring a table.')).toBeVisible();
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
  });

  test('a registration event has one form: the flow opens it instead of starting another', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-live', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths', status: 'CLOSED' })]);
    await page.goto(flowUrl('registration'));
    await expect(page).toHaveURL(/\/setup\/registration\?step=details&form=form-live/, COLD);
    await expect(heading(page, 'Form details')).toBeVisible();
    expect(calls.create).toHaveLength(0);
  });

  test('Start previews the form being set up: the name as it is typed, no business step', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('registration'));
    await expect(heading(page, 'Who registers?')).toBeVisible(COLD);
    await main(page).getByLabel('Name').fill('Crew sign-up');
    await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Crew sign-up' })).toBeVisible(COLD);
    await expect(formPreview(page).getByRole('heading', { name: /Your details/ })).toBeVisible();
    await expect(formPreview(page).getByRole('heading', { name: /Your business/ })).toHaveCount(0);
    await expect(formPreview(page).getByLabel('First name')).toHaveCount(0);
    await expect(formPreview(page).getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    await expect(formPreview(page).getByRole('button', { name: 'Submit application' })).toBeDisabled();
    expect(calls.create).toHaveLength(0);
  });

  test('Options and pricing: the preview is the registrant choosing a space; extras link to Collect more', async ({ page }) => {
    const tier = { id: 'tier-corner', name: 'Corner booth', description: 'Two sides open', price: 150, quantityTotal: 4, quantityApproved: 0, quantityReserved: 0, remaining: 4, displayOrder: 0, isActive: true, amounts: {}, addOns: [] };
    await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths', tiers: [tier] })]);
    await page.goto(flowUrl('registration', 'step=options&form=form-paid'));
    await expect(main(page).getByTestId('form-tiers').getByRole('link', { name: 'Collect more step' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=collect-more`, COLD);
    await expect(formPreview(page).getByTestId('choose-space')).toBeVisible(COLD);
    await expect(formPreview(page).getByText('Corner booth').first()).toBeVisible();
    await expect(formPreview(page).getByLabel('Email')).toHaveCount(0);
  });

  test('a free registration, then fields', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(flowUrl('registration'));
    await expect(heading(page, 'Who registers?')).toBeVisible(COLD);
    await main(page).getByLabel('Name').fill('Crew sign-up');
    await next(page, 'Create form').click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toMatchObject({ name: 'Crew sign-up', kind: 'FREE', purpose: 'OTHER' });
    await expect(heading(page, 'Form details')).toBeVisible();
    await next(page).click();
    await expect(heading(page, 'Fields')).toBeVisible();
    const questions = main(page).getByTestId('form-questions');
    await expect(questions.getByText('Email is always asked.', { exact: false })).toBeVisible();
    await expect(formPreview(page).getByLabel('First name')).toHaveCount(0);
    await main(page).getByTestId('question-add-open').click();
    await main(page).getByTestId('builtin-add').getByRole('button', { name: '+ Name' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ collectName: true });
    await main(page).getByRole('button', { name: 'Remove Name' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ collectName: false });
    await main(page).getByTestId('question-add-open').click();
    const add = main(page).getByTestId('question-add');
    await add.getByLabel('Question').fill('Years volunteering');
    await add.getByLabel('Type').selectOption('NUMBER');
    await add.getByRole('button', { name: 'Add field' }).click();
    await expect.poll(() => calls.questions.map((r) => r.postDataJSON())).toEqual([expect.objectContaining({ label: 'Years volunteering', type: 'NUMBER' })]);
    await expect(questions.getByText('Years volunteering')).toBeVisible();
  });

  test('old application links on a registration event open its registration flow', async ({ page }) => {
    await mockApi(page, [form({ id: 'form-sponsor', purpose: 'SPONSOR', name: 'Sponsors' })]);
    await page.goto(flowUrl('vendors', 'step=details&form=form-sponsor'));
    await expect(page).toHaveURL(/\/setup\/registration\?step=details&form=form-sponsor/, COLD);
    await expect(heading(page, 'Form details')).toBeVisible();
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=vendors&form=form-sponsor`);
    await expect(page).toHaveURL(/\/setup\/registration\?step=details&form=form-sponsor/, COLD);
  });

  test('a live event takes no new forms: its old flows go back to the event, special guests keep the lineup', async ({ page }) => {
    await mockApi(page, [], { ...EVENT, type: 'LIVE', setupStep: 'review' });
    await page.goto(flowUrl('vendors'));
    await expect(page).toHaveURL(new RegExp(`/admin/events/${EVENT_ID}$`), COLD);
    await page.goto(flowUrl('special-guests', 'step=lineup'));
    await expect(heading(page, 'Special guest lineup')).toBeVisible(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 1 of 1');
  });

  test('the event wizard counts the form flow in its slot', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=collect-more`);
    await expect(heading(page, 'Collect more')).toBeVisible(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 10 of 11');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings on the start and spaces steps (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await mockApi(page);
      await page.goto(flowUrl('registration'));
      await expect(heading(page, 'Who registers?')).toBeVisible(COLD);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(formPreview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
      await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths' })]);
      await page.goto(flowUrl('registration', 'step=options&form=form-paid'));
      await expect(main(page).getByTestId('form-tiers')).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
      await page.goto(flowUrl('registration', 'step=payment&form=form-paid'));
      await expect(main(page).getByTestId('form-reserve-on')).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
    });
  }
});

test.describe('mobile', () => {
  for (const width of [390, 320]) {
    test(`registration flow at ${width} px: 44 px targets, axe, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockApi(page);
      await page.goto(flowUrl('registration'));
      await expect(heading(page, 'Who registers?')).toBeVisible(COLD);
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
