// E2E test for admin event creation using Playwright (T087)
// login as admin → create event form → submit → verify success → publish → verify in customer event list

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'e2e-admin@example.com';
const ADMIN_PASSWORD = 'E2EAdminPass123!';
const API_URL = 'http://localhost:3000';

test.describe('Admin Event Creation E2E', () => {
  test.beforeAll(async ({ request }) => {
    // Ensure admin account exists (created via direct API/DB in test setup)
    // In CI, this would be handled by a seed script
  });

  test('admin can create and publish an event', async ({ page }) => {
    // Step 1: Navigate to login
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

    // Step 2: Login as admin
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Step 3: Should redirect to admin dashboard
    await expect(page).toHaveURL(/admin\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // Step 4: Click "Create Event"
    await page.click('text=Create Event');
    await expect(page).toHaveURL(/admin\/create-event/);

    // Step 5: Fill in event form
    const eventName = `E2E Test Event ${Date.now()}`;
    await page.fill('#name', eventName);

    // Set a future date
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const dateStr = futureDate.toISOString().slice(0, 16);
    await page.fill('#date', dateStr);

    await page.fill('#venue', 'E2E Test Venue');
    await page.fill('#capacity', '100');
    await page.fill('#ticketPrice', '25.00');

    // Step 6: Submit form
    await page.click('button[type="submit"]');

    // Step 7: Verify success notification
    await expect(page.getByText('created successfully')).toBeVisible({ timeout: 5000 });

    // Step 8: Should redirect to dashboard
    await expect(page).toHaveURL(/admin\/dashboard/, { timeout: 5000 });

    // Step 9: Verify event appears in list as DRAFT
    await expect(page.getByText(eventName)).toBeVisible();
    await expect(page.getByText('DRAFT')).toBeVisible();

    // Step 10: Publish the event
    await page.click('text=Publish');

    // Step 11: Verify event is now PUBLISHED
    await expect(page.getByText('PUBLISHED')).toBeVisible({ timeout: 5000 });

    // Step 12: Verify event visible in customer event list
    await page.goto('/events');
    await expect(page.getByText(eventName)).toBeVisible();
  });

  test('non-admin sees 403 on admin pages', async ({ page }) => {
    // Register as customer
    await page.goto('/auth/register');
    const customerEmail = `e2e-customer-${Date.now()}@example.com`;
    await page.fill('#name', 'E2E Customer');
    await page.fill('#email', customerEmail);
    await page.fill('#password', 'CustomerPass123!');
    await page.fill('#confirmPassword', 'CustomerPass123!');
    await page.click('button[type="submit"]');

    // Try to access admin dashboard
    await page.goto('/admin/dashboard');

    // Should see access denied
    await expect(page.getByText('Access Denied')).toBeVisible({ timeout: 5000 });
  });
});
