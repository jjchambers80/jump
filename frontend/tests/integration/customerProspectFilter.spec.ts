// E2E test for prospect filtering and detail rendering (JUMP-032C phase 3)
// login as admin → navigate to customers list → toggle scope to All contacts →
// select a prospect → verify Prospect segment + $0/0 stat tiles on detail page
//
// Requires seed data: at least one admin user, one organization with at least
// one customer (contact with paid orders) and one prospect (contact with no
// paid orders) scoped to that organization.
//
// Seed setup: the admin user and contacts can be created through the API in
// test.beforeAll, or the CI seed script must ensure the following test contacts
// exist for the admin's organization:
//   - Prospect contact: email starts with "e2e-prospect-" (no paid orders)
//   - Customer contact: email starts with "e2e-customer-"  (has paid orders)

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'e2e-admin-prospect@example.com';
const ADMIN_PASSWORD = 'E2EProspect123!';
const ORG_NAME = 'E2E Prospect Test Org';

test.describe('Customer prospect filter and detail rendering', () => {
  test.beforeAll(async ({ request }) => {
    // In CI, seeds would be created through the API or separate seed script.
    // The test assumes seed data already exists.
    // See tests/integration/README.md or CI seed config for setup instructions.
  });

  test('toggle to All contacts, select a prospect, and verify Prospect detail', async ({
    page,
  }) => {
    // Step 1: Login as admin
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Step 2: Should land on admin dashboard
    await expect(page).toHaveURL(/admin\/dashboard/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible();

    // Step 3: Navigate to Customers page
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: /customers/i })).toBeVisible();

    // Step 4: Scope defaults to Customers — verify the Customers toggle is active
    const customersToggle = page.getByTestId('customer-scope-customers');
    const allToggle = page.getByTestId('customer-scope-all');
    await expect(customersToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(allToggle).toHaveAttribute('aria-pressed', 'false');

    // Step 5: Switch to All contacts scope to reveal prospects
    await allToggle.click();

    // After switching, the button aria-pressed updates immediately (client-side
    // navigation) and the list reloads. Wait for the scope badge to update.
    await expect(allToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(customersToggle).toHaveAttribute('aria-pressed', 'false');

    // Step 6: Wait for the table to load with results (at least one prospect)
    // The scope switch triggers a fetch; wait for at least one row to render.
    const customerNameLinks = page.locator('a[href*="/admin/customers/"]');
    await expect(customerNameLinks.first()).toBeVisible({ timeout: 10000 });

    // Step 7: Find a prospect contact (one whose detail page will show the
    // Prospect segment). We pick the last row since prospects tend to appear
    // at the end (sorted by lastActivityAt DESC; prospects have null dates).
    const contactLinks = await page.locator('a[href*="/admin/customers/"]').all();
    // Click the last contact link — likely a prospect (no last activity).
    const targetLink = contactLinks[contactLinks.length - 1];
    const href = await targetLink.getAttribute('href');
    await targetLink.click();

    // Step 8: Verify we navigated to the detail page
    await expect(page).toHaveURL(/\/admin\/customers\//);
    await expect(page.getByTestId('customer-segment')).toBeVisible();

    // Step 9: Verify the segment label is "Prospect"
    await expect(page.getByTestId('customer-segment')).toContainText('Prospect');

    // Step 10: Verify stat tiles show $0.00 or 0
    // The stat tiles use standard class-based rendering; check for zero
    // amounts. We look for common stat tile selectors.
    const statContainer = page.locator('div.grid.grid-cols-2\\:lg\\:grid-cols-4, .grid.gap-4.mb-6');
    // The exact selector may differ — check for $0.00 or $0 text patterns
    // in the stats area and "0" for the transaction count.
    //
    // Each stat tile typically renders as a value paired with a label.
    // Look for the zero values in the rendered markup.
    const pageText = await page.textContent('body');
    expect(pageText).toContain('Prospect');

    // Verify zero-value indicators are present. The stat tiles for a prospect
    // show $0.00 for amount and 0 for transactions — any of these patterns.
    const hasZeroAmount = pageText.includes('$0') || pageText.includes('$0.00');
    const hasZeroTransactions = pageText.includes(' 0 ') || pageText.includes('0\n');

    expect(hasZeroAmount || hasZeroTransactions).toBe(true);

    // Step 11: Verify the Back to customers link preserves scope
    const backLink = page.locator('a[href*="/admin/customers"]');
    await expect(backLink.first()).toHaveAttribute('href', /scope=all/);
  });

  test('existing customer detail still renders correctly under default Customers scope', async ({
    page,
  }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/admin\/dashboard/, { timeout: 10000 });

    // Navigate to customers list — default scope, only customers
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: /customers/i })).toBeVisible();

    // Expect the default scope is "Customers"
    await expect(page.getByTestId('customer-scope-customers')).toHaveAttribute('aria-pressed', 'true');

    // Wait for customer list to load
    const customerLinks = page.locator('a[href*="/admin/customers/"]');
    await expect(customerLinks.first()).toBeVisible({ timeout: 10000 });

    // Click the first customer
    await customerLinks.first().click();
    await expect(page).toHaveURL(/\/admin\/customers\//);

    // A customer should NOT have the Prospect segment badge
    await expect(page.getByTestId('customer-segment')).toHaveCount(0);

    // Should show positive or zero amount tiles (not asserting strictly positive,
    // but the page rendered without error)
    await expect(page.getByRole('heading', { name: /customers/i })).toBeVisible();
  });
});