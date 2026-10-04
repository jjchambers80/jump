// Map builder › a spot's own price (spec 039 D3), backend mocked. The price is
// optional (empty = the tier's), saved with the layout, marked on the canvas,
// and locked on a spot a vendor holds, owns or was placed on. The backend
// rules are in backend/tests/contract/boothPrices.test.js.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-map-price';
const EVENT_ID = 'evt-map-price';
const MAP_ID = 'map-price';

const booth = (id: string, label: string, x: number, over: Record<string, unknown> = {}) => ({
  id,
  mapId: MAP_ID,
  label,
  kind: 'BOOTH',
  x,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  tierId: 'tier-standard',
  price: null,
  status: 'AVAILABLE',
  applicationId: null,
  assignedById: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  holder: null,
  ...over,
});

const booths = [
  booth('b-a1', 'A1', 0),
  booth('b-a2', 'A2', 12, { price: 400 }),
  booth('b-a3', 'A3', 24, { status: 'SOLD', applicationId: 'app-1', holder: { id: 'app-1', status: 'APPROVED', paymentStatus: 'PAID', businessName: 'Vendor One' } }),
];

const mapDetail = {
  id: MAP_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: 'Price Hall',
  status: 'DRAFT',
  unit: 'ft',
  gridSize: 10,
  width: 50,
  height: 40,
  underlayFileId: null,
  underlayOpacity: 40,
  layout: { version: 1, elements: [] },
  publishedAt: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  booths,
  tiers: [{ id: 'tier-standard', name: 'Standard', price: 250, mapBound: true, quantityTotal: 3, form: { id: 'form-v', name: 'Vendors', slug: 'vendors' }, displayOrder: 0 }],
};

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openBuilder(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'price-admin', email: 'price-admin@test.com', role: 'ADMIN' }, baseURL);
  const saved: { booths: { label: string; price?: number | null }[] }[] = [];
  await page.route(`${API}/admin/**`, (route) => route.fulfill(json({ data: [] })));
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Price Org', slug: 'price-org', status: 'ACTIVE' }])));
  await page.route(`${API}/admin/maps/${MAP_ID}`, (route) => route.fulfill(json(mapDetail)));
  await page.route(`${API}/admin/maps/${MAP_ID}/layout`, (route) => {
    const body = route.request().postDataJSON() as { booths: { label: string; price?: number | null }[] };
    saved.push(body);
    // Echo like MapService.replaceLayout: the stored rows, with the new prices.
    return route.fulfill(json({ ...mapDetail, booths: booths.map((b) => ({ ...b, price: body.booths.find((x) => x.label === b.label)?.price ?? null })) }));
  });
  await page.goto(`/admin/maps/${MAP_ID}`);
  await expect(page.getByRole('heading', { name: 'Price Hall' })).toBeVisible();
  return { saved };
}

async function selectBooth(page: Page, label: string) {
  await page.getByTestId(`booth-${label}`).click();
  await expect(page.getByRole('heading', { name: `Booth ${label}` })).toBeVisible();
}

test('a spot gets its own price, is marked on the canvas and can go back to the tier price', async ({ page, baseURL }) => {
  const { saved } = await openBuilder(page, baseURL!);
  // A2 already carries a price: marked; A1 does not.
  await expect(page.getByTestId('booth-price-badge-A2')).toBeAttached();
  await expect(page.getByTestId('booth-price-badge-A1')).toHaveCount(0);

  await selectBooth(page, 'A1');
  const price = page.getByTestId('booth-price-input');
  await expect(price).toHaveValue('');
  await expect(price).toHaveAttribute('placeholder', 'Tier price $250.00');
  await price.fill('abc');
  await price.press('Enter');
  await expect(page.getByText('Enter a price like 250 or 249.99')).toBeVisible();
  await price.fill('$325');
  await price.press('Enter');
  await expect(price).toHaveValue('325.00');
  await expect(page.getByTestId('booth-price-badge-A1')).toBeAttached();
  await expect.poll(() => saved.at(-1)?.booths.find((b) => b.label === 'A1')?.price, { timeout: 10_000 }).toBe(325);
  // The other spots keep what they had.
  expect(saved.at(-1)?.booths.find((b) => b.label === 'A2')?.price).toBe(400);

  await page.getByTestId('booth-price-reset').click();
  await expect(price).toHaveValue('');
  await expect(page.getByTestId('booth-price-badge-A1')).toHaveCount(0);
  await expect.poll(() => saved.at(-1)?.booths.find((b) => b.label === 'A1')?.price, { timeout: 10_000 }).toBeNull();
});

test("a sold spot's price is locked", async ({ page, baseURL }) => {
  await openBuilder(page, baseURL!);
  await selectBooth(page, 'A3');
  await expect(page.getByTestId('booth-price-input')).toBeDisabled();
  await expect(page.getByText('its price is locked')).toBeVisible();
});

test('several spots take one price; held, sold or placed ones keep theirs', async ({ page, baseURL }) => {
  const { saved } = await openBuilder(page, baseURL!);
  await page.getByTestId('booth-A1').click();
  await page.getByTestId('booth-A2').click({ modifiers: ['Shift'] });
  await page.getByTestId('booth-A3').click({ modifiers: ['Shift'] });
  const multi = page.getByTestId('multi-price-input');
  await expect(page.getByText('Spot price for 2 booths')).toBeVisible();
  await expect(multi).toHaveAttribute('placeholder', 'Mixed');
  await expect(page.getByText('1 held, sold or placed spot keeps its price.')).toBeVisible();
  await multi.fill('300');
  await multi.press('Enter');
  await expect
    .poll(() => (saved.at(-1)?.booths ?? []).map((b) => [b.label, b.price]), { timeout: 10_000 })
    .toEqual([
      ['A1', 300],
      ['A2', 300],
      ['A3', null],
    ]);
});
