import { test, expect } from '@playwright/test';

// The platform root is the Eventimus product homepage (static, no API).
test.describe('Eventimus homepage', () => {
  test('shows the product pitch with sign-up and sign-in links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Eventimus/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your conference, convention or market, sold out from one store.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start selling' }).first()).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/signin');
    await expect(page.getByRole('img', { name: /Raleigh Retro Gamers Halloween Market/ })).toBeVisible();
  });

  test('shows every band heading', async ({ page }) => {
    await page.goto('/');
    for (const name of [
      'Sell wherever your crowd gathers.',
      'One place to run it.',
      'Fill your exhibit hall.',
      'From first meetup to multi-day convention.',
      'A checkout buyers trust.',
      "We've got your back.",
      'Start selling in three steps.',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
  });

  test('fits a phone without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
