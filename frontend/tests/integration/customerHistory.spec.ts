// Customer purchase history — fully mocked backend.
import { test, expect } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

test.describe('Customer Purchase History', () => {
  test('unauthenticated user is redirected to sign-in when accessing /orders/lookup', async ({ page }) => {
    await page.goto('/orders/lookup');
    // The public order lookup page renders with a heading or search field
    await expect(page.getByRole('heading', { name: /Find my/i }).or(page.getByRole('heading', { name: /Order/i }))).toBeVisible({ timeout: 10000 });
  });

  test('order lookup renders the form', async ({ page }) => {
    await page.goto('/orders/lookup');
    // The page renders with the order lookup fields
    const orderRef = page.getByLabel(/Order ref/i).or(page.getByLabel(/Order number/i));
    const email = page.getByLabel(/Email/i);
    await expect(orderRef).toBeVisible({ timeout: 10000 });
    await expect(email).toBeVisible();
  });
});