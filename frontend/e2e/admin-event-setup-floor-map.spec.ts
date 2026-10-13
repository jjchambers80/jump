// Event setup wizard step 9, Floor map (spec 050-M). Runs as an
// ORGANIZER. Every API call is mocked
// by a small stateful fake (forms and the event's map), so a form patch or a
// map create changes what the next read returns. Assertions are scoped to the
// form pane (<main>): the preview frame repeats names.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-map';
const EVENT_ID = 'evt-map';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const VENUE = { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' };

const EVENT = {
  id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: null, logoUrl: null,
  date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 100, category: null, status: 'DRAFT',
  admissionMode: 'TICKETED', setupStep: 'vendors', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
  rsvpRemaining: null, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
  organizationId: ORG_ID, organizationName: 'Map Org',
  venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: VENUE.timezone }, priceTiers: [],
};

function form(patch: Record<string, any>) {
  const id = patch.id;
  return {
    id, eventId: EVENT_ID, kind: 'PAID', purpose: 'VENDOR', name: 'Vendor booths', slug: id, intro: null, status: 'DRAFT', opensAt: null, closesAt: null,
    chargeTiming: 'APPROVAL', feeMode: 'PASS', taxable: false, paymentDueDays: 7, overduePolicy: 'WITHDRAW', reserveOnApproval: true,
    spaceSelection: 'TIERS', displayOrder: 0, createdFromTemplateId: null, acceptance: { accepting: true, reason: null },
    paymentsEnabled: true, applicationCount: 0, collectBusiness: true, tiers: [], addOns: [], questions: [],
    ...patch,
  };
}

const PLANS = [
  { id: 'plan-hall', name: 'Union Hall layout', width: 100, height: 60, boothCount: 24, zoneCount: 0, elementCount: 4, sourceMapId: null, createdAt: '2031-01-01T00:00:00Z', updatedAt: '2031-01-01T00:00:00Z' },
];

function mapDetail(patch: Record<string, any> = {}) {
  return {
    id: 'map-1', organizationId: ORG_ID, eventId: EVENT_ID, name: 'Spring Fair floor map', status: 'DRAFT', unit: 'ft', gridSize: 5,
    width: 100, height: 60, underlayFileId: null, underlayOpacity: 0.5, layout: { version: 1, elements: [] },
    publishedAt: null, createdAt: '2031-01-01T00:00:00Z', updatedAt: '2031-01-01T00:00:00Z', booths: [], tiers: [],
    ...patch,
  };
}

const booth = (id: string, tierId: string | null) => ({
  id, mapId: 'map-1', label: id, kind: 'BOOTH', x: 0, y: 0, w: 10, h: 10, rotation: 0, tierId, status: 'AVAILABLE',
  price: null, applicationId: null, assignedById: null,
});

interface MockOptions {
  forms: Record<string, any>[];
  map?: Record<string, any> | null;
  /** POST /admin/maps answers: create the map, 409 MAP_EXISTS (someone made it meanwhile) or 403. */
  create?: 'ok' | 'exists' | 'forbidden';
  /** PUT …/layout: answer at once, fail, or wait until `release()`. */
  layout?: 'ok' | 'fail' | 'hold';
}

async function mockApi(page: Page, { forms: initial, map: initialMap = null, create = 'ok', layout = 'ok' }: MockOptions) {
  const forms = structuredClone(initial);
  let map = initialMap ? structuredClone(initialMap) : null;
  const calls: { patch: Request[]; createMap: Request[]; layout: Request[]; release: () => void } = { patch: [], createMap: [], layout: [], release: () => {} };
  const held = new Promise<void>((resolve) => (calls.release = resolve));
  const list = `${API}/admin/events/${EVENT_ID}/application-forms`;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Map Org', slug: 'map-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) =>
    route.fulfill(json({ granted: ['dashboard', 'events', 'applications', 'applications.forms', 'addOns.manage', 'venues', 'maps'], hiddenPaths: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([VENUE])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event: EVENT, applications: { forms: [] }, map: map && { id: map.id, name: map.name, status: map.status }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event: EVENT, organization: { id: ORG_ID, name: 'Map Org' }, forms }))
  );
  await page.route(`${API}/admin/application-templates`, (route) => route.fulfill(json({ data: [] })));
  await page.route(list, (route) => route.fulfill(json({ data: forms })));
  await page.route(new RegExp(`${list}/[^/]+$`), (route) => {
    calls.patch.push(route.request());
    const target = forms.find((f) => f.id === route.request().url().split('/').pop())!;
    Object.assign(target, route.request().postDataJSON());
    return route.fulfill(json(target));
  });
  await page.route(`${API}/admin/events/${EVENT_ID}/map`, (route) =>
    route.fulfill(map ? json({ mapId: map.id }) : json({ error: 'NotFoundError', message: 'No map for this event' }, 404))
  );
  await page.route(`${API}/admin/maps/templates`, (route) => route.fulfill(json(PLANS)));
  await page.route(`${API}/admin/maps`, (route) => {
    calls.createMap.push(route.request());
    if (create === 'forbidden') return route.fulfill(json({ error: 'ForbiddenError', message: 'Forbidden' }, 403));
    map = mapDetail({ name: create === 'exists' ? 'Made in another tab' : 'Spring Fair floor map' });
    if (create === 'exists') return route.fulfill(json({ error: 'ConflictError', message: 'MAP_EXISTS — this event already has a floor map' }, 409));
    return route.fulfill(json(map, 201));
  });
  // GET, and the builder's PATCH of the map's settings.
  await page.route(`${API}/admin/maps/map-1`, (route) => route.fulfill(map ? json(map) : json({ message: 'Not found' }, 404)));
  await page.route(`${API}/admin/maps/map-1/layout`, async (route) => {
    calls.layout.push(route.request());
    if (layout === 'fail') return route.fulfill(json({ message: 'Database unavailable' }, 500));
    if (layout === 'hold') await held;
    const body = route.request().postDataJSON();
    map = { ...map!, layout: { version: 1, elements: body.elements }, booths: body.booths.map((b: any, i: number) => ({ ...booth(`b${i}`, b.tierId), ...b })) };
    return route.fulfill(json(map));
  });
  return calls;
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const COLD = { timeout: 30000 };
test.describe.configure({ timeout: 90000 });
const STAFF = { id: 'map-organizer', email: 'map-organizer@test.com', role: 'ORGANIZER' as const };
// Spec 051: the floor map is a step of the vendor application flow.
const flowUrl = (query: string) => `/admin/events/${EVENT_ID}/setup/vendors?${query}`;
const MAP_STEP = flowUrl('step=floor-map&form=form-map');
const RETURN_TO = encodeURIComponent(MAP_STEP);

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const preview = (page: Page) => page.frameLocator('iframe[title="Event page preview"]');
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));
const MAP_FORM = form({ id: 'form-map', spaceSelection: 'MAP' });
const builderUrl = `/admin/maps/map-1?returnTo=${RETURN_TO}`;
const wizardMapStep = new RegExp(`/admin/events/${EVENT_ID}/setup/vendors\\?step=floor-map&form=form-map$`);
const done = (page: Page) => page.getByTestId('map-builder').getByRole('button', { name: /^(Done|Saving…)$/ });

// Compile the wizard route and the preview frame once, before any timed step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page, { forms: [MAP_FORM] });
  for (const url of [flowUrl('step=payment&form=form-map'), MAP_STEP]) {
    await page.goto(url, { timeout: 120000 });
    await expect(page.locator('main h1')).toBeVisible({ timeout: 120000 });
  }
  await expect(preview(page).getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120000 });
  await mockApi(page, { forms: [MAP_FORM], map: mapDetail() });
  await page.goto(builderUrl, { timeout: 120000 });
  await expect(page.getByTestId('map-builder')).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the step follows a vendor form between TIERS and MAP', async ({ page }) => {
    const calls = await mockApi(page, { forms: [form({ id: 'form-paid' })] });
    const next = page.locator('footer').getByRole('button', { name: 'Next' });
    await page.goto(flowUrl('step=payment&form=form-paid'));
    await expect(heading(page, 'How vendors choose and pay')).toBeVisible(COLD);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 4 of 6');
    await main(page).getByTestId('form-space-map').check();
    await next.click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().spaceSelection)).toContain('MAP');
    await expect(heading(page, 'Floor map')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 5 of 7');

    await page.locator('footer').getByRole('button', { name: 'Back' }).click();
    await expect(heading(page, 'How vendors choose and pay')).toBeVisible();
    await main(page).getByTestId('form-space-tiers').check();
    await next.click();
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON().spaceSelection)).toContain('TIERS');
    await expect(heading(page, 'Fields')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'Step 5 of 6');
  });

  test('no map yet: create a blank map, then open the builder with returnTo', async ({ page }) => {
    const calls = await mockApi(page, { forms: [MAP_FORM] });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    await expect(main(page).getByRole('heading', { level: 2, name: 'Create the floor map' })).toBeVisible();
    await expect(main(page).getByText(/No floor map yet\. Vendors choose spots/)).toBeVisible();
    await expect(main(page).getByRole('button', { name: /Use floor plan Union Hall layout/ })).toBeVisible();
    await main(page).getByRole('button', { name: 'Create a blank map' }).click();
    await expect.poll(() => calls.createMap.length).toBe(1);
    expect(calls.createMap[0].postDataJSON()).toEqual({ eventId: EVENT_ID });
    const summary = main(page).getByTestId('setup-map-summary');
    await expect(summary.getByRole('heading', { name: /Spring Fair floor map/ })).toBeFocused();
    await expect(main(page).getByRole('status').filter({ hasText: 'Spring Fair floor map created.' })).toBeVisible();
    await expect(main(page).getByText('Vendors choose spots on the floor map, but the map is not published.')).toBeVisible();
    await expect(summary.getByText('Draft', { exact: true })).toBeVisible();
    await expect(summary.getByText('No booths yet')).toBeVisible();
    await expect(summary.getByRole('link', { name: 'Open map builder' })).toHaveAttribute('href', `/admin/maps/map-1?returnTo=${RETURN_TO}`);
  });

  test('a published map shows its booths and tiers, and no warning', async ({ page }) => {
    const map = mapDetail({
      status: 'PUBLISHED', publishedAt: '2031-01-02T00:00:00Z',
      booths: [booth('A1', 't-std'), booth('A2', 't-std'), booth('A3', null)],
      tiers: [
        { id: 't-std', name: 'Standard booth', price: 100, mapBound: true, quantityTotal: 10, form: null, displayOrder: 0 },
        { id: 't-corner', name: 'Corner booth', price: 150, mapBound: false, quantityTotal: 2, form: null, displayOrder: 1 },
      ],
    });
    await mockApi(page, { forms: [MAP_FORM], map });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    const summary = main(page).getByTestId('setup-map-summary');
    await expect(summary.getByText('Published', { exact: true })).toBeVisible();
    await expect(summary.getByText('3 booths, 1 without a tier')).toBeVisible();
    await expect(summary.getByText('Standard booth', { exact: true })).toBeVisible();
    await expect(main(page).getByText(/the map is not published/)).toHaveCount(0);
  });

  test('start from a floor plan', async ({ page }) => {
    const calls = await mockApi(page, { forms: [MAP_FORM] });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    await main(page).getByRole('button', { name: /Use floor plan Union Hall layout/ }).click();
    await expect.poll(() => calls.createMap.length).toBe(1);
    expect(calls.createMap[0].postDataJSON()).toEqual({ eventId: EVENT_ID, templateId: 'plan-hall' });
    await expect(main(page).getByTestId('setup-map-summary').getByRole('heading')).toBeFocused();
  });

  test('a map made meanwhile (409 MAP_EXISTS) is shown instead of the error', async ({ page }) => {
    await mockApi(page, { forms: [MAP_FORM], create: 'exists' });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    await main(page).getByRole('button', { name: 'Create a blank map' }).click();
    const summary = main(page).getByTestId('setup-map-summary');
    await expect(summary.getByRole('heading', { name: /Made in another tab/ })).toBeFocused();
    await expect(main(page).getByRole('status').filter({ hasText: 'This event already has a floor map.' })).toBeVisible();
    await expect(main(page).getByText(/MAP_EXISTS/)).toHaveCount(0);
  });

  test('a 403 says the organizer has no access', async ({ page }) => {
    await mockApi(page, { forms: [MAP_FORM], create: 'forbidden' });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    await main(page).getByRole('button', { name: 'Create a blank map' }).click();
    await expect(main(page).getByRole('alert').filter({ hasText: "You don't have access to this map." })).toBeVisible();
  });

  test('the builder returns to the wizard on Back and on Done', async ({ page }) => {
    await mockApi(page, { forms: [MAP_FORM], map: mapDetail() });
    await page.goto(builderUrl);
    await page.getByRole('link', { name: 'Back to setup' }).click();
    await expect(page).toHaveURL(wizardMapStep, COLD);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    await main(page).getByRole('link', { name: 'Open map builder' }).click();
    await expect(done(page)).toHaveText('Done', COLD);
    await done(page).click();
    await expect(page).toHaveURL(wizardMapStep, COLD);
  });

  test('Done during an autosave waits for it, then returns', async ({ page }) => {
    const calls = await mockApi(page, { forms: [MAP_FORM], map: mapDetail(), layout: 'hold' });
    await page.goto(builderUrl);
    await page.getByTestId('palette-BOOTH').click();
    await expect.poll(() => calls.layout.length, COLD).toBe(1);
    await done(page).click();
    await expect(done(page)).toHaveText('Saving…');
    await expect(done(page)).toBeDisabled();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/admin\/maps\/map-1/);
    calls.release();
    await expect(page).toHaveURL(wizardMapStep, COLD);
    expect(calls.layout[0].postDataJSON().booths).toHaveLength(1);
  });

  test('Done after a failed save stays in the builder and says why', async ({ page }) => {
    const calls = await mockApi(page, { forms: [MAP_FORM], map: mapDetail(), layout: 'fail' });
    await page.goto(builderUrl);
    await page.getByTestId('palette-BOOTH').click();
    await done(page).click();
    await expect.poll(() => calls.layout.length).toBeGreaterThan(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Database unavailable' })).toBeVisible();
    await expect(done(page)).toHaveText('Done');
    await expect(done(page)).toBeEnabled();
    await expect(page).toHaveURL(/\/admin\/maps\/map-1/);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings on the floor map step (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await mockApi(page, { forms: [MAP_FORM] });
      await page.goto(MAP_STEP);
      await expect(heading(page, 'Floor map')).toBeVisible(COLD);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(main(page).getByRole('button', { name: 'Create a blank map' })).toBeVisible();
      await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      expect(await serious(page)).toEqual([]);
    });
  }
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('floor map step at 390 × 844: both states, axe, 44 px targets, no horizontal scroll', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page, { forms: [MAP_FORM] });
    await page.goto(MAP_STEP);
    await expect(heading(page, 'Floor map')).toBeVisible(COLD);
    const create = main(page).getByRole('button', { name: 'Create a blank map' });
    const plan = main(page).getByRole('button', { name: /Use floor plan Union Hall layout/ });
    for (const target of [create, plan]) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await serious(page)).toEqual([]);
    await create.click();
    const open = main(page).getByRole('link', { name: 'Open map builder' });
    await expect(open).toBeVisible();
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => [document.documentElement, document.querySelector('main')].filter((el) => !!el && el.scrollWidth > el.clientWidth).length);
    expect(overflow).toBe(0);
    expect(await serious(page)).toEqual([]);
  });
});
