// Vendor booth purchase (spec 014 phase 2): the approved-vendor status page
// mounts the booth picker over the public map — backend mocked at the network
// layer like public-map.spec.ts. The picker never marks anything sold itself:
// "paid" appears only once the status poll returns PAID.

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

const amounts = { subtotal: 275, platformFee: 13.75, processingFee: 14.55, tax: 0, applicantPays: 303.3, orgReceives: 275, feeMode: 'PASS', currency: 'usd' };
const profile = { id: 'prof-1', businessName: 'Acme Crafts', description: null, website: null, socials: {}, photos: [] };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

type BoothState = 'AVAILABLE' | 'HELD' | 'SOLD' | 'RESERVED' | 'BLOCKED';

function mapPayload(states: Record<string, BoothState>, version: number) {
  const booth = (id: string, label: string, x: number, tier: typeof TIER | null, vendorName: string | null = null) => ({
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
  });
  return {
    id: 'map-1',
    eventId: EVENT_ID,
    name: 'Main hall',
    width: 60,
    height: 20,
    unit: 'ft',
    gridSize: 10,
    layout: { version: 1, elements: [] },
    underlayFileId: null,
    underlayUrl: null,
    underlayOpacity: 40,
    legend: [
      { tierId: TIER.id, name: TIER.name, price: TIER.price, swatch: 0 },
      { tierId: OTHER_TIER.id, name: OTHER_TIER.name, price: OTHER_TIER.price, swatch: 1 },
    ],
    booths: [
      booth('b-1', 'A1', 0, TIER, 'Sold Vendor'),
      booth('b-2', 'A2', 12, TIER),
      booth('b-3', 'A3', 24, null),
      booth('b-4', 'A4', 36, TIER),
      booth('b-5', 'T1', 48, OTHER_TIER),
    ],
    brandColor: '#b91c1c',
    themeMode: 'SYSTEM',
    updatedAt: '2026-09-21T00:00:00.000Z',
    etag: `"${version}"`,
  };
}

function applicantApp(over: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    orderRef: 'JMP-BOOTH1',
    form: { id: 'form-vendor', name: 'Vendor Space', kind: 'PAID' },
    event: { id: EVENT_ID, name: event.name, date: event.date },
    organization: { id: ORG_ID, name: 'Map Org' },
    status: 'APPROVED',
    paymentStatus: 'PAYMENT_DUE',
    tier: { ...TIER, mapBound: true },
    amounts,
    addOns: [],
    adjustments: [],
    paymentDueAt: '2026-09-28T00:00:00.000Z',
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
    canPay: true,
    canUpdateCard: true,
    ...over,
  };
}

interface Scenario {
  app: ReturnType<typeof applicantApp>;
  states: Record<string, BoothState>;
  version: number;
  /** What POST …/booth answers; `taken` = 409 BOOTH_TAKEN once, `declined` = a card-on-file decline (200, booth released). */
  choose: 'card' | 'no-card' | 'taken' | 'declined';
}

async function mockVendor(page: Page, scenario: Scenario) {
  const calls: string[] = [];
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
    if (url.pathname.endsWith('/booth')) {
      const { boothId } = route.request().postDataJSON() as { boothId: string };
      if (base.choose === 'taken') {
        // Someone else bought it a moment ago: the map has moved on.
        base.states[boothId] = 'SOLD';
        base.version += 1;
        base.choose = 'card';
        return route.fulfill(json({ error: 'ConflictError', message: 'This booth is no longer available', code: 'BOOTH_TAKEN' }, 409));
      }
      if (base.choose === 'declined') {
        // Card on file, but the off-session charge is declined: the server
        // releases the hold in the same request and reports it as available.
        base.version += 1;
        return route.fulfill(json({ boothId, holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), status: 'AVAILABLE', paymentStatus: 'PAYMENT_DUE' }));
      }
      base.states[boothId] = 'HELD';
      base.version += 1;
      const holdExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      if (base.choose === 'no-card') {
        base.app = applicantApp({ ...base.app, hasCardOnFile: false, booth: { id: boothId, mapId: 'map-1', label: 'A2', status: 'HELD', w: 10, h: 10, holdExpiresAt } });
        return route.fulfill(json({ boothId, holdExpiresAt, status: 'HELD', paymentStatus: 'PAYMENT_DUE' }));
      }
      // Card on file: charged off-session; the webhook lands before the first poll.
      base.app = applicantApp({ paymentStatus: 'PAID', canPay: false, paidAt: new Date().toISOString(), boothLabel: 'A2', booth: { id: boothId, mapId: 'map-1', label: 'A2', status: 'SOLD', w: 10, h: 10, holdExpiresAt: null } });
      base.states[boothId] = 'SOLD';
      base.version += 1;
      return route.fulfill(json({ boothId, holdExpiresAt, status: 'HELD', paymentStatus: 'PROCESSING' }));
    }
    if (url.pathname.endsWith('/pay')) {
      base.app = applicantApp({ paymentStatus: 'PAID', canPay: false, paidAt: new Date().toISOString(), boothLabel: 'A2', booth: { id: 'b-2', mapId: 'map-1', label: 'A2', status: 'SOLD', w: 10, h: 10, holdExpiresAt: null } });
      return route.fulfill(json({ url: `http://localhost:${process.env.PLAYWRIGHT_PORT || '3001'}/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}&checkout=paid` }));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: 'unmocked' }, 404));
  });
  return calls;
}

const statusUrl = `/events/${EVENT_ID}/apply/status/${APP_ID}?token=${TOKEN}`;

test.describe('vendor booth purchase', () => {
  test.describe.configure({ mode: 'serial' });

  test('an approved vendor with a card on file picks an available booth and reaches the paid state', async ({ page }) => {
    const calls = await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'card' });
    await page.goto(statusUrl);
    await expect(page.getByTestId('apply-status-pill')).toHaveText('Approved');
    const picker = page.getByTestId('booth-picker');
    await expect(picker).toBeVisible();
    // The plain pay-now button yields to the picker while a booth must be chosen.
    await expect(page.getByTestId('apply-pay-now')).toHaveCount(0);
    await expect(page.getByTestId('booth-picker-hint')).toContainText('1 booth available in your tier');

    // Sold, held and blocked booths, and the other tier, are not selectable.
    for (const label of ['A1', 'A3', 'A4', 'T1']) {
      const booth = page.getByTestId(`booth-${label}`);
      await expect(booth).toHaveAttribute('aria-disabled', 'true');
      await booth.click({ force: true });
      await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    }

    const available = page.getByTestId('booth-A2');
    await expect(available).not.toHaveAttribute('aria-disabled', 'true');
    await available.click();
    const sheet = page.getByTestId('booth-buy-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('booth-buy-summary')).toHaveText('Booth A2 · 10×10 · $303.30 all-in');
    await expect(sheet).toContainText('card on file is charged');

    await page.getByTestId('booth-buy').click();
    await expect(page.getByTestId('booth-charging')).toContainText('Charging your card');
    // The status poll returns PAID: the page re-renders as paid with the booth and the picker goes away.
    await expect(page.getByTestId('apply-payment')).toContainText('Paid', { timeout: 10_000 });
    await expect(page.getByTestId('apply-placement')).toContainText('Booth: A2 · 10×10');
    await expect(page.getByTestId('booth-picker')).toHaveCount(0);
    expect(calls).toContain(`POST /applications/${APP_ID}/booth`);
    // Success came from the status poll, never from the hold response.
    expect(calls.filter((c) => c === `GET /applications/${APP_ID}/status`).length).toBeGreaterThanOrEqual(2);
  });

  test('without a card on file the picker holds the booth and follows the pay-now checkout', async ({ page }) => {
    const calls = await mockVendor(page, { app: applicantApp({ hasCardOnFile: false }), states: {}, version: 1, choose: 'no-card' });
    await page.goto(statusUrl);
    await page.getByTestId('booth-A2').click();
    await expect(page.getByTestId('booth-buy-sheet')).toContainText('secure checkout page');
    await page.getByTestId('booth-buy').click();
    // "Stripe" sends the vendor straight back with the outcome.
    await expect(page).toHaveURL(/checkout=paid/);
    await expect(page.getByTestId('apply-checkout-notice')).toContainText('Payment received');
    expect(calls).toContain(`POST /applications/${APP_ID}/booth`);
    expect(calls).toContain(`POST /applications/${APP_ID}/pay`);
    expect(calls.indexOf(`POST /applications/${APP_ID}/pay`)).toBeGreaterThan(calls.indexOf(`POST /applications/${APP_ID}/booth`));
  });

  test('a booth that was just taken shows the message and refetches the map', async ({ page }) => {
    const calls = await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'taken' });
    await page.goto(statusUrl);
    await page.getByTestId('booth-A2').click();
    const mapFetches = () => calls.filter((c) => c.startsWith('GET map')).length;
    const before = mapFetches();
    await page.getByTestId('booth-buy').click();
    const notice = page.getByTestId('booth-picker-notice');
    await expect(notice).toContainText('That booth was just taken');
    await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    // The refetch brought the new state: A2 is sold now and cannot be picked again.
    await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-label', /Sold/);
    await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-disabled', 'true');
    expect(mapFetches()).toBeGreaterThan(before);
    await expect(page.getByTestId('booth-picker-hint')).toContainText('No booths are left');
  });

  test('a declined card on file releases the booth and lets the vendor pick again', async ({ page }) => {
    await mockVendor(page, { app: applicantApp(), states: {}, version: 1, choose: 'declined' });
    await page.goto(statusUrl);
    await page.getByTestId('booth-A2').click();
    await page.getByTestId('booth-buy').click();
    const notice = page.getByTestId('booth-picker-notice');
    await expect(notice).toContainText('We could not charge your card');
    // The buy sheet closes and the booth is selectable again — nothing was sold.
    await expect(page.getByTestId('booth-buy-sheet')).toHaveCount(0);
    await expect(page.getByTestId('apply-payment')).not.toContainText('Paid');
    await expect(page.getByTestId('booth-A2')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a booth already placed by staff keeps the plain pay button', async ({ page }) => {
    await mockVendor(page, {
      app: applicantApp({ boothLabel: 'A4', booth: { id: 'b-4', mapId: 'map-1', label: 'A4', status: 'SOLD', w: 10, h: 10, holdExpiresAt: null } }),
      states: { 'b-4': 'SOLD' },
      version: 1,
      choose: 'card',
    });
    await page.goto(statusUrl);
    await expect(page.getByTestId('apply-placement')).toContainText('Booth: A4 · 10×10');
    await expect(page.getByTestId('apply-pay-now')).toBeVisible();
    await expect(page.getByTestId('booth-picker')).toHaveCount(0);
  });

  test('an application that is not approved shows no map and no Buy', async ({ page }) => {
    await mockVendor(page, { app: applicantApp({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', canPay: false, canWithdraw: true }), states: {}, version: 1, choose: 'card' });
    await page.goto(statusUrl);
    await expect(page.getByTestId('apply-status-pill')).toHaveText('Submitted');
    await expect(page.getByTestId('booth-picker')).toHaveCount(0);
    await expect(page.getByTestId('booth-buy')).toHaveCount(0);
    await expect(page.getByTestId('booth-A2')).toHaveCount(0);
  });
});
