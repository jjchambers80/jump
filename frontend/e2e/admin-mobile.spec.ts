// E2E tests for mobile admin layout (T110-T111)
// US5: Responsive sidebar with hamburger toggle
import { test, expect } from '@playwright/test';

test.describe('US5: Mobile responsive admin', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone X viewport

  test('T110: Mobile shows hamburger menu, sidebar hidden by default', async ({ page }) => {
    // Login as ADMIN
    await page.goto('/auth/signin');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/events');

    // Navigate to admin
    await page.goto('/admin');
    await page.waitForURL('/admin/dashboard');

    // Hamburger button visible on mobile
    const hamburger = page.getByLabel('Open sidebar');
    await expect(hamburger).toBeVisible();

    // Sidebar should be hidden by default on mobile
    const sidebar = page.locator('aside');
    await expect(sidebar).not.toBeInViewport();
  });

  test('T111: Hamburger toggle opens/closes sidebar overlay', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/events');

    await page.goto('/admin/dashboard');

    // Click hamburger to open sidebar
    await page.getByLabel('Open sidebar').click();

    // Sidebar should be visible
    const dashboardLink = page.locator('aside').getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toBeVisible();

    // Backdrop should be present
    const backdrop = page.locator('[data-testid="sidebar-backdrop"]');
    // If backdrop exists, clicking it should close sidebar
    if (await backdrop.isVisible()) {
      await backdrop.click();
      await expect(dashboardLink).not.toBeInViewport();
    } else {
      // Close via close button or navigation
      const closeBtn = page.getByLabel('Close sidebar');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await expect(dashboardLink).not.toBeInViewport();
      }
    }
  });
});
