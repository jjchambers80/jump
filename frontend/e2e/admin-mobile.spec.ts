// E2E tests for mobile admin layout (T110-T111)
// US5: Responsive sidebar with hamburger toggle
import { test, expect } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';

test.describe('US5: Mobile responsive admin', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone X viewport

  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'mobile-admin', email: 'mobile@test.com', role: 'ADMIN' }, baseURL!);
    await page.route(`${API}/organizations`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-1', name: 'Test Org', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]) })
    );
  });

  test('T110: Mobile shows hamburger menu, sidebar hidden by default', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // Hamburger button visible on mobile
    const hamburger = page.getByLabel('Open sidebar');
    await expect(hamburger).toBeVisible();

    // Sidebar should be hidden by default on mobile
    const sidebar = page.locator('aside');
    await expect(sidebar).not.toBeInViewport();
  });

  test('T111: Hamburger toggle opens/closes sidebar overlay', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // Click hamburger to open sidebar
    await page.getByLabel('Open sidebar').click();

    // Sidebar should be visible
    const dashboardLink = page.locator('aside').getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toBeVisible();

    // Backdrop should be present
    const backdrop = page.locator('[data-testid="sidebar-backdrop"]');
    await expect(backdrop).toBeVisible();

    // Use close button to close sidebar (backdrop has lower z-index than sidebar)
    const closeBtn = page.getByLabel('Close sidebar');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(dashboardLink).not.toBeInViewport();

    // Re-open and click backdrop with force since sidebar intercepts
    await page.getByLabel('Open sidebar').click();
    await expect(dashboardLink).toBeVisible();
    await expect(backdrop).toBeVisible();
    await backdrop.click({ force: true });
    // Wait for the CSS transition to complete
    await page.waitForTimeout(300);
    await expect(dashboardLink).not.toBeInViewport();
  });
});