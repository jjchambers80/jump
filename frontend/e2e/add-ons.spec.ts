import { expect, test, type Page } from '@playwright/test';

// Add-ons on the storefront (spec 012 phase 1): the picker appears once a
// ticket that offers an add-on is in the cart, add-on lines join the cart
// and totals, and checkout carries them to POST /orders.

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const DESKTOP = { width: 1440, height: 900 };
const EVENT_ID = 'evt-add-ons';

const GA = { id: 'tier-ga', name: 'General Admission', price: 50 };
const VIP = { id: 'tier-vip', name: 'VIP', price: 100 };

const PARKING = {
  id: 'addon-parking',
  name: 'Parking pass',
  description: 'One vehicle for the day',
  price: 15,
  taxable: true,
  maxPerOrder: null,
  remaining: null,
  soldOut: false,
  allTiers: true,
  priceTierIds: null,
};
const LOUNGE = {
  id: 'addon-lounge',
  name: 'VIP lounge',
  description: null,
  price: 40,
  taxable: false,
  maxPerOrder: 2,
  remaining: 2,
  soldOut: false,
  allTiers: false,
  priceTierIds: [VIP.id],
};

function eventResponse() {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Add-ons Test Event',
    description: 'Fixture for storefront add-ons.',
    date: future.toISOString(),
    taxRate: 0.1,
    organizationBrandColor: null,
    organizationThemeMode: 'LIGHT',
    venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St' },
    priceTiers: [GA, VIP].map((tier) => ({
      ...tier,
      description: null,
      quantityTotal: 100,
      quantityAvailable: 100,
      isActive: true,
      isRefundable: true,
      minPerOrder: 1,
      maxPerOrder: 10,
    })),
    addOns: [PARKING, LOUNGE],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function mockEvent(page: Page) {
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventResponse()) })
  );
  await page.route(`${API}/events/${EVENT_ID}/applications/forms`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );
}

function dollars(text: string | null): number {
  return Number.parseFloat((text ?? '').replace(/[^0-9.]/g, ''));
}

test.describe('storefront add-ons', () => {
  test.use({ viewport: DESKTOP });

  test('picker follows the cart tiers and lines join the order summary', async ({ page }) => {
    await mockEvent(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('heading', { name: 'Add-ons Test Event' })).toBeVisible();

    // No ticket yet → no picker
    await expect(page.getByTestId('add-on-picker')).toHaveCount(0);

    // GA ticket → parking (all tiers) offered, lounge (VIP only) not
    await page.getByRole('button', { name: `Increase ${GA.name} quantity` }).click();
    const picker = page.getByTestId('add-on-picker');
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId(`add-on-${PARKING.id}`)).toBeVisible();
    await expect(picker.getByTestId(`add-on-${LOUNGE.id}`)).toHaveCount(0);

    // All-in unit price for parking: 15 + 5% + (15.75 × 2.9% + 0.30) + 10% tax = 15 + 0.75 + 0.76 + 1.50 = 18.01
    await expect(picker.getByTestId(`add-on-${PARKING.id}`)).toContainText('$18.01');

    // VIP ticket → lounge appears; max 2 per order
    await page.getByRole('button', { name: `Increase ${VIP.name} quantity` }).click();
    await expect(picker.getByTestId(`add-on-${LOUNGE.id}`)).toBeVisible();
    const loungePlus = picker.getByRole('button', { name: `Increase ${LOUNGE.name} quantity` });
    await loungePlus.click();
    await loungePlus.click();
    await expect(loungePlus).toBeDisabled();
    await expect(picker.getByLabel(`${LOUNGE.name} quantity`, { exact: true })).toHaveText('2');

    await picker.getByRole('button', { name: `Increase ${PARKING.name} quantity` }).click();

    // Cart: GA, VIP, lounge ×2, parking ×1 — four lines, total matches the fee math
    const lines = page.getByTestId('cart-lines-desktop').getByTestId('cart-line');
    await expect(lines).toHaveCount(4);
    await expect(page.getByTestId('cart-lines-desktop')).toContainText('VIP lounge');
    await expect(page.getByTestId('cart-lines-desktop')).toContainText('Parking pass');
    // listed 50 + 100 + 80 + 15 = 245; tax 10% on 165 (lounge untaxed) = 16.50;
    // platform 12.25; processing (257.25 × 2.9% + 0.30) = 7.76; total 281.51
    const summary = page.getByTestId('cart-lines-desktop').locator('..');
    await expect(summary).toContainText('$281.51');

    // Removing the VIP ticket drops the lounge from the picker and the cart
    await page.getByRole('button', { name: `Decrease ${VIP.name} quantity` }).click();
    await expect(picker.getByTestId(`add-on-${LOUNGE.id}`)).toHaveCount(0);
    await expect(lines).toHaveCount(2);

    // Checkout carries the add-on lines
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout\//);
    const url = new URL(page.url());
    expect(JSON.parse(url.searchParams.get('addOns') ?? '[]')).toEqual([{ addOnId: PARKING.id, quantity: 1 }]);
  });

  test('checkout shows add-on lines and sends them to POST /orders', async ({ page }) => {
    await mockEvent(page);
    let orderBody: Record<string, unknown> | null = null;
    await page.route(`${API}/orders`, async (route) => {
      orderBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ orderId: 'ord-1', orderRef: 'JMP-ADDON', stripeCheckoutUrl: `/events/${EVENT_ID}`, totalAmount: 1 }),
      });
    });

    const items = JSON.stringify([{ priceTierId: VIP.id, quantity: 1 }]);
    const addOns = JSON.stringify([
      { addOnId: LOUNGE.id, quantity: 2 },
      { addOnId: PARKING.id, quantity: 1 },
    ]);
    await page.goto(`/checkout/${EVENT_ID}?items=${encodeURIComponent(items)}&addOns=${encodeURIComponent(addOns)}`);

    const lines = page.getByTestId('cart-lines-checkout').getByTestId('cart-line');
    await expect(lines).toHaveCount(3);
    await expect(page.getByTestId('cart-lines-checkout')).toContainText('VIP lounge');
    // 100 + 80 + 15 = 195 listed; tax on 115 = 11.50; platform 9.75; processing (204.75 × 2.9% + 0.30) = 6.24; total 222.49
    await expect(page.getByRole('button', { name: 'Proceed to Payment — $222.49' })).toBeVisible();

    await page.getByLabel('First Name').fill('Ada');
    await page.getByLabel('Last Name').fill('Buyer');
    await page.getByLabel('Email Address').fill('ada@example.com');
    await page.getByRole('button', { name: /Proceed to Payment/ }).click();

    await expect.poll(() => orderBody).not.toBeNull();
    expect(orderBody).toMatchObject({
      eventId: EVENT_ID,
      items: [{ priceTierId: VIP.id, quantity: 1 }],
      addOns: [
        { addOnId: LOUNGE.id, quantity: 2 },
        { addOnId: PARKING.id, quantity: 1 },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Admin › Event › Edit › Add-ons section (mocked API)
// ---------------------------------------------------------------------------

import { signInAsStaff } from './helpers/session';

const ORG_ID = 'org-add-ons';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

function adminAddOn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'addon-parking',
    name: 'Parking pass',
    description: null,
    price: 15,
    taxable: true,
    maxPerOrder: null,
    remaining: null,
    soldOut: false,
    allTiers: true,
    priceTierIds: [],
    applicationTierIds: [],
    scope: 'TICKET',
    quantityTotal: null,
    quantitySold: 3,
    quantityReserved: 1,
    isActive: true,
    displayOrder: 0,
    orderLineCount: 3,
    applicationLineCount: 0,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

test.describe('admin add-ons section', () => {
  test.use({ viewport: DESKTOP });

  test('ADMIN lists add-ons, creates one from a preset, and sees sales counts', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'addons-admin', email: 'addons-admin@test.com', role: 'ADMIN' }, baseURL!);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const event = {
      id: EVENT_ID,
      name: 'Add-ons Test Event',
      description: '',
      date: future.toISOString(),
      capacity: 200,
      category: 'music',
      status: 'PUBLISHED',
      logoUrl: null,
      venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St' },
      tax: { rate: 0.1, source: 'MANUAL', region: 'NC' },
      priceTiers: [GA, VIP].map((t, i) => ({ ...t, description: null, quantityTotal: 100, quantitySold: 0, quantityReserved: 0, displayOrder: i, minPerOrder: null, maxPerOrder: null, isActive: true, isRefundable: true, saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC' })),
    };
    await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Add-ons Org', status: 'ACTIVE' }])));
    await page.route(`${API}/organizations/${ORG_ID}/events?limit=100`, (route) => route.fulfill(json({ events: [event] })));
    await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([event.venue])));
    await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));

    const addOns = [adminAddOn()];
    let created: Record<string, unknown> | null = null;
    await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/presets`, (route) =>
      route.fulfill(json({ presets: [{ key: 'vip', name: 'VIP lounge', description: 'Lounge access for one attendee', price: 50, scope: 'TICKET' }] }))
    );
    await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons`, async (route) => {
      if (route.request().method() === 'POST') {
        created = route.request().postDataJSON();
        addOns.push(adminAddOn({ id: 'addon-vip', name: 'VIP lounge', price: 50, quantitySold: 0, quantityReserved: 0, orderLineCount: 0, allTiers: false, priceTierIds: [VIP.id], displayOrder: 1 }));
        return route.fulfill(json(addOns[1], 201));
      }
      return route.fulfill(json({ addOns }));
    });

    await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);
    const section = page.getByTestId('add-ons-section');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('admin-add-on-addon-parking')).toContainText('Sold 3');
    await expect(section.getByTestId('admin-add-on-addon-parking')).toContainText('reserved 1');
    await expect(section.getByTestId('admin-add-on-addon-parking')).toContainText('buyer pays $18.01');

    await section.getByRole('button', { name: 'Add from Preset' }).click();
    await section.getByRole('button', { name: /VIP lounge/ }).click();
    const dialog = page.getByTestId('add-on-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('VIP lounge');
    await dialog.getByLabel('Only these tiers').check();
    await dialog.getByLabel('VIP', { exact: true }).check();
    await dialog.getByLabel('Max per order').fill('2');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => created).not.toBeNull();
    expect(created).toMatchObject({ name: 'VIP lounge', price: 50, scope: 'TICKET', allTiers: false, priceTierIds: [VIP.id], maxPerOrder: 2, taxable: true });
    await expect(section.getByTestId('admin-add-on-addon-vip')).toContainText('tiers: VIP');
  });

  test('ORGANIZER sees add-ons read-only', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'addons-org', email: 'addons-org@test.com', role: 'ORGANIZER' }, baseURL!);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const event = { id: EVENT_ID, name: 'Add-ons Test Event', description: '', date: future.toISOString(), capacity: 200, category: 'music', status: 'PUBLISHED', logoUrl: null, venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St' }, priceTiers: [] };
    await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Add-ons Org', status: 'ACTIVE' }])));
    await page.route(`${API}/organizations/${ORG_ID}/events?limit=100`, (route) => route.fulfill(json({ events: [event] })));
    await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([event.venue])));
    await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
    await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/presets`, (route) => route.fulfill(json({ presets: [] })));
    await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons`, (route) => route.fulfill(json({ addOns: [adminAddOn()] })));

    await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);
    const section = page.getByTestId('add-ons-section');
    await expect(section.getByTestId('admin-add-on-addon-parking')).toBeVisible();
    await expect(section.getByRole('button', { name: '+ Add Add-on' })).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });
});
