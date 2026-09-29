// Choose your space (spec 037 phase 5, apply-then-choose; spec 039 modes) on
// the approved vendor's status page. MAP forms: a Map | Spots toggle over the
// public floor map (spec 014's booth picker) and the same spots as a sortable
// list, each spot at its own price. TIERS forms: the approved category, or a
// radio group of space types when the vendor picks. Backend mocked at the network layer
// like public-map.spec.ts. Nothing here marks anything sold itself: "paid"
// appears only once the status poll returns PAID.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-booth';
const EVENT_ID = 'ev-booth';
const APP_ID = 'app-booth-1';
const TOKEN = 'tok-booth';
const TIER = { id: 't-1', name: '10×10 booth', price: 275 };
const OTHER_TIER = { id: 't-2', name: 'Table', price: 95 };

const event = {
  id: EVENT_ID,
  slug: EVENT_ID,
  name: 'Map Expo',
  date: '2027-06-01T15:00:00.000Z',
  status: 'PUBLISHED',
  capacity: 100,
  venue: { id: 've-1', name: 'Hall', address: '1 St', city: 'Raleigh', state: 'NC' },
  priceTiers: [],
  organizationId: ORG_ID,
  organizationName: 'Map Org',
  organizationLogoUrl: null,
  organizationBrandColor: '#b91c1c',
  organizationThemeMode: 'SYSTEM',
  taxRate: 0,
  taxInclusivePricing: false,
};

const noAmounts = { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' };
const amounts = { subtotal: 275, platformFee: 13.75, processingFee: 14.55, tax: 0, applicantPays: 303.3, orgReceives: 275, feeMode: 'PASS', currency: 'usd' };
const profile = { id: 'prof-1', businessName: 'Acme Crafts', description: null, website: null, socials: {}, photos: [] };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

type BoothState = 'AVAILABLE' | 'HELD' | 'SOLD' | 'RESERVED' | 'BLOCKED';

function mapPayload(states: Record<string, BoothState>, version: number) {
  const booth = (id: string, label: string, x: number, tier: typeof TIER | null, vendorName: string | null = null, price: number | null = null) => ({
    id,
    label,
    kind: 'BOOTH',
    x,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    status: states[id] ?? 'AVAILABLE',
    tier,
    vendorName,
    price,
  });
  return {
    id: 'map-1',
    eventId: EVENT_ID,
    name: 'Main hall',
    width: 72,
    height: 20,
    unit: 'ft',
    gridSize: 10,
    layout: { version: 1, elements: [] },
    underlayFileId: null,
    underlayUrl: null,
    underlayOpacity: 40,
    legend: [
      { tierId: TIER.id, name: TIER.name, price: TIER.price, priceFrom: 303.3, priceTo: 404.04, swatch: 0 },
      { tierId: OTHER_TIER.id, name: OTHER_TIER.name, price: OTHER_TIER.price, swatch: 1 },
    ],
    booths: [
      booth('b-1', 'A1', 0, TIER, 'Sold Vendor'),
      booth('b-2', 'A2', 12, TIER),
      booth('b-3', 'A3', 24, null),
      booth('b-4', 'A4', 36, TIER),
      booth('b-5', 'T1', 48, OTHER_TIER),
      // Spec 039: a corner spot with its own (all-in) price.
      booth('b-6', 'A5', 60, TIER, null, 404.04),
    ],
    brandColor: '#b91c1c',
    themeMode: 'SYSTEM',
    updatedAt: '2026-09-21T00:00:00.000Z',
    etag: `"${version}"`,
  };
}

function selection(over: Record<string, unknown> = {}) {
  return {
    mode: 'MAP',
    tierLocked: true,
    categories: null,
    state: 'CHOOSE',
    heldUntil: null,
    dueAt: '2026-10-02T00:00:00.000Z',
    reserveOnApproval: true,
    category: { id: TIER.id, name: TIER.name, description: 'Corner-friendly 10×10 floor space', price: 275, applicantPays: 303.3, feesIncluded: 28.3, tax: 0, spacesLeft: 3, guaranteed: true },
    addOns: [],
    map: { available: true, pending: false, mapId: 'map-1', boothsAvailable: 2, priceFrom: 303.3, priceTo: 404.04 },
    placedBooth: null,
    savedCard: { brand: 'visa', last4: '4242' },
    ...over,
  };
}

function applicantApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    orderRef: null,
    form: { id: 'form-vendor', name: 'Vendor Space', kind: 'PAID' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
    organization: { id: ORG_ID, name: 'Map Org' },
    status: 'APPROVED',
    paymentStatus: 'AWAITING_SELECTION',
    tier: { ...TIER, mapBound: true },
    amounts: noAmounts,
    addOns: [],
    adjustments: [],
    paymentDueAt: '2026-10-02T00:00:00.000Z',
    selection: selection(),
    profile,
    answers: [],
    boothLabel: null,
    booth: null,
    hasCardOnFile: true,
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: '2026-09-17T09:00:00.000Z',
    paidAt: null,
    refundedTotal: 0,
    canWithdraw: false,
    canResume: false,
    canPay: false,
    canUpdateCard: true,
    ...over,
  };
}

const paidApp = (label = 'A2') =>
  applicantApp({ paymentStatus: 'PAID', selection: null, orderRef: 'JMP-BOOTH1', amounts, canPay: false, paidAt: new Date().toISOString(), boothLabel: label, booth: { id: 'b-2', mapId: 'map-1', label, status: 'SOLD', w: 10, h: 10, holdExpiresAt: null } });

interface Scenario {
  app: ReturnType<typeof applicantApp>;
  states: Record<string, BoothState>;
  version: number;
  /** What POST …/select answers: `card` = saved card charged, `no-card` = hold then Checkout, `taken` = 409 once, `declined` = released. */
  choose: 'card' | 'no-card' | 'taken' | 'declined';
}

async function mockVendor(page: Page, scenario: Scenario) {
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const base = { ...scenario, states: { 'b-1': 'SOLD', 'b-3': 'BLOCKED', 'b-4': 'HELD', ...scenario.states } as Record<string, BoothState> };
  await page.route(`${API}/events/${EVENT_ID}/meta`, (route) => route.fulfill(json({ slug: EVENT_ID })));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (route) => route.fulfill(json({ main: [], footer: [] })));
  await page.route(`${API}/events/${EVENT_ID}/map`, (route) => {
    calls.push(`GET map v${base.version}`);
    const etag = `"${base.version}"`;
    if (route.request().headers()['if-none-match'] === etag) return route.fulfill({ status: 304 });
    return route.fulfill(json(mapPayload(base.states, base.version), 200, { 'Cache-Control': 'no-store', ETag: etag }));
  });
  await page.route(`${API}/applications/${APP_ID}/**`, (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}`);
    if (url.searchParams.get('token') !== TOKEN) return route.fulfill(json({ error: 'NotFoundError', message: 'Application not found' }, 404));
    if (url.pathname.endsWith('/status')) return route.fulfill(json(base.app));
    if (url.pathname.endsWith('/select')) {
      const body = route.request().postDataJSON() as { boothId?: string; tierId?: string; addOns: unknown[]; useSavedCard?: boolean };
      bodies.push(body);
      const holdExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const boothId = body.boothId ?? null;
      if (base.choose === 'taken') {
        // Someone else bought it a moment ago: the map has moved on.
        if (boothId) base.states[boothId] = 'SOLD';
        base.version += 1;
        base.choose = 'card';
        return route.fulfill(json({ error: 'ConflictError', message: 'This booth is no longer available', code: 'BOOTH_TAKEN' }, 409));
      }
      if (base.choose === 'declined') {
        // The saved card is declined: the server releases the hold in the same request.
        base.version += 1;
        return route.fulfill(json({ boothId, holdExpiresAt, status: 'AVAILABLE', paymentStatus: 'AWAITING_SELECTION' }));
      }
      if (boothId) base.states[boothId] = 'HELD';
      base.version += 1;
      if (base.choose === 'no-card') {
        base.app = applicantApp({
          paymentStatus: 'PAYMENT_DUE',
          canPay: true,
          hasCardOnFile: false,
          amounts,
          orderRef: 'JMP-BOOTH1',
          selection: selection({ state: 'HELD', heldUntil: holdExpiresAt, savedCard: null }),
          booth: boothId ? { id: boothId, mapId: 'map-1', label: boothId === 'b-6' ? 'A5' : 'A2', status: 'HELD', w: 10, h: 10, holdExpiresAt } : null,
        });
        return route.fulfill(json({ boothId, holdExpiresAt, status: boothId ? 'HELD' : 'AVAILABLE', paymentStatus: 'PAYMENT_DUE', orderRef: 'JMP-BOOTH1' }));
      }
      // Saved card: charged off-session; the webhook lands before the first poll.
      base.app = paidApp();
      if (boothId) base.states[boothId] = 'SOLD';
      base.version += 1;
      return route.fulfill(json({ boothId, holdExpiresAt, status: 'HELD', paymentStatus: 'PROCESSING', orderRef: 'JMP-BOOTH1' }));
    }
    if (url.pathname.endsWith('/pay')) {
      base.app = paidApp();
      return route.fulfill(json({ url: `http://localhost:${process.env.PLAYWRIGHT_PORT || '3001'}/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}&checkout=paid` }));
    }
    if (url.pathname.endsWith('/release')) {
      base.app = applicantApp({ selection: selection({ savedCard: null }), hasCardOnFile: false });
      return route.fulfill(json({ released: true, paymentStatus: 'AWAITING_SELECTION' }));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: 'unmocked' }, 404));
  });
  return { calls, bodies };
}

const statusUrl = `/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}`;

test.describe('choose your space', () => {
  test.describe.configure({ mode: 'serial' });

  test('map: a vendor with a saved card picks an available booth of their category and reaches the paid state', async ({ page }) => {
    const { calls, bodies } = await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'card' });
    await page.goto(statusUrl);
    await expect(page.getByTestId('apply-status-pill')).toHaveText('Approved');
    const choose = page.getByTestId('choose-space');
    await expect(choose).toBeVisible();
    await expect(choose).toContainText('You are approved as 10×10 booth');
    await expect(choose).toContainText('Pick your spot on the floor map');
    await expect(page.getByTestId('space-price-range')).toHaveText('2 spots open · $303.30–$404.04');
    // A MAP form opens on the map; the pay-now button is not offered.
    await expect(page.getByTestId('space-mode-map')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('apply-pay-now')).toHaveCount(0);
    await expect(page.getByTestId('booth-picker-hint')).toContainText('2 booths available in your tier');
    await expect(page.getByTestId('booth-picker-dim-note')).toContainText('other categories');

    // A spot with its own price is priced on its own.
    await page.getByTestId('booth-A5').click();
    await expect(page.getByTestId('booth-buy-summary')).toHaveText('Booth A5 · 10×10 · $404.04 all-in');
    await page.getByTestId('booth-A5').click();

    // Sold, held and blocked booths, and the other category, are not selectable.
    for (const label of ['A1', 'A3', 'A4', 'T1']) {
      const booth = page.getByTestId(`booth-${label}`);
      await expect(booth).toHaveAttribute('aria-disabled', 'true');
      await booth.click({ force: true });
      await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    }

    await page.getByTestId('booth-A2').click();
    const sheet = page.getByTestId('booth-buy-sheet');
    await expect(page.getByTestId('booth-buy-summary')).toHaveText('Booth A2 · 10×10 · $303.30 all-in');
    await expect(sheet).toContainText('card on file is charged');

    await page.getByTestId('booth-buy').click();
    // The status poll returns PAID: the page re-renders as paid with the booth and the chooser goes away.
    await expect(page.getByTestId('apply-payment')).toContainText('Paid', { timeout: 10_000 });
    await expect(page.getByTestId('apply-placement')).toContainText('Booth: A2 · 10×10');
    await expect(page.getByTestId('choose-space')).toHaveCount(0);
    expect(bodies[0]).toEqual({ boothId: 'b-2', addOns: [], useSavedCard: true });
    // Success came from the status poll, never from the hold response.
    expect(calls.filter((c) => c === `GET /applications/${APP_ID}/status`).length).toBeGreaterThanOrEqual(2);
  });

  test('map: paying on Checkout instead holds the booth and follows the pay-now checkout', async ({ page }) => {
    const { calls, bodies } = await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'no-card' });
    await page.goto(statusUrl);
    await page.getByTestId('space-pay-with').getByLabel(/secure checkout page/).check();
    await page.getByTestId('booth-A2').click();
    await expect(page.getByTestId('booth-buy-sheet')).toContainText('secure checkout page');
    await page.getByTestId('booth-buy').click();
    await expect(page).toHaveURL(/checkout=paid/);
    await expect(page.getByTestId('apply-checkout-notice')).toContainText('Payment received');
    expect(bodies[0]).toEqual({ boothId: 'b-2', addOns: [], useSavedCard: false });
    expect(calls.indexOf(`POST /applications/${APP_ID}/pay`)).toBeGreaterThan(calls.indexOf(`POST /applications/${APP_ID}/select`));
  });

  test('map: a booth that was just taken shows the message and refetches the map', async ({ page }) => {
    const { calls } = await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'taken' });
    await page.goto(statusUrl);
    await page.getByTestId('booth-A2').click();
    const mapFetches = () => calls.filter((c) => c.startsWith('GET map')).length;
    const before = mapFetches();
    await page.getByTestId('booth-buy').click();
    await expect(page.getByTestId('booth-picker-notice')).toContainText('That booth was just taken');
    await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-label', /Sold/);
    await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-disabled', 'true');
    expect(mapFetches()).toBeGreaterThan(before);
    await expect(page.getByTestId('booth-picker-hint')).toContainText('1 booth available in your tier');
  });

  test('map: a declined saved card releases the booth and lets the vendor pick again', async ({ page }) => {
    await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'declined' });
    await page.goto(statusUrl);
    await page.getByTestId('booth-A2').click();
    await page.getByTestId('booth-buy').click();
    await expect(page.getByTestId('booth-picker-notice')).toContainText('We could not charge your card');
    await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    await expect(page.getByTestId('apply-payment')).not.toContainText('Paid');
    await expect(page.getByTestId('booth-A2')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('spots: the tabs switch by keyboard; the sortable list holds a priced spot; a held spot counts down and can be given back', async ({ page }) => {
    const { calls, bodies } = await mockVendor(page, { app: applicantApp({ selection: selection({ savedCard: null }), hasCardOnFile: false }), states: {}, version: 1, choose: 'no-card' });
    // Stay on the page: the pay step here is triggered from the held view below.
    await page.goto(statusUrl);
    await page.getByTestId('space-mode-map').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('space-mode-spots')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('space-mode-spots')).toBeFocused();

    // Only open spots of the vendor's category, each at its own price.
    const options = page.getByTestId('spot-option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('Spot A2');
    await expect(options.nth(0)).toContainText('$303.30');
    await expect(options.nth(1)).toContainText('Spot A5');
    await expect(options.nth(1)).toContainText('$404.04');
    await page.getByTestId('spot-sort').selectOption('price');
    await expect(options.nth(0)).toContainText('Spot A2');
    await expect(page.getByTestId('spot-hold')).toBeDisabled();

    await page.getByLabel(/Spot A5/).check();
    await expect(page.getByTestId('spot-total')).toContainText('$404.04');
    await expect(page.getByTestId('spot-hold')).toHaveText('Hold this space and pay $404.04');

    // Hold the spot; the checkout redirect is intercepted by making /pay fail once.
    await page.route(`${API}/applications/${APP_ID}/pay**`, (route) => route.fulfill(json({ error: 'ServiceUnavailable', message: 'Checkout is down for a moment' }, 503)), { times: 1 });
    await page.getByTestId('spot-hold').click();
    await expect(page.getByTestId('space-notice')).toContainText('Checkout is down for a moment');
    expect(bodies[0]).toEqual({ boothId: 'b-6', addOns: [], useSavedCard: false });

    // The refreshed page shows the held spot with its countdown and lines.
    const held = page.locator('[data-testid="choose-space"][data-state="HELD"]');
    await expect(held).toBeVisible();
    await expect(page.getByTestId('space-held-where')).toContainText('Booth A5');
    await expect(page.getByTestId('space-hold-countdown')).toContainText(/Held for 1[45]:\d\d/);

    await page.getByTestId('space-release').click();
    await expect(page.locator('[data-testid="choose-space"][data-state="CHOOSE"]')).toBeVisible();
    expect(calls).toContain(`POST /applications/${APP_ID}/release`);
  });

  test('map form: while the floor plan is unpublished the vendor waits', async ({ page }) => {
    await mockVendor(page, {
      app: applicantApp({ selection: selection({ map: { available: false, pending: true, mapId: null, boothsAvailable: 0, priceFrom: null, priceTo: null } }) }),
      states: {},
      version: 1,
      choose: 'card',
    });
    await page.goto(statusUrl);
    await expect(page.getByTestId('space-map-pending')).toContainText('The floor plan is being updated');
    await expect(page.getByTestId('space-mode-map')).toHaveCount(0);
    await expect(page.getByTestId('space-hold')).toHaveCount(0);
  });

  test('tiers form, category locked: no map, the organizer places the vendor', async ({ page }) => {
    const { bodies } = await mockVendor(page, {
      app: applicantApp({ selection: selection({ mode: 'TIERS', map: { available: false, pending: false, mapId: null, boothsAvailable: 0, priceFrom: null, priceTo: null }, savedCard: null }), hasCardOnFile: false }),
      states: {},
      version: 1,
      choose: 'no-card',
    });
    await page.goto(statusUrl);
    await expect(page.getByTestId('choose-space')).toHaveAttribute('data-mode', 'TIERS');
    await expect(page.getByTestId('space-mode-map')).toHaveCount(0);
    await expect(page.getByTestId('space-list')).toContainText('The organizer assigns your exact spot');
    await expect(page.getByTestId('space-left')).toContainText('Your space is reserved');
    await page.route(`${API}/applications/${APP_ID}/pay**`, (route) => route.fulfill(json({ error: 'ServiceUnavailable', message: 'Checkout is down for a moment' }, 503)), { times: 1 });
    await page.getByTestId('space-hold').click();
    await expect(page.getByTestId('space-notice')).toContainText('Checkout is down for a moment');
    expect(bodies[0]).toEqual({ addOns: [], useSavedCard: false });
  });

  test('tiers form, vendor picks: a radio group of space types, sold out disabled, extras follow the pick', async ({ page }) => {
    const power = { id: 'ao-power', name: 'Power', description: null, price: 25, applicantPays: 27.5, taxable: false, maxPerOrder: 2, remaining: null, soldOut: false };
    const tiers = [
      { id: TIER.id, name: TIER.name, description: 'Indoor floor space', price: 275, applicantPays: 303.3, feesIncluded: 28.3, tax: 0, spacesLeft: 3, guaranteed: false, addOns: [power] },
      { id: 't-3', name: 'Corner', description: null, price: 350, applicantPays: 385.5, feesIncluded: 35.5, tax: 0, spacesLeft: 0, guaranteed: false, addOns: [] },
      { id: OTHER_TIER.id, name: OTHER_TIER.name, description: null, price: 95, applicantPays: 104.6, feesIncluded: 9.6, tax: 0, spacesLeft: 4, guaranteed: false, addOns: [] },
    ];
    const { bodies } = await mockVendor(page, {
      app: applicantApp({
        tier: null,
        selection: selection({ mode: 'TIERS', tierLocked: false, category: null, categories: tiers, addOns: [], map: { available: false, pending: false, mapId: null, boothsAvailable: 0, priceFrom: null, priceTo: null }, savedCard: null }),
        hasCardOnFile: false,
      }),
      states: {},
      version: 1,
      choose: 'no-card',
    });
    await page.goto(statusUrl);
    const choose = page.getByTestId('choose-space');
    await expect(choose).toContainText('Pick the space type that fits you');
    const options = page.getByTestId('space-tier-option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(1)).toContainText('Sold out');
    await expect(page.getByRole('radio', { name: /Corner/ })).toBeDisabled();
    await expect(page.getByTestId('space-hold')).toBeDisabled();
    await expect(page.getByTestId('space-hold')).toHaveText('Pick a space type');

    await page.getByRole('radio', { name: /10×10 booth/ }).check();
    await expect(page.getByTestId('space-total')).toContainText('$303.30');
    await expect(choose).toContainText('Power');
    await page.getByRole('radio', { name: /Table/ }).check();
    await expect(page.getByTestId('space-total')).toContainText('$104.60');
    await expect(choose).not.toContainText('Power');

    await page.route(`${API}/applications/${APP_ID}/pay**`, (route) => route.fulfill(json({ error: 'ServiceUnavailable', message: 'Checkout is down for a moment' }, 503)), { times: 1 });
    await page.getByTestId('space-hold').click();
    await expect(page.getByTestId('space-notice')).toContainText('Checkout is down for a moment');
    expect(bodies[0]).toEqual({ tierId: OTHER_TIER.id, addOns: [], useSavedCard: false });
  });

  test('a booth already placed by staff: no map, the vendor pays for the category from the list', async ({ page }) => {
    await mockVendor(page, {
      app: applicantApp({
        boothLabel: 'A4',
        booth: { id: 'b-4', mapId: 'map-1', label: 'A4', status: 'SOLD', w: 10, h: 10, holdExpiresAt: null },
        selection: selection({ map: { available: false, pending: false, mapId: null, boothsAvailable: 0, priceFrom: null, priceTo: null }, placedBooth: { id: 'b-4', label: 'A4', w: 10, h: 10 }, savedCard: null }),
        hasCardOnFile: false,
      }),
      states: { 'b-4': 'SOLD' },
      version: 1,
      choose: 'no-card',
    });
    await page.goto(statusUrl);
    await expect(page.getByTestId('space-placed-booth')).toContainText('booth A4');
    await expect(page.getByTestId('space-mode-map')).toHaveCount(0);
    await expect(page.getByTestId('space-hold')).toHaveText('Hold this space and pay $303.30');
  });

  test('an application under review shows no chooser, no map and no Buy', async ({ page }) => {
    await mockVendor(page, { app: applicantApp({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', selection: null, canWithdraw: true }), states: {}, version: 1, choose: 'card' });
    await page.goto(statusUrl);
    await expect(page.getByTestId('apply-status-pill')).toHaveText('Submitted');
    await expect(page.getByTestId('apply-payment')).toContainText('Nothing to pay now');
    await expect(page.getByTestId('choose-space')).toHaveCount(0);
    await expect(page.getByTestId('booth-buy')).toHaveCount(0);
    await expect(page.getByTestId('booth-A2')).toHaveCount(0);
  });
});
