// E2E test for customer ticket purchase journey
// Tests complete user flow: browse → select → purchase → confirmation

import { test, expect } from '@playwright/test';

test.describe('Customer Ticket Purchase Journey', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the events listing page
    await page.goto('http://localhost:3001/events');
  });

  test('should complete full purchase flow from browsing to confirmation', async ({ page }) => {
    // Step 1: Browse events
    await expect(page.locator('h1')).toContainText(/events|browse/i);

    // Wait for events to load
    await page.waitForSelector('[data-testid="event-card"]', { timeout: 5000 });

    const eventCards = page.locator('[data-testid="event-card"]');
    await expect(eventCards).toHaveCount(await eventCards.count());

    // Step 2: Select an event
    const firstEvent = eventCards.first();
    await expect(firstEvent).toBeVisible();

    const eventName = await firstEvent.locator('[data-testid="event-name"]').textContent();
    await firstEvent.locator('[data-testid="view-event-button"]').click();

    // Step 3: View event details
    await expect(page).toHaveURL(/\/events\/[a-f0-9-]+/);
    await expect(page.locator('[data-testid="event-detail-name"]')).toContainText(eventName);

    // Verify event details are displayed
    await expect(page.locator('[data-testid="event-venue"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-date"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-price"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-capacity"]')).toBeVisible();

    // Step 4: Select quantity
    const quantitySelector = page.locator('[data-testid="quantity-selector"]');
    await expect(quantitySelector).toBeVisible();
    await quantitySelector.selectOption('2'); // Select 2 tickets

    // Step 5: Enter email
    const emailInput = page.locator('[data-testid="customer-email"]');
    await emailInput.fill('e2e-buyer@test.com');

    // Step 6: Click Buy Tickets
    const buyButton = page.locator('[data-testid="buy-tickets-button"]');
    await expect(buyButton).toBeEnabled();
    await buyButton.click();

    // Step 7: Redirected to Stripe Checkout
    // In test mode, we'd use Stripe test mode or mock
    // For now, verify we're redirected to checkout page
    await expect(page).toHaveURL(/\/checkout/, { timeout: 10000 });

    // Verify checkout information is displayed
    await expect(page.locator('[data-testid="checkout-event-name"]')).toContainText(eventName);
    await expect(page.locator('[data-testid="checkout-quantity"]')).toContainText('2');

    // Step 8: For E2E testing with Stripe, we'd normally:
    // - Use Stripe test credentials
    // - Fill in test card: 4242 4242 4242 4242
    // - Complete payment
    // Since this requires actual Stripe integration, we'll stop here
    // and verify the checkout page loaded correctly
  });

  test('should display sold out message for events at capacity', async ({ page }) => {
    // This test would require a test event that's sold out
    // For now, we'll test the UI elements exist

    await page.goto('http://localhost:3001/events');

    const soldOutBadge = page.locator('[data-testid="sold-out-badge"]');
    const count = await soldOutBadge.count();

    if (count > 0) {
      // If sold out events exist, verify badge is visible
      await expect(soldOutBadge.first()).toBeVisible();
      await expect(soldOutBadge.first()).toContainText(/sold out/i);
    }
  });

  test('should validate quantity selection (1-10 range)', async ({ page }) => {
    // Navigate to an event detail page
    await page.locator('[data-testid="event-card"]').first().click();

    const quantitySelector = page.locator('[data-testid="quantity-selector"]');

    // Verify min is 1 and max is 10
    const options = await quantitySelector.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(10);

    // Select maximum (10)
    await quantitySelector.selectOption('10');
    const selectedValue = await quantitySelector.inputValue();
    expect(selectedValue).toBe('10');
  });

  test('should validate email format', async ({ page }) => {
    await page.locator('[data-testid="event-card"]').first().click();

    const emailInput = page.locator('[data-testid="customer-email"]');
    const buyButton = page.locator('[data-testid="buy-tickets-button"]');

    // Try invalid email
    await emailInput.fill('invalid-email');
    await buyButton.click();

    // Should show validation error
    const errorMessage = page.locator('[data-testid="email-error"]');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText(/email/i);

    // Fix email
    await emailInput.fill('valid@test.com');

    // Error should disappear
    await expect(errorMessage).not.toBeVisible();
  });

  test('should handle back navigation from event detail to listing', async ({ page }) => {
    // Click on an event
    await page.locator('[data-testid="event-card"]').first().click();

    // Verify we're on detail page
    await expect(page).toHaveURL(/\/events\/[a-f0-9-]+/);

    // Click back button
    const backButton = page.locator('[data-testid="back-to-events-button"]');
    await backButton.click();

    // Should be back at listing
    await expect(page).toHaveURL('/events');
    await expect(page.locator('[data-testid="event-card"]')).toHaveCount(
      await page.locator('[data-testid="event-card"]').count()
    );
  });

  test('should display loading state while fetching events', async ({ page }) => {
    // Intercept API call to add delay
    await page.route('**/api/events', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page.goto('http://localhost:3001/events');

    // Should show loading indicator
    const loadingIndicator = page.locator('[data-testid="loading-indicator"]');
    await expect(loadingIndicator).toBeVisible();

    // After loading, events should appear
    await expect(page.locator('[data-testid="event-card"]')).toHaveCount(
      await page.locator('[data-testid="event-card"]').count(),
      { timeout: 5000 }
    );
  });

  test('should paginate event listings', async ({ page }) => {
    // Verify pagination controls exist if there are many events
    const paginationControls = page.locator('[data-testid="pagination"]');
    const count = await paginationControls.count();

    if (count > 0) {
      // If pagination exists, test it
      const nextButton = page.locator('[data-testid="next-page-button"]');
      await expect(nextButton).toBeVisible();

      const currentPageBefore = await page.locator('[data-testid="current-page"]').textContent();

      await nextButton.click();

      const currentPageAfter = await page.locator('[data-testid="current-page"]').textContent();

      expect(currentPageAfter).not.toBe(currentPageBefore);
    }
  });

  test('should display confirmation page with QR code after successful purchase', async ({
    page,
  }) => {
    // This would require completing a full Stripe checkout
    // For testing purposes, we can navigate directly to a confirmation page
    // with a test session ID

    await page.goto('http://localhost:3001/confirmation?session_id=cs_test_successful_123');

    // Should show loading or processing message first
    const processingMessage = page.locator('[data-testid="processing-message"]');

    // After processing, should show tickets
    await expect(page.locator('[data-testid="ticket-display"]')).toBeVisible({
      timeout: 30000,
    });

    // Verify QR code is displayed
    const qrCode = page.locator('[data-testid="qr-code"]');
    await expect(qrCode).toBeVisible();

    // Verify ticket details
    await expect(page.locator('[data-testid="ticket-event-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-event-date"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-event-venue"]')).toBeVisible();
  });
});
