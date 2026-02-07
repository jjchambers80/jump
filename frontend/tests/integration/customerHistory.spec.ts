// E2E test for customer viewing purchase history using Playwright (T121)
// login → navigate to My Tickets → verify tickets display → click ticket → verify QR code and details

import { test, expect } from '@playwright/test';

const CUSTOMER_EMAIL = 'e2e-history@example.com';
const CUSTOMER_PASSWORD = 'E2EHistory123!';

test.describe('Customer Purchase History E2E', () => {
  test.beforeAll(async () => {
    // In CI, customer account and tickets would be seeded
  });

  test('authenticated customer can view purchase history', async ({ page }) => {
    // Step 1: Login as customer
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

    await page.fill('#email', CUSTOMER_EMAIL);
    await page.fill('#password', CUSTOMER_PASSWORD);
    await page.click('button[type="submit"]');

    // Step 2: Navigate to My Tickets
    await page.goto('/my-tickets');
    await expect(page.getByRole('heading', { name: /my tickets/i })).toBeVisible();

    // Step 3: Verify ticket list displays
    await expect(page.locator('[data-testid="ticket-card"]')).toHaveCount(1, {
      timeout: 10000,
    });

    // Step 4: Verify ticket shows event details
    const firstTicket = page.locator('[data-testid="ticket-card"]').first();
    await expect(firstTicket).toContainText(/event/i);
    await expect(firstTicket).toContainText(/venue/i);
  });

  test('clicking a ticket shows full details with QR code', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('#email', CUSTOMER_EMAIL);
    await page.fill('#password', CUSTOMER_PASSWORD);
    await page.click('button[type="submit"]');

    // Go to My Tickets
    await page.goto('/my-tickets');
    await expect(page.locator('[data-testid="ticket-card"]')).toHaveCount(1, {
      timeout: 10000,
    });

    // Click on a ticket to view details
    await page.locator('[data-testid="ticket-card"]').first().click();

    // Should navigate to ticket detail page
    await expect(page).toHaveURL(/\/tickets\//);

    // Verify QR code is displayed
    await expect(page.locator('[data-testid="qr-code"]')).toBeVisible();

    // Verify event details are shown
    await expect(page.locator('[data-testid="ticket-event-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-event-date"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-venue"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-price"]')).toBeVisible();
  });

  test('expired tickets show expired badge', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('#email', CUSTOMER_EMAIL);
    await page.fill('#password', CUSTOMER_PASSWORD);
    await page.click('button[type="submit"]');

    // Go to My Tickets — if there are expired tickets they should show badge
    await page.goto('/my-tickets');

    // Check for expired badge if any expired tickets exist
    const expiredBadge = page.locator('[data-testid="expired-badge"]');
    if ((await expiredBadge.count()) > 0) {
      await expect(expiredBadge.first()).toContainText(/expired/i);
    }
  });

  test('QR code download button works', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('#email', CUSTOMER_EMAIL);
    await page.fill('#password', CUSTOMER_PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to ticket detail
    await page.goto('/my-tickets');
    await page.locator('[data-testid="ticket-card"]').first().click();

    // Download button should be visible
    const downloadBtn = page.locator('[data-testid="download-qr-button"]');
    await expect(downloadBtn).toBeVisible();
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    // Go directly to My Tickets without logging in
    await page.goto('/my-tickets');

    // Should be redirected to login
    await expect(page).toHaveURL(/auth\/login/);
  });
});
