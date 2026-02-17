// E2E tests for Navbar admin link (T107-T109)
// US4: Single "Admin" link replaces individual admin links
import { test, expect } from '@playwright/test';

test.describe('US4: Navbar admin link', () => {
  test('T107: ADMIN sees single "Admin" link in navbar (not Dashboard, Orgs, etc.)', async ({
    page,
  }) => {
    // Login as ADMIN
    await page.goto('/auth/signin');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/events');

    const nav = page.locator('nav');
    // Single "Admin" link present
    await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();

    // Old individual links should NOT be present
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Orgs' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Venues' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Analytics' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Scan' })).toBeHidden();

    // "My Tickets" and "Orders" should NOT show for admin
    await expect(nav.getByRole('link', { name: 'My Tickets' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeHidden();
  });

  test('T108: ORGANIZER sees single "Admin" link', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.getByLabel('Email').fill('organizer@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/events');

    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();
    // Customer links hidden for organizer
    await expect(nav.getByRole('link', { name: 'My Tickets' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeHidden();
  });

  test('T109: CUSTOMER sees "My Tickets" and "Orders" but NOT "Admin"', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.getByLabel('Email').fill('customer@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/events');

    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: 'My Tickets' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Admin' })).toBeHidden();
  });
});
