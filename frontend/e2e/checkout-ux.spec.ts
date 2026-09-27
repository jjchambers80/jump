// Checkout conversion + accessibility (checkout UX audit): the pay button is
// inside the first viewport on phones and desktops, validation is announced and
// focuses the first bad field, typo'd email domains get a suggestion, and
// backing out of Stripe restores the cart on the event page. Backend mocked.

import { expect, test, type Page } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EVENT_ID = 'evt-checkout-ux';
const TIER = { id: 'tier-vip', name: 'VIP', price: 65 };
const MOBILE = { width: 375, height: 667 };
const DESKTOP = { width: 1366, height: 768 };

function eventResponse() {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Game and Geek Expo',
    description: '<p>Fixture</p>',
    date: future.toISOString(),
    taxRate: 0.0725,
    organizationId: 'org-ux',
    organizationName: 'Retro Gamers',
    organizationLogoUrl: null,
    organizationBrandColor: null,
    organizationThemeMode: 'DARK',
    venue: { id: 'venue-1', name: 'Convention Center', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [
      { ...TIER, description: null, quantityTotal: 100, quantitySold: 0, quantityReserved: 0, quantityAvailable: 100, displayOrder: 0, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10 },
    ],
    addOns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function mockStorefront(page: Page) {
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventResponse()) })
  );
  await page.route(`${API}/legal/versions`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(`${API}/organizations/org-ux/public/menus`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ main: [], footer: [] }) })
  );
  await page.route('**/api/buyer/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
}

const checkoutUrl = `/checkout/${EVENT_ID}?items=${encodeURIComponent(JSON.stringify([{ priceTierId: TIER.id, quantity: 4 }]))}`;

async function expectInViewport(page: Page, name: RegExp) {
  const button = page.getByRole('button', { name });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test.describe('checkout above the fold', () => {
  test('phone: the pay button is pinned in view and the summary collapses to one row', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await mockStorefront(page);
    await page.goto(checkoutUrl);

    await expectInViewport(page, /Continue to payment — \$/);
    await expect(page.getByTestId('checkout-mobile-bar')).toBeVisible();
    await expect(page.getByTestId('cart-lines-checkout')).toBeHidden();

    const toggle = page.getByTestId('order-summary-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('cart-lines-checkout')).toBeVisible();

    // Still reachable after scrolling to the bottom of the page.
    await page.mouse.wheel(0, 4000);
    await expectInViewport(page, /Continue to payment — \$/);
  });

  test('desktop: form, summary and pay button share the first screen', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockStorefront(page);
    await page.goto(checkoutUrl);

    await expectInViewport(page, /Continue to payment — \$/);
    await expect(page.getByTestId('checkout-mobile-bar')).toBeHidden();
    await expect(page.getByTestId('cart-lines-checkout')).toBeVisible();
    await expect(page.getByTestId('checkout-steps').locator('[aria-current="step"]')).toContainText('Details');
  });
});

test.describe('checkout form accessibility', () => {
  test.use({ viewport: DESKTOP });

  test('empty submit marks fields invalid, links errors and focuses the first one', async ({ page }) => {
    await mockStorefront(page);
    let posted = false;
    await page.route(`${API}/orders`, (route) => {
      posted = true;
      return route.fulfill({ status: 500, body: '{}' });
    });
    await page.goto(checkoutUrl);

    await page.getByRole('button', { name: /Continue to payment/ }).click();
    const first = page.getByLabel('First name');
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    await expect(first).toHaveAttribute('aria-describedby', /firstName-error/);
    await expect(page.locator('#firstName-error')).toHaveText('Enter your first name');
    await expect(page.getByLabel('Email address')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByLabel('Last name')).toHaveAttribute('autocomplete', 'family-name');
    expect(posted).toBe(false);
  });

  test('a mistyped email domain gets a one-tap fix', async ({ page }) => {
    await mockStorefront(page);
    await page.goto(checkoutUrl);

    const email = page.getByLabel('Email address');
    await email.fill('ada@gmial.com');
    await email.blur();
    const suggestion = page.getByTestId('email-suggestion');
    await expect(suggestion).toContainText('ada@gmail.com');
    await suggestion.getByRole('button').click();
    await expect(email).toHaveValue('ada@gmail.com');
    await expect(suggestion).toHaveCount(0);
  });

  test('a sold-out conflict is announced with a way back to the tickets', async ({ page }) => {
    await mockStorefront(page);
    await page.route(`${API}/orders`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Conflict', message: 'Insufficient inventory for VIP' }) })
    );
    await page.goto(checkoutUrl);
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Lovelace');
    await page.getByLabel('Email address').fill('ada@example.com');
    await page.getByRole('button', { name: /Continue to payment/ }).click();

    const alert = page.getByTestId('checkout-error');
    await expect(alert).toBeFocused();
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText('Those tickets just sold out');
    await expect(alert.getByRole('link', { name: 'Choose other tickets' })).toBeVisible();
  });
});

test.describe('returning from Stripe', () => {
  test('a cancelled payment restores the cart and the typed details', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await mockStorefront(page);
    await page.route(`${API}/orders`, (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        // Stand-in for Stripe: go straight to the cancel_url
        body: JSON.stringify({ orderId: 'ord-1', orderRef: 'JMP-1', stripeCheckoutUrl: `/events/${EVENT_ID}?status=cancelled`, totalAmount: 1 }),
      })
    );
    await page.goto(checkoutUrl);
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Lovelace');
    await page.getByLabel('Email address').fill('ada@example.com');
    await page.getByRole('button', { name: /Continue to payment/ }).click();

    await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}\\?status=cancelled`));
    await expect(page.getByTestId('checkout-cancelled')).toContainText('been charged');
    const checkout = page.getByRole('button', { name: /^Checkout \$/ });
    await expect(checkout).toBeVisible();
    await checkout.click();

    await expect(page).toHaveURL(new RegExp(`/checkout/${EVENT_ID}`));
    await expect(page.getByLabel('First name')).toHaveValue('Ada');
    await expect(page.getByLabel('Email address')).toHaveValue('ada@example.com');
  });

  test('phone: with nothing chosen, a Get tickets bar leads to the ticket list', async ({ page }) => {
    // Short screen so the hero pushes the ticket list below the fold.
    await page.setViewportSize({ width: 375, height: 360 });
    await mockStorefront(page);
    await page.goto(`/events/${EVENT_ID}`);
    const bar = page.getByTestId('mobile-get-tickets');
    await expect(bar).toContainText('Get tickets · from $');
    await bar.click();
    await expect(page.getByRole('button', { name: 'Increase VIP quantity' })).toBeFocused();
    // The list is on screen now, so the bar gets out of the way.
    await expect(bar).not.toBeInViewport();
  });
});
