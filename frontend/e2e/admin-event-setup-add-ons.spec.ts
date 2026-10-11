// Event setup wizard, step 7 Collect more (spec 050-K). Runs on the flag-on
// dev server (PLAYWRIGHT_WIZARD_BASE_URL) as an ORGANIZER (050-E grants
// addOns.manage); every API call is mocked with 2xx answers. Assertions are
// scoped to the form pane (<main>) or the add-on dialog.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-collect';
const EVENT_ID = 'evt-collect';
const expect = baseExpect.configure({ timeout: 15000 });
const COLD = { timeout: 30000 };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const GA = { id: 'tier-ga', name: 'General admission' };
const VIP = { id: 'tier-vip', name: 'VIP' };

function tier(t: { id: string; name: string }, i: number) {
  return {
    ...t, description: null, price: 25, quantityTotal: 100, quantitySold: 0, quantityReserved: 0, quantityAvailable: 100,
    displayOrder: i, minPerOrder: null, maxPerOrder: null, isActive: true, saleStartDate: null, saleEndDate: null,
    visibility: 'PUBLIC', isRefundable: true, saleStatus: 'ON_SALE',
  };
}

function adminEvent(patch: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, slug: 'harvest-fair', name: 'Harvest Fair', description: null, logoUrl: null,
    date: '2031-09-01T20:00:00.000Z', endDate: null, capacity: 200, category: null, status: 'DRAFT',
    admissionMode: 'TICKETED', setupStep: 'collect-more', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
    organizationId: ORG_ID, organizationName: 'Collect Org',
    venue: { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [GA, VIP].map(tier),
    ...patch,
  };
}

function addOn(patch: Record<string, unknown> = {}) {
  return {
    id: 'addon-parking', name: 'Parking pass', description: null, price: 15, taxable: true, maxPerOrder: null,
    remaining: null, soldOut: false, allTiers: true, priceTierIds: [], applicationTierIds: [], scope: 'TICKET',
    quantityTotal: null, quantitySold: 0, quantityReserved: 0, isActive: true, displayOrder: 0, orderLineCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...patch,
  };
}

const SAVED = [
  { id: 'sa-parking', name: 'Parking pass', description: null, defaultPrice: 15, scope: 'TICKET', taxable: true, isArchived: false, eventCount: 3, onEvent: null },
];

async function mockApi(page: Page, event = adminEvent()) {
  const state = { addOns: [] as Record<string, unknown>[], attach: [] as unknown[], create: [] as unknown[], patch: [] as unknown[], previews: 0 };
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Collect Org', slug: 'collect-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  // ORGANIZER defaults (spec 050-E): addOns.manage, no money movement.
  await page.route(`${API}/admin/permissions`, (route) =>
    route.fulfill(json({ granted: ['events', 'venues', 'dashboard', 'addOns.manage'], hiddenPaths: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([{ ...event.venue, city: 'Raleigh', state: 'NC' }])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) => route.fulfill(json({ event, applications: { forms: [] } })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) => {
    state.previews += 1;
    return route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Collect Org' }, forms: [] }));
  });
  await page.route(`${API}/organizations/${ORG_ID}/saved-add-ons?**`, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    const onEvent = (id: string) => (state.addOns.some((a) => a.name === 'Parking pass') && id === 'sa-parking' ? 'addon-parking' : null);
    const saved = SAVED.filter((s) => s.name.toLowerCase().includes(q)).map((s) => ({ ...s, onEvent: onEvent(s.id) }));
    return route.fulfill(json({ savedAddOns: saved, suggestions: [], ...(q ? { exactMatch: null, canCreate: !saved.some((s) => s.name.toLowerCase() === q) } : {}) }));
  });
  const base = `${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons`;
  await page.route(base, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      state.create.push(body);
      const row = addOn({ ...body, id: `addon-${state.addOns.length + 1}`, displayOrder: state.addOns.length });
      state.addOns.push(row);
      return route.fulfill(json(row, 201));
    }
    return route.fulfill(json({ addOns: state.addOns }));
  });
  await page.route(`${base}/attach`, (route) => {
    state.attach.push(route.request().postDataJSON());
    const row = addOn();
    state.addOns.push(row);
    return route.fulfill(json(row, 201));
  });
  await page.route(`${base}/addon-parking`, (route) => {
    const body = route.request().postDataJSON();
    state.patch.push(body);
    Object.assign(state.addOns[0], body);
    return route.fulfill(json(state.addOns[0]));
  });
  return state;
}

const WIZARD_URL = process.env.PLAYWRIGHT_WIZARD_BASE_URL;
test.skip(!WIZARD_URL, 'needs the flag-on dev server (PLAYWRIGHT_WIZARD_BASE_URL)');
test.use({ baseURL: WIZARD_URL });

const STAFF = { id: 'collect-organizer', email: 'collect-organizer@test.com', role: 'ORGANIZER' as const };
const STEP_URL = `/admin/events/${EVENT_ID}/setup?step=collect-more`;
const main = (page: Page) => page.locator('main');
const heading = (page: Page) => main(page).getByRole('heading', { level: 1, name: 'Collect more' });
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

// Compile the wizard route and the preview frame once, before any test times a step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  if (!WIZARD_URL) return;
  // Desktop, so the preview pane (and its frame route) renders inline.
  const page = await browser.newPage({ baseURL: WIZARD_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, WIZARD_URL);
  await mockApi(page);
  await page.goto(STEP_URL, { timeout: 120000 });
  await expect(page.locator('main h1')).toBeVisible({ timeout: 120000 });
  await expect(page.frameLocator('iframe[title="Event page preview"]').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

/** Add the saved Parking pass, then attach it to the VIP tier only. */
async function addParkingForVip(page: Page, state: Awaited<ReturnType<typeof mockApi>>) {
  const pane = main(page);
  await expect(pane.getByText('No add-ons yet.')).toBeVisible(COLD);
  const picker = pane.getByRole('combobox', { name: 'Add an add-on' });
  await picker.click();
  await page.getByRole('listbox', { name: 'Saved add-ons' }).getByRole('option', { name: /Parking pass/ }).click();
  await expect.poll(() => state.attach).toEqual([{ productId: 'sa-parking' }]);
  const row = pane.getByTestId('admin-add-on-addon-parking');
  await expect(row).toContainText('all tiers');

  const edit = row.getByRole('button', { name: 'Edit' });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit add-on' });
  // Focus moves into the dialog.
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await dialog.getByLabel('Total available').fill('40');
  await dialog.getByLabel('Only these tiers').check();
  await dialog.getByLabel('VIP', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.patch.at(-1)).toMatchObject({ allTiers: false, priceTierIds: [VIP.id], quantityTotal: 40 });
  await expect(row).toContainText('tiers: VIP');
  await expect(row).toContainText('40 left of 40');
  // Focus returns to the opener.
  await expect(edit).toBeFocused();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('ORGANIZER adds a saved add-on and attaches it to tiers; the preview reloads', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto(STEP_URL);
    await expect(heading(page)).toBeVisible(COLD);
    await expect(page.getByText(/Step 7 of 12 — Collect more/)).toBeVisible();
    await expect.poll(() => state.previews).toBeGreaterThan(0);
    const before = state.previews;
    await addParkingForVip(page, state);
    // Two saves (attach, edit), each bumps the preview revision.
    await expect.poll(() => state.previews).toBeGreaterThanOrEqual(before + 2);
  });

  test('creates a saved add-on in place; Escape closes a dialog and returns focus', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto(STEP_URL);
    const pane = main(page);
    await expect(pane.getByText('No add-ons yet.')).toBeVisible(COLD);
    await pane.getByRole('combobox', { name: 'Add an add-on' }).fill('Event T-shirt');
    await page.getByRole('option', { name: 'Create “Event T-shirt”' }).click();
    const created = page.getByRole('dialog', { name: 'New add-on' });
    await expect(created.getByLabel('Name')).toHaveValue('Event T-shirt');
    await created.getByLabel('Price ($)').fill('20');
    await created.getByLabel('Sold with').selectOption('TICKET');
    await created.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => state.create).toEqual([expect.objectContaining({ name: 'Event T-shirt', price: 20, scope: 'TICKET', allTiers: true })]);
    const row = pane.getByTestId('admin-add-on-addon-1');
    await expect(row).toContainText('Event T-shirt');

    const edit = row.getByRole('button', { name: 'Edit' });
    await edit.click();
    await expect(page.getByRole('dialog', { name: 'Edit add-on' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(edit).toBeFocused();
  });

  test('RSVP events skip the step while donations are not eligible', async ({ page }) => {
    await mockApi(page, adminEvent({ admissionMode: 'RSVP', priceTiers: [], setupStep: 'tickets' }));
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=tickets`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Tickets or RSVP' })).toBeVisible(COLD);
    await expect(page.getByRole('list', { name: 'Setup steps' }).getByText('Collect more')).toHaveCount(0);
    await page.goto(STEP_URL);
    await expect(page).not.toHaveURL(/step=collect-more/, COLD);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390 × 844: add and attach, no horizontal scroll, axe clean', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto(STEP_URL);
    await expect(heading(page)).toBeVisible(COLD);
    await addParkingForVip(page, state);
    const overflow = await page.evaluate(() =>
      [document.documentElement, document.querySelector('main')].filter((el): el is HTMLElement => !!el && el.scrollWidth > el.clientWidth).length
    );
    expect(overflow).toBe(0);
    expect(await serious(page)).toEqual([]);
    // The dialog open, too.
    await main(page).getByTestId('admin-add-on-addon-parking').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit add-on' })).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
});
