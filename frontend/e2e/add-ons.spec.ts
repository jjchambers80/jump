import { expect, test, type Page } from '@playwright/test';
import { LEGAL_VERSIONS, mockLegalVersions } from './helpers/legal';

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
    await mockLegalVersions(page, API);
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
    await expect(page.getByRole('button', { name: 'Continue to payment — $222.49' })).toBeVisible();

    // The legal pages are dark: the sentence names them without linking to a 404 (spec 024 phase 3)
    await expect(page.getByTestId('checkout-terms')).toContainText('Terms of Service');
    await expect(page.getByTestId('checkout-terms').getByRole('link')).toHaveCount(0);

    await page.getByLabel('First Name').fill('Ada');
    await page.getByLabel('Last Name').fill('Buyer');
    await page.getByLabel('Email Address').fill('ada@example.com');
    await page.getByRole('button', { name: /Continue to payment/ }).click();

    await expect.poll(() => orderBody).not.toBeNull();
    expect(orderBody).toMatchObject({
      eventId: EVENT_ID,
      items: [{ priceTierId: VIP.id, quantity: 1 }],
      addOns: [
        { addOnId: LOUNGE.id, quantity: 2 },
        { addOnId: PARKING.id, quantity: 1 },
      ],
      // Spec 024 phase 3: the versions the terms sentence showed ride on the order
      acceptances: [
        { document: 'TERMS', version: LEGAL_VERSIONS.terms },
        { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
      ],
    });
  });
});

// The admin add-on editor (Collect more step) is covered by
// admin-event-setup-add-ons.spec.ts since spec 050-P.
