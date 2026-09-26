import { expect, test, type Page } from '@playwright/test';

// Public event page, ticketed mode: each tier renders as a torn ticket stub
// (TierStub). Scarcity shows only for the last few tickets, the refund policy
// is an inline disclosure, and a tier in the cart is marked selected.

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EVENT_ID = 'evt-ticket-tiers';

const TIERS = [
  { id: 'tier-plenty', name: 'Weekend Badge', price: 45, quantityAvailable: 500, isRefundable: false, description: 'Admission Saturday and Sunday.' },
  { id: 'tier-low', name: 'VIP', price: 65, quantityAvailable: 4, isRefundable: true, description: null },
  { id: 'tier-gone', name: 'Early Bird', price: 25, quantityAvailable: 0, isRefundable: true, description: null },
];

function eventResponse() {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Ticket Tiers Test Event',
    description: '<p>Fixture for the tier stubs.</p>',
    date: future.toISOString(),
    taxRate: 0.0725,
    organizationBrandColor: null,
    organizationThemeMode: 'LIGHT',
    admissionMode: 'TICKETED',
    venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: TIERS.map((tier, i) => ({
      ...tier,
      quantityTotal: 500,
      quantitySold: 0,
      quantityReserved: 0,
      displayOrder: i,
      isActive: true,
      minPerOrder: 1,
      maxPerOrder: 10,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function mockEvent(page: Page) {
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventResponse()) })
  );
}

test.use({ viewport: { width: 1280, height: 900 } });

test('tier stubs show scarcity, sold out and the refund policy', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/events/${EVENT_ID}`);

  const plenty = page.getByTestId('tier-tier-plenty');
  const low = page.getByTestId('tier-tier-low');
  const gone = page.getByTestId('tier-tier-gone');
  await expect(plenty).toBeVisible({ timeout: 30000 });

  // All-in price on the stub: $45 + fees + 7.25% tax
  await expect(plenty).toContainText('$52.18');
  await expect(plenty).not.toContainText('left');
  await expect(low).toContainText('Only 4 left');
  await expect(gone).toContainText('Sold out');
  await expect(page.getByRole('button', { name: 'Increase Early Bird quantity' })).toBeDisabled();

  // The refund policy is a disclosure inside the stub, not a hover tooltip
  const policy = plenty.getByRole('button', { name: 'Non-refundable' });
  await expect(policy).toHaveAttribute('aria-expanded', 'false');
  await policy.click();
  await expect(policy).toHaveAttribute('aria-expanded', 'true');
  await expect(plenty).toContainText('non-cancellable, and non-transferable');
  await expect(low.getByRole('button', { name: 'Non-refundable' })).toHaveCount(0);

  // Tier details still open the dialog
  await page.getByRole('button', { name: 'Weekend Badge details' }).click();
  await expect(page.getByRole('heading', { name: 'Weekend Badge' }).last()).toBeVisible();
});

test('a tier in the cart is marked selected', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/events/${EVENT_ID}`);

  const low = page.getByTestId('tier-tier-low');
  await expect(low).toHaveAttribute('data-selected', 'false', { timeout: 30000 });
  await page.getByRole('button', { name: 'Increase VIP quantity' }).click();
  await expect(low).toHaveAttribute('data-selected', 'true');
  await expect(page.getByLabel('VIP quantity', { exact: true })).toHaveText('1');
  await expect(page.getByTestId('cart-lines-desktop')).toContainText('VIP');
});
