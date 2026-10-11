// Event setup wizard application steps (spec 050-L): Vendor applications,
// Special guests, Volunteers, Other applications. Runs as an
// ORGANIZER (050-E opened form
// configuration to them). Every API call is mocked by a small stateful fake,
// so a create, patch or delete changes what the next list returns. Assertions
// are scoped to the form pane (<main>): the preview frame repeats names.

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

type Calls = { create: Request[]; patch: Request[]; remove: Request[] };

async function mockApi(page: Page, initialForms: Record<string, any>[] = []) {
  let forms = structuredClone(initialForms);
  const calls: Calls = { create: [], patch: [], remove: [] };
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
  await page.route(list, (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json({ data: forms }));
    calls.create.push(route.request());
    const created = form(route.request().postDataJSON());
    forms.push(created);
    return route.fulfill(json(created, 201));
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
const setupUrl = (query: string) => `/admin/events/${EVENT_ID}/setup?${query}`;

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const preview = (page: Page) => page.frameLocator('iframe[title="Event page preview"]');
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

// Compile the wizard route and the preview frame once, before any timed step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page, [form({ purpose: 'VENDOR', kind: 'PAID', name: 'Warm-up' })]);
  for (const step of ['vendors', 'volunteers', 'other-applications']) {
    await page.goto(setupUrl(`step=${step}`), { timeout: 120000 });
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

  test('two vendor forms: paid from Jump defaults, then a free one; the dialog traps and returns focus', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=vendors'));
    await expect(heading(page, 'Vendor applications')).toBeVisible(COLD);
    await expect(main(page).getByText(/Vendors apply here for a space/)).toBeVisible();

    const add = main(page).getByRole('button', { name: 'Add a vendor application' });
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Add a vendor application' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await expect(dialog.getByLabel('Name')).toHaveValue('Spring Fair Vendor Application');
    await expect(dialog.getByLabel('Charge for space')).toBeChecked();
    // Purpose-matched templates only (the PAID vendor one).
    await expect(dialog.getByText('Makers market')).toBeVisible();
    await expect(dialog.getByText('Old free form')).toHaveCount(0);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();

    await add.click();
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toEqual({ name: 'Spring Fair Vendor Application', kind: 'PAID', purpose: 'VENDOR' });
    // The new form opens inline, deep-linked, with focus on its heading and a notice.
    await expect(page).toHaveURL(/form=form-/);
    await expect(main(page).getByRole('heading', { level: 3, name: 'Spring Fair Vendor Application' })).toBeFocused();
    await expect(main(page).getByRole('status').filter({ hasText: 'Spring Fair Vendor Application created.' })).toBeVisible();
    await expect(main(page).getByTestId('form-settings')).toBeVisible();
    await expect(main(page).getByText('What do you sell?')).toBeVisible();

    await main(page).getByRole('button', { name: 'Add a vendor application' }).click();
    await dialog.getByLabel('Name').fill('Food trucks');
    await dialog.getByLabel('Charge for space').uncheck();
    // A FREE vendor form falls back to same-kind templates saved before purposes existed.
    await expect(dialog.getByText('Old free form')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect.poll(() => calls.create.length).toBe(2);
    expect(calls.create[1].postDataJSON()).toEqual({ name: 'Food trucks', kind: 'FREE', purpose: 'VENDOR' });
    await expect(main(page).getByRole('heading', { level: 3, name: 'Food trucks' })).toBeVisible();
    await expect(main(page).getByRole('heading', { level: 3, name: 'Spring Fair Vendor Application' })).toBeVisible();
    await expect(preview(page).getByText('Food trucks').first()).toBeAttached(COLD);
  });

  test('a vendor form switched from TIERS to MAP adds the Floor map step', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths' })]);
    await page.goto(setupUrl('step=vendors&form=form-paid'));
    await expect(heading(page, 'Vendor applications')).toBeVisible(COLD);
    const steps = page.getByRole('list', { name: 'Setup steps' });
    await expect(steps).toBeVisible();
    await expect(steps.getByText('Floor map')).toHaveCount(0);
    const settings = main(page).getByTestId('form-settings');
    await expect(settings.getByTestId('form-space-tiers')).toBeChecked();
    await settings.getByTestId('form-space-map').check();
    // Inside the wizard the cards link to its own steps, not the old event pages.
    await expect(settings.getByRole('link', { name: 'Go to the Floor map step' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=floor-map`);
    await expect(main(page).getByTestId('form-tiers').getByRole('link', { name: 'Collect more step' })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=collect-more`);
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().spaceSelection)).toContain('MAP');
    await expect(steps.getByText('Floor map')).toBeVisible();
  });

  test('a volunteer form is always free and skips the business step', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=volunteers'));
    await expect(heading(page, 'Volunteers')).toBeVisible(COLD);
    await main(page).getByRole('button', { name: 'Add a volunteer application' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a volunteer application' });
    await expect(dialog.getByText('Volunteer applications are always free: volunteers give their time.')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /Charge/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toMatchObject({ kind: 'FREE', purpose: 'VOLUNTEER' });
    const questions = main(page).getByTestId('form-questions');
    await expect(questions.getByText('Name and email are always asked.')).toBeVisible();
    await expect(questions.getByText('Emergency contact (name and phone)')).toBeVisible();
    // FREE forms have no tiers card.
    await expect(main(page).getByText('Tiers', { exact: true })).toHaveCount(0);
  });

  test('other applications: a purpose per form, fixed once it has applications; delete or close', async ({ page }) => {
    const calls = await mockApi(page, [form({ id: 'form-sold', purpose: 'SPONSOR', name: 'Sponsors', applicationCount: 2, purposeLocked: true, status: 'OPEN' })]);
    await page.goto(setupUrl('step=other-applications'));
    await expect(heading(page, 'Other applications')).toBeVisible(COLD);
    const sponsors = main(page).getByTestId('setup-form-form-sold');
    await expect(sponsors.locator('p > span').getByText('Sponsor', { exact: true })).toBeVisible();
    await expect(sponsors.getByRole('button', { name: 'Delete Sponsors' })).toHaveCount(0);
    await sponsors.getByRole('button', { name: 'Close Sponsors' }).click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ status: 'CLOSED' });
    await expect(sponsors.getByText(/It is closed to new ones\./)).toBeVisible();
    await expect(sponsors.getByRole('button', { name: 'Close Sponsors' })).toHaveCount(0);
    await sponsors.getByRole('button', { name: 'Edit Sponsors' }).click();
    await expect(main(page).getByLabel('What is this form for?')).toBeDisabled();
    await expect(main(page).getByText('Fixed: this form already has applications.')).toBeVisible();

    await main(page).getByRole('button', { name: 'Add an application' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an application' });
    await dialog.getByLabel('What is this form for?').selectOption('PRESS');
    await dialog.getByLabel('Name').fill('Press passes');
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect.poll(() => calls.create.length).toBe(1);
    expect(calls.create[0].postDataJSON()).toEqual({ name: 'Press passes', kind: 'FREE', purpose: 'PRESS' });
    const press = main(page).getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Press passes' }) });
    const chip = (name: string) => press.locator('p > span').getByText(name, { exact: true });
    await expect(chip('Press')).toBeVisible();
    await main(page).getByLabel('What is this form for?').selectOption('PANEL');
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON())).toContainEqual({ purpose: 'PANEL' });
    await expect(chip('Panel')).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await press.getByRole('button', { name: 'Delete Press passes' }).click();
    await expect(main(page).getByRole('heading', { name: 'Press passes' })).toHaveCount(0);
    await expect.poll(() => calls.remove.length).toBe(1);
    await expect(main(page).getByRole('heading', { level: 2, name: '1 form on this step' })).toBeFocused();
    await expect(main(page).getByRole('status').filter({ hasText: 'Press passes deleted.' })).toBeVisible();
  });

  test('a form deep link on the wrong step moves to the step of its purpose', async ({ page }) => {
    await mockApi(page, [form({ id: 'form-sponsor', purpose: 'SPONSOR', name: 'Sponsors' })]);
    await page.goto(setupUrl('step=vendors&form=form-sponsor'));
    await expect(page).toHaveURL(/step=other-applications&form=form-sponsor/, COLD);
    await expect(heading(page, 'Other applications')).toBeVisible();
    await expect(main(page).getByTestId('form-settings')).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings on the vendors step, editor and dialog (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await mockApi(page, [form({ id: 'form-paid', purpose: 'VENDOR', kind: 'PAID', name: 'Vendor booths' })]);
      await page.goto(setupUrl('step=vendors&form=form-paid'));
      await expect(heading(page, 'Vendor applications')).toBeVisible(COLD);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(main(page).getByTestId('form-settings')).toBeVisible();
      await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
      await main(page).getByRole('button', { name: 'Add a vendor application' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  }
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('vendors step at 390 × 844: empty state, dialog, axe, 44 px targets, no horizontal scroll', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page);
    await page.goto(setupUrl('step=vendors'));
    await expect(heading(page, 'Vendor applications')).toBeVisible(COLD);
    const add = main(page).getByRole('button', { name: 'Add a vendor application' });
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await serious(page)).toEqual([]);
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Add a vendor application' });
    await expect(dialog).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Create form' }).click();
    await expect(main(page).getByTestId('form-settings')).toBeVisible();
    const toggle = main(page).getByRole('button', { name: /^Hide / });
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => [document.documentElement, document.querySelector('main')].filter((el) => !!el && el.scrollWidth > el.clientWidth).length);
    expect(overflow).toBe(0);
    expect(await serious(page)).toEqual([]);
  });
});
