import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * T028 — WCAG AA Color Contrast Verification
 *
 * Runs axe-core accessibility scans on every page in both light and dark modes.
 * Asserts zero color-contrast violations.
 *
 * WCAG AA requirements:
 *   - 4.5:1 contrast ratio for normal text
 *   - 3:1 contrast ratio for large text (≥18pt or ≥14pt bold)
 */

const pages = [
  { name: 'Events listing', path: '/events' },
  { name: 'Login', path: '/auth/login' },
  { name: 'Register', path: '/auth/register' },
];

test.describe('WCAG AA Color Contrast — Light Mode', () => {
  for (const { name, path } of pages) {
    test(`${name} page has no contrast violations in light mode`, async ({ page }) => {
      // Force light mode
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(path);

      // Set theme to light explicitly
      await page.evaluate(() => {
        localStorage.setItem('theme', 'light');
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Wait for theme toggle to be visible (ensures page is fully rendered)
      await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 10000 });

      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();

      expect(
        results.violations,
        `${name} page has color contrast violations in light mode:\n${JSON.stringify(results.violations, null, 2)}`
      ).toHaveLength(0);
    });
  }
});

test.describe('WCAG AA Color Contrast — Dark Mode', () => {
  for (const { name, path } of pages) {
    test(`${name} page has no contrast violations in dark mode`, async ({ page }) => {
      // Force dark mode
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(path);

      // Set theme to dark explicitly
      await page.evaluate(() => {
        localStorage.setItem('theme', 'dark');
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Wait for theme toggle and dark class
      await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 10000 });
      await expect(page.locator('html')).toHaveClass(/dark/);

      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();

      expect(
        results.violations,
        `${name} page has color contrast violations in dark mode:\n${JSON.stringify(results.violations, null, 2)}`
      ).toHaveLength(0);
    });
  }
});
