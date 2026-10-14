// Event setup wizard steps 4–6 (spec 050-J): Describe it, Add an image,
// Tickets or RSVP. Every API call is mocked by a small stateful
// fake, so saves change what the next request returns. Assertions are scoped
// to the form pane (<main>): the preview frame repeats names and prices.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-tickets';
const EVENT_ID = 'evt-tickets';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const VENUE = { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' };

function tier(patch: Record<string, unknown> = {}) {
  return {
    id: 't-ga', name: 'General Admission', description: null, price: 25, quantityTotal: 80, quantitySold: 0, quantityReserved: 0,
    quantityAvailable: 80, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, isRefundable: false,
    saleStartDate: '2031-05-01T14:00:00.000Z', saleEndDate: null, visibility: 'PUBLIC', saleStatus: 'ON_SALE', ...patch,
  };
}

function baseEvent(patch: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: null, logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 100, category: null, status: 'DRAFT',
    admissionMode: 'TICKETED', setupStep: 'tickets', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
    organizationId: ORG_ID, organizationName: 'Tickets Org',
    venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: VENUE.timezone }, priceTiers: [tier()],
    ...patch,
  };
}

type Calls = { patch: Request[]; tierPost: Request[]; tierPatch: Request[]; tierDelete: Request[]; tierToggle: Request[] };
type Extra = { lockReason?: string; refuseModeChange?: string };

/** A stateful fake API: PATCH and tier writes change the event later loads return. */
async function mockApi(page: Page, initial = baseEvent(), extra: Extra = {}) {
  const event: Record<string, any> = structuredClone(initial);
  const calls: Calls = { patch: [], tierPost: [], tierPatch: [], tierDelete: [], tierToggle: [] };
  let seq = 0;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Tickets Org', slug: 'tickets-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([VENUE])));
  await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}`, (route) => {
    calls.patch.push(route.request());
    const body = route.request().postDataJSON();
    // The server's admission lock (EventService.admissionLockReason).
    if (extra.refuseModeChange && body.admissionMode && body.admissionMode !== event.admissionMode)
      return route.fulfill(json({ error: 'ConflictError', code: 'ADMISSION_MODE_LOCKED', message: extra.refuseModeChange }, 409));
    Object.assign(event, body);
    route.fulfill(json(event));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event, applications: { forms: [] }, admissionLock: { locked: !!extra.lockReason, reason: extra.lockReason ?? null } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Tickets Org' }, forms: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/price-tiers`, (route) => {
    calls.tierPost.push(route.request());
    const body = route.request().postDataJSON();
    const created = tier({ ...body, id: `t-new-${++seq}`, quantityAvailable: body.quantityTotal, displayOrder: event.priceTiers.length });
    event.priceTiers.push(created);
    route.fulfill(json(created, 201));
  });
  await page.route(new RegExp(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/price-tiers/[^/]+/(activate|deactivate)$`), (route) => {
    calls.tierToggle.push(route.request());
    const [id, action] = route.request().url().split('/').slice(-2);
    const target = event.priceTiers.find((t: { id: string }) => t.id === id);
    target.isActive = action === 'activate';
    route.fulfill(json(target));
  });
  await page.route(new RegExp(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/price-tiers/[^/]+$`), (route) => {
    const id = route.request().url().split('/').pop()!;
    if (route.request().method() === 'DELETE') {
      calls.tierDelete.push(route.request());
      event.priceTiers = event.priceTiers.filter((t: { id: string }) => t.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    calls.tierPatch.push(route.request());
    const target = event.priceTiers.find((t: { id: string }) => t.id === id);
    Object.assign(target, route.request().postDataJSON());
    route.fulfill(json(target));
  });
  return calls;
}

const COLD = { timeout: 30000 };
// axe scans the page and the preview frame: give each test room beyond 30 s.
test.describe.configure({ timeout: 90000 });
const STAFF = { id: 'tickets-admin', email: 'tickets-admin@test.com', role: 'ADMIN' as const };
const setupUrl = (query: string) => `/admin/events/${EVENT_ID}/setup?${query}`;

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const preview = (page: Page) => page.frameLocator('iframe[title="Event page preview"]');
const indicator = (page: Page) => page.getByRole('status').filter({ hasText: /^(Saved|Saving…|Unsaved changes|Not saved.*)$/ });

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

async function overflowsAt(page: Page) {
  return page.evaluate(() =>
    [document.documentElement, document.querySelector('main'), document.querySelector('footer')]
      .filter((el): el is HTMLElement => !!el)
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => el.tagName)
  );
}

// Compile the wizard route and the preview frame once, before any timed step.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page);
  for (const step of ['description', 'image', 'tickets']) {
    await page.goto(setupUrl(`step=${step}`), { timeout: 120000 });
    await expect(page.locator('main h1')).toBeVisible({ timeout: 120000 });
  }
  await expect(preview(page).getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120000 });
  // The editor is a lazy chunk: load it once too.
  await page.goto(setupUrl('step=description'), { timeout: 120000 });
  await expect(page.locator('main [contenteditable="true"]')).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('ticketed path: describe, image, capacity and a new tier', async ({ page }) => {
    const calls = await mockApi(page, baseEvent({ priceTiers: [], capacity: null, setupStep: 'description' }));
    await page.goto(setupUrl('step=description'));
    await expect(heading(page, 'Describe it')).toBeVisible(COLD);
    const editor = main(page).locator('[contenteditable="true"]');
    await editor.click();
    await page.keyboard.type('Bring a chair.');
    await main(page).getByLabel('Category (optional)').fill('Music');
    await expect.poll(() => calls.patch.length, COLD).toBeGreaterThan(0);
    await expect.poll(() => calls.patch.map((r) => r.postDataJSON()).reduce((a, b) => ({ ...a, ...b }), {})).toEqual({
      description: '<p>Bring a chair.</p>', category: 'Music',
    });
    // The saved, server-side description reaches the preview.
    await expect(preview(page).getByText('Bring a chair.')).toBeVisible(COLD);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Add an image')).toBeFocused(COLD);
    await expect(main(page).getByRole('button', { name: 'Upload new' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(heading(page, 'Tickets or RSVP')).toBeFocused(COLD);
    await expect(main(page).getByText('No tiers yet.')).toBeVisible();
    const before = calls.patch.length;
    await main(page).getByLabel('Capacity').fill('100');
    await expect.poll(() => calls.patch.slice(before).map((r) => r.postDataJSON())).toContainEqual({ capacity: 100 });

    // A ticketed event needs a tier to move on; capacity still saved above.
    const add = main(page).getByRole('button', { name: 'Add tier' });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible();
    await expect(main(page).locator('#setup-tier-add-error')).toHaveText('Add at least one ticket tier');
    await expect(add).toHaveAttribute('aria-describedby', 'setup-tier-add-error');

    await add.click();
    const dialog = page.getByRole('dialog', { name: 'New Tier 1' });
    await expect(dialog).toBeVisible();
    // An incomplete tier never reaches the API.
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a tier name');
    expect(calls.tierPost).toHaveLength(0);
    await dialog.getByLabel('Tier Name *').fill('Early Bird');
    await dialog.getByLabel('Price ($) *').fill('20');
    await dialog.getByLabel('Quantity *').fill('60');
    await expect(dialog.getByText(/In the venue's time zone: .*New York/)).toBeVisible();
    await dialog.getByLabel('Sale Start').fill('2031-05-01T10:00');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    expect(calls.tierPost[0].postDataJSON()).toMatchObject({
      name: 'Early Bird', price: 20, quantityTotal: 60, saleStartDate: '2031-05-01T14:00:00.000Z',
    });
    const card = main(page).getByRole('listitem').filter({ hasText: 'Early Bird' });
    // All-in price from lib/fees.ts.
    await expect(card.getByText(/^Buyers pay \$\d+\.\d\d with fees$/)).toBeVisible();
    await expect(preview(page).getByText('Early Bird').first()).toBeVisible(COLD);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Collect more')).toBeVisible(COLD);
  });

  test('tier over capacity warns inline and does not block Next', async ({ page }) => {
    await mockApi(page);
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    const capacity = main(page).getByLabel('Capacity');
    await expect(main(page).getByText(/Over capacity/)).toHaveCount(0);
    await capacity.fill('50');
    const warning = main(page).getByText(/Over capacity: tiers add up to 80, more than the capacity of 50/);
    await expect(warning).toBeVisible();
    await expect(capacity).toHaveAttribute('aria-describedby', /setup-capacity-warning/);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Collect more')).toBeVisible(COLD);
  });

  test('a deep-linked tier dialog returns focus to its Edit button; duplicate and remove', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=tickets&tier=t-ga'));
    const dialog = page.getByRole('dialog', { name: 'Edit Tier 1' });
    await expect(dialog).toBeVisible(COLD);
    await expect(dialog.getByLabel('Sale Start')).toHaveValue('2031-05-01T10:00');
    await expect(dialog.getByLabel('Tier Name *')).toBeFocused();
    // Tab stays inside the dialog.
    for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const edit = main(page).getByRole('button', { name: 'Edit General Admission' });
    await expect(edit).toBeFocused();
    await expect(page).not.toHaveURL(/tier=/);

    // Opened from its button, the dialog gives focus back to it on save.
    await edit.click();
    await page.getByRole('dialog', { name: 'Edit Tier 1' }).getByLabel('Price ($) *').fill('30');
    await page.getByRole('button', { name: 'Save tier' }).click();
    await expect(edit).toBeFocused();
    expect(calls.tierPatch[0].postDataJSON()).toEqual({ price: 30 });

    await main(page).getByRole('button', { name: 'Duplicate General Admission' }).click();
    await expect(main(page).getByRole('heading', { level: 3, name: 'General Admission (copy)' })).toBeVisible();
    expect(calls.tierPost[0].postDataJSON()).toMatchObject({ name: 'General Admission (copy)', price: 30, quantityTotal: 80 });

    page.once('dialog', (d) => void d.accept());
    await main(page).getByRole('button', { name: 'Remove General Admission (copy)' }).click();
    await expect(main(page).getByRole('heading', { level: 3, name: 'General Admission (copy)' })).toHaveCount(0);
    expect(calls.tierDelete).toHaveLength(1);
  });

  test('RSVP path: switching hides the tiers and saves the RSVP settings', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    await expect(main(page).getByRole('heading', { name: 'Ticket tiers' })).toBeVisible();
    // Click the visible segment (the radio itself is visually hidden).
    await main(page).locator('label').filter({ hasText: /^RSVP$/ }).click();
    await expect(main(page).getByRole('radio', { name: 'RSVP' })).toBeChecked();
    await expect(main(page).getByRole('heading', { name: 'Ticket tiers' })).toHaveCount(0);
    await expect(main(page).getByLabel('Capacity')).toHaveCount(0);
    await main(page).locator('label').filter({ hasText: /^Limit RSVPs$/ }).click();
    await expect(main(page).getByRole('switch', { name: 'Limit RSVPs' })).toBeChecked();
    // A limit switched on but empty is an error, so nothing is sent yet.
    await expect(indicator(page)).toHaveText('Not saved: fix 1 field');
    await main(page).getByLabel('RSVP Limit').fill('40');
    await main(page).getByLabel('Guests per RSVP').fill('2');
    await expect
      .poll(() => calls.patch.map((r) => r.postDataJSON()).reduce((a, b) => ({ ...a, ...b }), {}), COLD)
      .toEqual({ admissionMode: 'RSVP', rsvpLimit: 40, rsvpMaxPartySize: 2 });
    // Fixed and saved: the footer's save problem goes away (spec 051: no "Saved" line).
    await expect(indicator(page)).toHaveCount(0);
  });

  // Carried over from the old create / edit form specs (retired in 050-P).
  test('admission is a keyboard radio group and tier reorder buttons meet 24 px (WCAG 2.5.8)', async ({ page }) => {
    await mockApi(page, baseEvent({ priceTiers: [tier(), tier({ id: 't-vip', name: 'VIP', displayOrder: 1 })] }));
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    for (const name of ['Move General Admission down', 'Move VIP up']) {
      const box = (await main(page).getByRole('button', { name }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    const ticketed = main(page).getByRole('radio', { name: 'Ticketed' });
    await expect(ticketed).toBeChecked();
    await ticketed.focus();
    await page.keyboard.press('ArrowRight');
    await expect(main(page).getByRole('radio', { name: 'RSVP' })).toBeChecked();
    await expect(main(page).getByRole('switch', { name: 'Limit RSVPs' })).toBeVisible();
    await expect(main(page).getByLabel('Capacity')).toHaveCount(0);
  });

  test('a tier edit saves its fields and cannot drop below what it has sold', async ({ page }) => {
    const calls = await mockApi(page, baseEvent({ priceTiers: [tier({ quantitySold: 50, quantityAvailable: 30 })] }));
    await page.goto(setupUrl('step=tickets&tier=t-ga'));
    const dialog = page.getByRole('dialog', { name: 'Edit Tier 1' });
    await expect(dialog).toBeVisible(COLD);
    await dialog.getByLabel('Quantity *').fill('40');
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Quantity must be at least 50 (sold + reserved)');
    expect(calls.tierPatch).toHaveLength(0);
    // The old Details tier flyout's check: every edited field reaches the PATCH.
    await dialog.getByLabel('Tier Name *').fill('VIP');
    await dialog.getByLabel('Price ($) *').fill('90');
    await dialog.getByLabel('Quantity *').fill('60');
    await dialog.getByLabel('Refundable').check();
    await dialog.getByRole('button', { name: 'Save tier' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.tierPatch).toHaveLength(1);
    expect(calls.tierPatch[0].postDataJSON()).toEqual({ name: 'VIP', price: 90, quantityTotal: 60, isRefundable: true });
  });

  test('an uploaded image offers replace and remove', async ({ page }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAfq3m2wAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://images.test/logo.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await mockApi(page, baseEvent({ logoUrl: 'https://images.test/logo.png', setupStep: 'image' }));
    await page.goto(setupUrl('step=image'));
    await expect(heading(page, 'Add an image')).toBeVisible(COLD);
    await expect(main(page).getByRole('img', { name: 'Spring Fair event image' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Remove image' })).toBeAttached();
    await expect(main(page).getByRole('button', { name: 'Upload new' })).toHaveCount(0);
  });

  test('the admission lock comes from the server, with its reason', async ({ page }) => {
    const reason = "People have RSVP'd, so this event stays RSVP.";
    await mockApi(page, baseEvent({ admissionMode: 'RSVP', capacity: 0, priceTiers: [] }), { lockReason: reason });
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    await expect(main(page).getByRole('radio', { name: 'Ticketed' })).toBeDisabled();
    await expect(main(page).getByText(reason)).toBeVisible();
  });

  test('a mode change the server refuses shows its reason and goes back', async ({ page }) => {
    const reason = 'This event has orders, so it stays ticketed.';
    const calls = await mockApi(page, baseEvent(), { refuseModeChange: reason });
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    await main(page).locator('label').filter({ hasText: /^RSVP$/ }).click();
    await expect.poll(() => calls.patch.length, COLD).toBe(1);
    await expect(main(page).getByText(reason)).toBeVisible();
    await expect(main(page).getByRole('radio', { name: 'Ticketed' })).toBeChecked();
    await expect(main(page).getByRole('radio', { name: 'RSVP' })).toBeDisabled();
    await expect(page.getByText("Couldn't save")).toHaveCount(0);
  });

  test('a sold tier says why it cannot be removed, and can be turned off and on', async ({ page }) => {
    const calls = await mockApi(page, baseEvent({ priceTiers: [tier({ quantitySold: 3, quantityAvailable: 77 })] }));
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    const remove = main(page).getByRole('button', { name: 'Remove General Admission' });
    await expect(remove).toBeDisabled();
    const reason = main(page).getByText("Has orders, so it can't be removed. Turn it off to stop selling it.");
    await expect(reason).toBeVisible();
    await expect(remove).toHaveAttribute('aria-describedby', (await reason.getAttribute('id'))!);
    await main(page).getByRole('button', { name: 'Turn off General Admission' }).click();
    await expect(main(page).getByText('Off sale', { exact: true })).toBeVisible();
    await main(page).getByRole('button', { name: 'Turn on General Admission' }).click();
    await expect(main(page).getByText('Off sale', { exact: true })).toHaveCount(0);
    expect(calls.tierToggle.map((r) => r.url().split('/').pop())).toEqual(['deactivate', 'activate']);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings on the tickets step and its dialog (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page);
      await page.goto(setupUrl('step=tickets'));
      await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      await main(page).getByLabel('Capacity').fill('50');
      await expect(main(page).getByText(/Over capacity/)).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await main(page).getByRole('button', { name: 'Edit General Admission' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  }

  test('no serious axe findings on the describe and image steps', async ({ page }) => {
    await mockApi(page);
    for (const [step, title] of [['description', 'Describe it'], ['image', 'Add an image']]) {
      await page.goto(setupUrl(`step=${step}`));
      await expect(heading(page, title)).toBeVisible(COLD);
      if (step === 'description') await expect(main(page).locator('[contenteditable="true"]')).toBeVisible(COLD);
      await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      expect(await serious(page), step).toEqual([]);
    }
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tickets step at 390 × 844: tier dialog, focus return, axe, no horizontal scroll', async ({ page }) => {
    await mockApi(page);
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    expect(await overflowsAt(page)).toEqual([]);
    const edit = main(page).getByRole('button', { name: 'Edit General Admission' });
    const box = (await edit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Edit Tier 1' });
    await expect(dialog).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(edit).toBeFocused();
    expect(await serious(page)).toEqual([]);
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await overflowsAt(page), `no horizontal scroll at ${width}`).toEqual([]);
    }
  });
});
