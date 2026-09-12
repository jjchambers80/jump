import { expect, test, type Page } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const EVENT_ID = 'evt-cart-breakdown';

// Two tiers with a non-zero tax rate so every breakdown row (base, service,
// processing, tax) renders and the proportional split is exercised.
const TIER_A = { id: 'tier-ga', name: 'General Admission', price: 25 };
const TIER_B = { id: 'tier-vip', name: 'VIP', price: 99.99 };

function eventResponse() {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Cart Breakdown Test Event',
    description: 'Fixture for the cart line-item breakdown accordion.',
    date: future.toISOString(),
    imageUrl: null,
    taxRate: 0.08,
    organizationBrandColor: null,
    organizationThemeMode: 'LIGHT',
    venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St' },
    priceTiers: [TIER_A, TIER_B].map((tier) => ({
      ...tier,
      description: null,
      quantityTotal: 100,
      quantityAvailable: 100,
      isActive: true,
      isRefundable: true,
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

function dollars(text: string | null): number {
  return Number.parseFloat((text ?? '').replace(/[^0-9.]/g, ''));
}

/** Click the "+" stepper for a tier `times` times on the event page. */
async function addTickets(page: Page, tierName: string, times: number) {
  const plus = page.getByRole('button', { name: `Increase ${tierName} quantity` });
  for (let i = 0; i < times; i++) await plus.click();
}

async function expectBreakdownRows(region: import('@playwright/test').Locator) {
  await expect(region).toBeVisible();
  await expect(region).toContainText('Base price');
  await expect(region).toContainText('Service fee');
  await expect(region).toContainText('Processing fee');
  await expect(region).toContainText('Tax');
  await expect(region).toContainText('Line total');
}

test.describe('cart line-item price breakdown', () => {
  test.describe('desktop order summary', () => {
    test.use({ viewport: DESKTOP });

    test('price has a dotted underline and toggles the breakdown accordion', async ({ page }) => {
      await mockEvent(page);
      await page.goto(`/events/${EVENT_ID}`);
      await addTickets(page, TIER_A.name, 2);

      const lines = page.getByTestId('cart-lines-desktop');
      const line = lines.getByTestId('cart-line').first();
      const price = line.getByTestId('cart-line-price');
      const underlined = price.locator('span').first();

      await expect(underlined).toHaveCSS('border-bottom-style', 'dotted');
      await expect(line).toHaveAttribute('data-open', 'false');
      await expect(price).toHaveAttribute('aria-expanded', 'false');
      await expect(line.getByTestId('line-breakdown')).toBeHidden();

      await price.click();
      await expect(line).toHaveAttribute('data-open', 'true');
      await expect(price).toHaveAttribute('aria-expanded', 'true');
      await expectBreakdownRows(line.getByTestId('line-breakdown'));
      // Caret rotates to point down while open.
      await expect(price.locator('svg')).toHaveClass(/rotate-90/);

      await price.click();
      await expect(line).toHaveAttribute('data-open', 'false');
      await expect(line.getByTestId('line-breakdown')).toBeHidden();
      await expect(price.locator('svg')).not.toHaveClass(/rotate-90/);
    });

    test('expand all / collapse all sits in the Order Summary row and drives every line', async ({
      page,
    }) => {
      await mockEvent(page);
      await page.goto(`/events/${EVENT_ID}`);

      const toggle = page.getByTestId('expand-collapse-all').first();
      await expect(toggle).toBeDisabled();

      await addTickets(page, TIER_A.name, 2);
      await addTickets(page, TIER_B.name, 1);
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveText('Expand all');

      // Same row as the heading, flush right.
      const heading = page.getByRole('heading', { name: 'Order Summary' });
      const headingBox = (await heading.boundingBox())!;
      const toggleBox = (await toggle.boundingBox())!;
      const summaryCard = page.getByTestId('cart-lines-desktop').locator('..');
      const cardBox = (await summaryCard.boundingBox())!;
      expect(Math.abs(headingBox.y + headingBox.height / 2 - (toggleBox.y + toggleBox.height / 2))).toBeLessThan(4);
      expect(toggleBox.x + toggleBox.width).toBeGreaterThan(cardBox.x + cardBox.width * 0.75);

      const lines = page.getByTestId('cart-lines-desktop').getByTestId('cart-line');
      await expect(lines).toHaveCount(2);

      await toggle.click();
      await expect(toggle).toHaveText('Collapse all');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      for (const line of await lines.all()) {
        await expect(line).toHaveAttribute('data-open', 'true');
        await expectBreakdownRows(line.getByTestId('line-breakdown'));
      }

      await toggle.click();
      await expect(toggle).toHaveText('Expand all');
      for (const line of await lines.all()) {
        await expect(line).toHaveAttribute('data-open', 'false');
      }

      // Closing one line manually flips the label back from "Collapse all".
      await toggle.click();
      await lines.first().getByTestId('cart-line-price').click();
      await expect(toggle).toHaveText('Expand all');
    });

    test('line totals add up to the cart total', async ({ page }) => {
      await mockEvent(page);
      await page.goto(`/events/${EVENT_ID}`);
      await addTickets(page, TIER_A.name, 3);
      await addTickets(page, TIER_B.name, 1);
      await page.getByTestId('expand-collapse-all').first().click();

      const lineTotals = page.getByTestId('cart-lines-desktop').getByTestId('line-breakdown-total');
      const shown = await lineTotals.allTextContents();
      const sum = Math.round(shown.map(dollars).reduce((s, n) => s + n, 0) * 100) / 100;

      const checkout = page.getByRole('button', { name: 'Proceed to Checkout' });
      const totalRow = checkout.locator('..').getByText(/^Total \(/).locator('..');
      const total = dollars(await totalRow.locator('span').last().textContent());
      expect(sum).toBe(total);
    });
  });

  test.describe('mobile cart drawer', () => {
    test.use({ viewport: MOBILE });

    test('same accordion and expand/collapse all behaviour inside the drawer', async ({ page }) => {
      await mockEvent(page);
      await page.goto(`/events/${EVENT_ID}`);
      await addTickets(page, TIER_A.name, 1);
      await addTickets(page, TIER_B.name, 2);

      await page.getByRole('button', { name: 'View cart' }).click();
      const drawerLines = page.getByTestId('cart-lines-mobile');
      await expect(drawerLines).toBeVisible();

      const lines = drawerLines.getByTestId('cart-line');
      await expect(lines).toHaveCount(2);

      const first = lines.first();
      const price = first.getByTestId('cart-line-price');
      await expect(price.locator('span').first()).toHaveCSS('border-bottom-style', 'dotted');
      await price.click();
      await expect(first).toHaveAttribute('data-open', 'true');
      await expectBreakdownRows(first.getByTestId('line-breakdown'));
      await expect(price.locator('svg')).toHaveClass(/rotate-90/);
      await price.click();
      await expect(first).toHaveAttribute('data-open', 'false');

      // Toggle lives on the "Your Cart" title row, right of the title, left of the close X.
      const heading = page.getByRole('heading', { name: 'Your Cart' });
      const toggle = heading.locator('..').getByTestId('expand-collapse-all');
      await expect(toggle).toBeVisible();
      const headingBox = (await heading.boundingBox())!;
      const toggleBox = (await toggle.boundingBox())!;
      const closeBox = (await page.getByRole('button', { name: 'Close cart' }).boundingBox())!;
      expect(Math.abs(headingBox.y + headingBox.height / 2 - (toggleBox.y + toggleBox.height / 2))).toBeLessThan(4);
      expect(toggleBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
      expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(closeBox.x + 1);

      await toggle.click();
      await expect(toggle).toHaveText('Collapse all');
      for (const line of await lines.all()) {
        await expect(line).toHaveAttribute('data-open', 'true');
      }
      await toggle.click();
      for (const line of await lines.all()) {
        await expect(line).toHaveAttribute('data-open', 'false');
      }
    });

    test('open state is shared between the drawer and the desktop summary', async ({ page }) => {
      await mockEvent(page);
      await page.goto(`/events/${EVENT_ID}`);
      await addTickets(page, TIER_A.name, 1);

      await page.getByRole('button', { name: 'View cart' }).click();
      await page.getByTestId('cart-lines-mobile').getByTestId('cart-line-price').first().click();
      await page.getByRole('button', { name: 'Close cart' }).click();

      await page.setViewportSize(DESKTOP);
      const desktopLine = page.getByTestId('cart-lines-desktop').getByTestId('cart-line').first();
      await expect(desktopLine).toHaveAttribute('data-open', 'true');
    });
  });

  test.describe('checkout order summary', () => {
    test.use({ viewport: DESKTOP });

    test('line accordions and expand all are available on the checkout page', async ({ page }) => {
      await mockEvent(page);
      const items = encodeURIComponent(
        JSON.stringify([
          { priceTierId: TIER_A.id, quantity: 2 },
          { priceTierId: TIER_B.id, quantity: 1 },
        ])
      );
      await page.goto(`/checkout/${EVENT_ID}?items=${items}`);

      const lines = page.getByTestId('cart-lines-checkout').getByTestId('cart-line');
      await expect(lines).toHaveCount(2);

      const heading = page.getByRole('heading', { name: 'Order Summary' });
      const toggle = heading.locator('..').getByTestId('expand-collapse-all');
      await expect(toggle).toHaveText('Expand all');
      await toggle.click();
      for (const line of await lines.all()) {
        await expect(line).toHaveAttribute('data-open', 'true');
        await expectBreakdownRows(line.getByTestId('line-breakdown'));
      }

      const shown = await page.getByTestId('line-breakdown-total').allTextContents();
      const sum = Math.round(shown.map(dollars).reduce((s, n) => s + n, 0) * 100) / 100;
      const totalText = await page.getByText('Total:', { exact: true }).locator('..').locator('span').last().textContent();
      expect(sum).toBe(dollars(totalText));
    });
  });
});
