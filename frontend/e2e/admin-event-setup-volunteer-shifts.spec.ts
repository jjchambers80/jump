// Volunteer shifts in the event setup wizard (spec 050 §6.4, card 050-S):
// the Volunteers step's shift editor — add, edit, delete, times in the venue
// zone, the soft outside-the-event warning, and the server's two 409s in
// words. Runs on the flag-on dev server (PLAYWRIGHT_WIZARD_BASE_URL) at
// 390 × 844 with reduced motion and axe. The API is a small stateful fake.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-shifts';
const EVENT_ID = 'evt-shifts';
const FORM_ID = 'form-crew';
const ZONE = 'America/New_York';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const VENUE = { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: ZONE, city: 'Raleigh', state: 'NC' };

// Sat Jun 1 2031, 4:00 PM – 10:00 PM EDT.
const EVENT = {
  id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: null, logoUrl: null,
  date: '2031-06-01T20:00:00.000Z', endDate: '2031-06-02T02:00:00.000Z', capacity: 100, category: null, status: 'DRAFT',
  admissionMode: 'TICKETED', setupStep: 'volunteers', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
  rsvpRemaining: null, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
  organizationId: ORG_ID, organizationName: 'Shifts Org',
  venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: ZONE }, priceTiers: [],
};

type Shift = { id: string; name: string; description: null; startsAt: string | null; endsAt: string | null; capacity: number | null; assigned: number; remaining: number | null; displayOrder: number };
const shift = (p: Partial<Shift> & { id: string; name: string }): Shift => ({ description: null, startsAt: null, endsAt: null, capacity: null, assigned: 0, remaining: null, displayOrder: 0, ...p });

function crewForm(shifts: Shift[]) {
  return {
    id: FORM_ID, eventId: EVENT_ID, kind: 'FREE', purpose: 'VOLUNTEER', name: 'Crew', slug: 'crew', intro: null, status: 'DRAFT', opensAt: null, closesAt: null,
    chargeTiming: 'APPROVAL', feeMode: 'PASS', taxable: false, paymentDueDays: 7, overduePolicy: 'WITHDRAW', reserveOnApproval: true,
    spaceSelection: null, displayOrder: 0, createdFromTemplateId: null, acceptance: { accepting: true, reason: null },
    paymentsEnabled: true, applicationCount: 0, collectBusiness: false, tiers: [], addOns: [], questions: [], shifts, timezone: ZONE,
  };
}

const GATE = shift({ id: 'sh-gate', name: 'Gate crew', startsAt: '2031-06-01T20:00:00.000Z', endsAt: '2031-06-02T00:00:00.000Z', capacity: 4, assigned: 3, remaining: 1 });
const RUNNER = shift({ id: 'sh-runner', name: 'Runner', displayOrder: 1 });

async function mockApi(page: Page, initial: Shift[] = [GATE, RUNNER]) {
  let shifts = structuredClone(initial);
  const calls: { create: Request[]; patch: Request[]; remove: Request[]; preview: number } = { create: [], patch: [], remove: [], preview: 0 };
  const base = `${API}/admin/events/${EVENT_ID}/application-forms`;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Shifts Org', slug: 'shifts-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) =>
    route.fulfill(json({ granted: ['dashboard', 'events', 'applications', 'applications.forms', 'addOns.manage', 'venues', 'maps'], hiddenPaths: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([VENUE])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event: EVENT, applications: { forms: [] }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) => {
    calls.preview++;
    return route.fulfill(json({ event: EVENT, organization: { id: ORG_ID, name: 'Shifts Org' }, forms: [crewForm(shifts)] }));
  });
  await page.route(`${API}/admin/application-templates`, (route) => route.fulfill(json({ data: [] })));
  await page.route(base, (route) => route.fulfill(json({ data: [crewForm(shifts)] })));
  await page.route(`${base}/${FORM_ID}/shifts`, (route) => {
    calls.create.push(route.request());
    const body = route.request().postDataJSON();
    const created = shift({ id: `sh-${shifts.length + 1}`, displayOrder: shifts.length, ...body, remaining: body.capacity ?? null });
    shifts.push(created);
    return route.fulfill(json(created, 201));
  });
  await page.route(new RegExp(`${base}/${FORM_ID}/shifts/[^/]+$`), (route) => {
    const id = route.request().url().split('/').pop()!;
    const target = shifts.find((s) => s.id === id)!;
    if (route.request().method() === 'DELETE') {
      calls.remove.push(route.request());
      if (target.assigned > 0)
        return route.fulfill(json({ error: 'ConflictError', message: 'Volunteers are assigned to this shift; move them off it first', code: 'SHIFT_HAS_ASSIGNED', details: { assigned: target.assigned } }, 409));
      shifts = shifts.filter((s) => s.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    calls.patch.push(route.request());
    const body = route.request().postDataJSON();
    if (body.capacity != null && body.capacity < target.assigned)
      return route.fulfill(json({ error: 'ConflictError', message: 'Capacity cannot be below', code: 'SHIFT_CAPACITY_BELOW_ASSIGNED', details: { assigned: target.assigned } }, 409));
    Object.assign(target, body, { remaining: body.capacity == null ? null : body.capacity - target.assigned });
    return route.fulfill(json(target));
  });
  return calls;
}

const WIZARD_URL = process.env.PLAYWRIGHT_WIZARD_BASE_URL;
test.skip(!WIZARD_URL, 'needs the flag-on dev server (PLAYWRIGHT_WIZARD_BASE_URL)');
test.use({ baseURL: WIZARD_URL, viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } });
const COLD = { timeout: 30000 };
test.describe.configure({ timeout: 90000 });
const STAFF = { id: 'shifts-organizer', email: 'shifts-organizer@test.com', role: 'ORGANIZER' as const };
const URL_ = `/admin/events/${EVENT_ID}/setup?step=volunteers&form=${FORM_ID}`;

const card = (page: Page) => page.locator('main').getByTestId('setup-shifts');
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

// Warm the wizard route and the preview frame before any timed step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  if (!WIZARD_URL) return;
  const page = await browser.newPage({ baseURL: WIZARD_URL, viewport: { width: 390, height: 844 } });
  await signInAsStaff(page, STAFF, WIZARD_URL);
  await mockApi(page);
  await page.goto(URL_, { timeout: 120000 });
  await expect(page.locator('main').getByTestId('setup-shifts')).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('lists shifts in the venue zone with the zone label; axe, 44 px targets, no horizontal scroll', async ({ page }) => {
  await mockApi(page);
  await page.goto(URL_);
  await expect(card(page)).toBeVisible(COLD);
  await expect(card(page)).toContainText('Times are in the venue');
  await expect(card(page).getByTestId('setup-shift-sh-gate')).toContainText('4:00 PM EDT – 8:00 PM EDT');
  await expect(card(page).getByTestId('setup-shift-sh-gate')).toContainText('3 of 4 assigned');
  await expect(card(page).getByTestId('setup-shift-sh-runner')).toContainText('No set time');
  await expect(card(page).getByTestId('setup-shift-sh-runner')).toContainText('No limit');
  for (const name of ['Edit Gate crew', 'Delete Gate crew', 'Add a shift']) {
    const box = (await card(page).getByRole('button', { name }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector('main')].filter((el) => !!el && el.scrollWidth > el.clientWidth).length);
  expect(overflow).toBe(0);
  expect(await serious(page)).toEqual([]);
});

test('adds a setup shift: venue-zone times, a soft warning (not a block), preview refreshed', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(URL_);
  await expect(card(page)).toBeVisible(COLD);
  await card(page).getByRole('button', { name: 'Add a shift' }).click();
  const editor = card(page).getByTestId('setup-shift-editor');
  await expect(editor.getByLabel('Shift or role name')).toBeFocused();

  // Client checks first: a name, then an end after the start.
  await editor.getByRole('button', { name: 'Add shift' }).click();
  await expect(editor.getByText('Enter a name or role')).toBeVisible();
  await expect(editor.getByLabel('Shift or role name')).toBeFocused();
  expect(calls.create).toHaveLength(0);

  await editor.getByLabel('Shift or role name').fill('Setup crew');
  await editor.getByLabel('Starts').fill('2031-06-01T12:00');
  await editor.getByLabel('Ends').fill('2031-06-01T11:00');
  await editor.getByRole('button', { name: 'Add shift' }).click();
  await expect(editor.getByText('End time must be after the start time')).toBeVisible();

  await editor.getByLabel('Ends').fill('2031-06-01T16:00');
  await expect(editor.getByTestId('setup-shift-outside-warning')).toContainText('Starts before the event does');
  await editor.getByLabel('Volunteers needed').fill('6');
  expect(await serious(page)).toEqual([]);
  // The preview frame loads lazily on mobile (behind the eye button); count what it has fetched so far.
  const previewsBefore = calls.preview;
  await editor.getByRole('button', { name: 'Add shift' }).click();

  await expect.poll(() => calls.create.length).toBe(1);
  // Noon EDT is 16:00 UTC: the venue wall clock, not the browser's.
  expect(calls.create[0].postDataJSON()).toEqual({ name: 'Setup crew', startsAt: '2031-06-01T16:00:00.000Z', endsAt: '2031-06-01T20:00:00.000Z', capacity: 6 });
  const row = card(page).getByTestId('setup-shift-sh-3');
  await expect(row).toContainText('12:00 PM EDT – 4:00 PM EDT');
  await expect(row).toContainText('Starts before the event does');
  await expect(card(page).getByRole('button', { name: 'Add a shift' })).toBeFocused();
  await expect(card(page).getByRole('status')).toHaveText('Setup crew added.');
  await expect.poll(() => calls.preview).toBeGreaterThan(previewsBefore);
});

test('edits a shift; capacity below the assigned count shows the 409 in words', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(URL_);
  await expect(card(page)).toBeVisible(COLD);
  await card(page).getByRole('button', { name: 'Edit Gate crew' }).click();
  const editor = card(page).getByTestId('setup-shift-editor');
  await expect(editor.getByLabel('Starts')).toHaveValue('2031-06-01T16:00');
  await expect(editor.getByLabel('Volunteers needed')).toHaveValue('4');

  await editor.getByLabel('Volunteers needed').fill('2');
  await editor.getByRole('button', { name: 'Save shift' }).click();
  await expect(editor.getByRole('alert')).toHaveText('3 volunteers are already assigned to Gate crew. Set the capacity to at least 3, or leave it empty for no limit.');
  expect(await serious(page)).toEqual([]);

  await editor.getByLabel('Shift or role name').fill('Gate team');
  await editor.getByLabel('Volunteers needed').fill('5');
  await editor.getByRole('button', { name: 'Save shift' }).click();
  await expect.poll(() => calls.patch.length).toBe(2);
  expect(calls.patch[1].postDataJSON()).toMatchObject({ name: 'Gate team', capacity: 5, startsAt: '2031-06-01T20:00:00.000Z' });
  await expect(card(page).getByTestId('setup-shift-sh-gate')).toContainText('3 of 5 assigned');
  await expect(card(page).getByRole('button', { name: 'Edit Gate team' })).toBeFocused();
});

test('deletes a free shift; a shift with assigned volunteers shows the 409 in words', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto(URL_);
  await expect(card(page)).toBeVisible(COLD);
  page.on('dialog', (d) => d.accept());

  await card(page).getByRole('button', { name: 'Delete Gate crew' }).click();
  await expect(card(page).getByRole('alert')).toHaveText("Gate crew can't be deleted: 3 volunteers are assigned to it. Move them to another shift from their applications first.");
  await expect(card(page).getByTestId('setup-shift-sh-gate')).toBeVisible();

  await card(page).getByRole('button', { name: 'Delete Runner' }).click();
  await expect.poll(() => calls.remove.length).toBe(2);
  await expect(card(page).getByTestId('setup-shift-sh-runner')).toHaveCount(0);
  await expect(card(page).getByRole('heading', { name: 'Shifts and roles' })).toBeFocused();
  expect(await serious(page)).toEqual([]);
});
