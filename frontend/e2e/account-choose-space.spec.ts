// Buyer account (spec 031) › Applications: an approved MAP-form vendor
// chooses their spot inline with the stacked SpotWorkspace (PR #240). The
// application row stacks on phones instead of crushing its details beside the
// actions. Backend and buyer proxies mocked.

import { expect, test, type Page } from '@playwright/test';
const API = 'http://localhost:3002';
const ORG_ID = 'org-a', EV = 'ev-s', APP = 'app-s';
const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
const ORG = { id: ORG_ID, name: 'Raleigh Retro Gamers', logoUrl: null, coverUrl: null, brandColor: '#4338ca', themeMode: 'SYSTEM', buyerSignInLinks: true };
const FOOD = { id: 't-food', name: 'Food truck', price: 100 }, SMOKE = { id: 't-smoke', name: 'Smoke Test Booth', price: 25 };
const b = (id: string, label: string, x: number, y: number, w: number, h: number, tier: any, status = 'AVAILABLE', price: number | null = null) => ({ id, label, kind: 'BOOTH', x, y, w, h, rotation: 0, status, tier, vendorName: null, price, listedPrice: price ? price - 10 : null });
const map = { id: 'm', eventId: EV, name: 'Hall', width: 80, height: 50, unit: 'ft', gridSize: 10, layout: { version: 1, elements: [] }, underlayFileId: null, underlayUrl: null, underlayOpacity: 40,
  legend: [{ tierId: SMOKE.id, name: SMOKE.name, price: 27.31, swatch: 0 }, { tierId: FOOD.id, name: FOOD.name, price: 108.35, priceFrom: 108.35, priceTo: 158.42, swatch: 1 }],
  booths: [b('1','B1',8,8,10,10,SMOKE), b('2','B2',20,8,10,10,SMOKE,'SOLD'), b('3','B3',32,8,10,10,SMOKE), b('4','B4',44,8,10,10,SMOKE), b('5','T1',8,24,15,10,FOOD,'AVAILABLE',108.35), b('6','T2',26,24,15,10,FOOD,'AVAILABLE',158.42), b('7','T3',44,24,15,10,FOOD,'SOLD'), b('8','T4',8,38,15,10,FOOD,'AVAILABLE',135.36)],
  vendors: [], brandColor: '#4338ca', themeMode: 'SYSTEM', updatedAt: '2026-09-21T00:00:00.000Z', etag: '"1"' };
const parking = { id: 'ao-p', name: 'Parking', description: 'This is a description for parking', price: 20, applicantPays: 23.36, taxable: false, maxPerOrder: 4, remaining: null, soldOut: false };
const app = { id: APP, orderRef: null, form: { id: 'f', name: 'TEST map vendors (pick a spot)', kind: 'PAID' }, event: { id: EV, name: 'TEST — Game and Geek copy (delete me)', date: '2027-11-20T14:00:00.000Z', timezone: 'America/New_York' }, organization: { id: ORG_ID, name: 'x' }, status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', tier: { ...FOOD, mapBound: true }, amounts: { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' }, addOns: [], adjustments: [], paymentDueAt: '2026-10-06T00:00:00.000Z',
  selection: { mode: 'MAP', tierLocked: true, categories: null, state: 'CHOOSE', heldUntil: null, dueAt: '2026-10-06T00:00:00.000Z', reserveOnApproval: true, category: { id: FOOD.id, name: FOOD.name, description: null, price: 100, applicantPays: 108.35, feesIncluded: 8.35, tax: 0, spacesLeft: 3, guaranteed: true }, addOns: [parking], map: { available: true, pending: false, mapId: 'm', boothsAvailable: 3, priceFrom: 108.35, priceTo: 158.42 }, placedBooth: null, savedCard: { brand: 'visa', last4: '4242' } },
  profile: { id: 'p', businessName: 'hoedidly', description: null, website: null, socials: {}, photos: [] }, answers: [], boothLabel: null, booth: null, hasCardOnFile: true, submittedAt: '2026-09-29T21:26:00.000Z', decidedAt: '2026-09-29T21:27:00.000Z', paidAt: null, refundedTotal: 0, canWithdraw: true, canResume: false, canPay: false, canUpdateCard: true };

async function mockAccount(page: Page) {
  const selects: unknown[] = [];
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (r) => r.fulfill(json({ main: [], footer: [] })));
  await page.route('**/api/buyer/me', (r) => r.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'L', organization: { id: ORG_ID, name: 'x' } })));
  await page.route('**/api/buyer/me/orders', (r) => r.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/tickets', (r) => r.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/applications', (r) => r.fulfill(json({ data: [app] })));
  await page.route('**/api/buyer/me/applicant-profile', (r) => r.fulfill(json(null)));
  await page.route(`${API}/events/${EV}/map`, (r) => r.fulfill(json(map)));
  await page.route(`**/api/buyer/me/applications/${APP}/select`, (r) => {
    selects.push(r.request().postDataJSON());
    return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'ConflictError', code: 'BOOTH_TAKEN', message: 'taken' }) });
  });
  return selects;
}

test('phone: the application row stacks, and the inline chooser runs spot → extras and payment', async ({ page }) => {
  const selects = await mockAccount(page);
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`/organizations/${ORG_ID}/account/applications`);
  const section = page.getByTestId('account-applications');
  await expect(section).toContainText('TEST map vendors (pick a spot)');
  // The actions sit under the details, so the title is not squeezed into a one-word column.
  const choose = page.getByTestId('account-application-choose-space');
  const title = section.getByText(/TEST — Game and Geek copy/).first();
  const [titleBox, chooseBox] = [await title.boundingBox(), await choose.boundingBox()];
  expect(titleBox && chooseBox && chooseBox.y > titleBox.y + titleBox.height - 1 && titleBox.width > 250).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await choose.click();
  const workspace = page.getByTestId('choose-space');
  await expect(workspace).toHaveAttribute('data-step', 'spot');
  await expect(page.getByTestId('spot-option')).toHaveCount(3);
  await expect(page.getByTestId('spot-other')).toHaveCount(4);
  await page.getByTestId('booth-T2').click();
  await expect(page.getByRole('radio', { name: /Spot T2/ })).toBeChecked();
  await page.getByTestId('space-continue').click();
  await expect(workspace).toHaveAttribute('data-step', 'review');
  await expect(page.getByTestId('add-on-ao-p')).toBeVisible();
  await expect(page.getByTestId('space-hold')).toHaveText('Pay $158.42 with Visa ending 4242');
  await page.getByTestId('space-hold').click();
  await expect(page.getByTestId('space-notice')).toContainText('That spot was just taken');
  await expect(workspace).toHaveAttribute('data-step', 'spot');
  expect(selects[0]).toEqual({ boothId: '6', addOns: [], useSavedCard: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('desktop: the application row keeps details and actions on one line', async ({ page }) => {
  await mockAccount(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/organizations/${ORG_ID}/account/applications`);
  const choose = page.getByTestId('account-application-choose-space');
  const title = page.getByTestId('account-applications').getByText(/TEST — Game and Geek copy/).first();
  const [titleBox, chooseBox] = [await title.boundingBox(), await choose.boundingBox()];
  expect(titleBox && chooseBox && chooseBox.x > titleBox.x + titleBox.width - 1).toBe(true);
});
