import { expect, test } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const APPLE = `${API}/wallet/apple/t-valid.pkpass?t=tok`;
const GOOGLE = `${API}/wallet/google/t-valid?t=tok`;

function orderResponse(wallet: { apple: string | null; google: string | null }) {
  return {
    id: 'order-wallet',
    orderRef: 'JMP-WALLET',
    status: 'COMPLETED',
    totalAmount: 50,
    quantity: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    event: {
      id: 'event-1',
      name: 'Wallet Fest',
      date: '2027-06-01T20:00:00.000Z',
      venue: { id: 'v1', name: 'The Hall', address: '1 Main St' },
    },
    payment: null,
    tickets: [
      {
        id: 't-valid',
        barcode: 'JUMP-VALID000001',
        status: 'VALID',
        pricePaid: 25,
        priceTierName: 'GA',
        qrCodeDataUrl: null,
        redeemedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        wallet,
      },
      {
        id: 't-redeemed',
        barcode: 'JUMP-REDEEM00001',
        status: 'REDEEMED',
        pricePaid: 25,
        priceTierName: 'GA',
        qrCodeDataUrl: null,
        redeemedAt: '2026-09-02T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        wallet: { apple: null, google: null },
      },
    ],
  };
}

async function mockSession(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'wallet-buyer', email: 'ada@example.com', role: 'CUSTOMER' },
        accessToken: 'wallet-test-token',
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  );
}

async function mockOrder(
  page: import('@playwright/test').Page,
  wallet: { apple: string | null; google: string | null }
) {
  const body = JSON.stringify(orderResponse(wallet));
  await page.route(`${API}/orders/order-wallet`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route(`${API}/orders/order-wallet/verify-payment`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
}

test.describe('wallet buttons', () => {
  test('confirmation page lists wallet buttons for each VALID ticket', async ({ page }) => {
    await mockOrder(page, { apple: APPLE, google: GOOGLE });
    await page.goto('/confirmation?orderId=order-wallet');

    const section = page.getByTestId('wallet-section');
    await expect(section).toBeVisible();
    await expect(section.getByText('Ticket 1 · GA')).toBeVisible();
    // Only the VALID ticket gets a row
    await expect(section.getByTestId('wallet-buttons')).toHaveCount(1);

    await expect(section.getByTestId('add-to-apple-wallet')).toHaveAttribute('href', APPLE);
    await expect(section.getByTestId('add-to-google-wallet')).toHaveAttribute('href', GOOGLE);
  });

  test('confirmation page hides the wallet section when no provider is configured', async ({ page }) => {
    await mockOrder(page, { apple: null, google: null });
    await page.goto('/confirmation?orderId=order-wallet');

    await expect(page.getByText('Order Reference')).toBeVisible();
    await expect(page.getByTestId('wallet-section')).toHaveCount(0);
  });

  test('only the configured provider is shown', async ({ page }) => {
    await mockOrder(page, { apple: APPLE, google: null });
    await page.goto('/confirmation?orderId=order-wallet');

    const section = page.getByTestId('wallet-section');
    await expect(section.getByTestId('add-to-apple-wallet')).toBeVisible();
    await expect(section.getByTestId('add-to-google-wallet')).toHaveCount(0);
  });

  test('order page shows wallet buttons under VALID tickets only', async ({ page }) => {
    await mockSession(page);
    await mockOrder(page, { apple: APPLE, google: GOOGLE });
    await page.goto('/orders/order-wallet');

    await expect(page.getByTestId('wallet-buttons')).toHaveCount(1);
    await expect(page.getByTestId('add-to-apple-wallet')).toHaveAttribute('href', APPLE);
    await expect(page.getByTestId('add-to-google-wallet')).toHaveAttribute('href', GOOGLE);
  });

  test('iPhone visitors see the Apple button first', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await mockSession(page);
    await mockOrder(page, { apple: APPLE, google: GOOGLE });
    await page.goto('/orders/order-wallet');

    const buttons = page.getByTestId('wallet-buttons').locator('a');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.first()).toHaveAttribute('data-testid', 'add-to-apple-wallet');
    await context.close();
  });
});
