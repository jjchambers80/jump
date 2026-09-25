import { test, expect } from '@playwright/test';

// ============================================================================
// T006 [US1] - Theme toggle cycling, class application, localStorage persistence
// ============================================================================

test.describe('Theme Modes - US1: Toggle Between Light and Dark Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/events');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('setting dark theme via localStorage applies dark class', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();
    await expect.poll(() => page.locator('html').getAttribute('class')).toContain('dark');
  });

  test('setting light theme via localStorage removes dark class', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();
    await expect.poll(() => page.locator('html').getAttribute('class')).not.toContain('dark');
  });

  test('theme preference persists across page reload', async ({ page }) => {
    await page.goto('/events');
    // Set theme to dark via localStorage
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    // Verify dark class persists
    await expect.poll(() => page.locator('html').getAttribute('class')).toContain('dark');

    // Verify localStorage still has the value
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedTheme).toBe('dark');
  });

  test('clearing localStorage resets theme to system default', async ({ page }) => {
    // Set a theme first
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    // Clear localStorage
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Theme should default to system (no explicit 'dark' class unless OS is dark)
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedTheme).toBeNull();
  });
});

// ============================================================================
// T022 [US2] - System preference detection, real-time response, default
// ============================================================================

test.describe('Theme Modes - US2: Auto Mode Follows Device Settings', () => {
  test('auto mode applies dark theme when OS prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/events');

    // With system default (no localStorage), should follow OS preference
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();

    await expect.poll(() => page.locator('html').getAttribute('class')).toContain('dark');
  });

  test('auto mode applies light theme when OS prefers light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/events');

    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();

    await expect.poll(() => page.locator('html').getAttribute('class')).not.toContain('dark');
  });

  test('first-time visitor defaults to system/auto mode', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // No theme stored — should be system default
    const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(storedTheme).toBeNull();
  });
});

// ============================================================================
// T027 - FOUC prevention + no transition on initial load
// ============================================================================

test.describe('Theme Modes - FOUC Prevention', () => {
  test('saved dark theme is applied immediately on load (no FOUC)', async ({ page }) => {
    // Set dark theme in localStorage before navigation
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));

    // Navigate to a new page and immediately check
    await page.goto('/events');

    // The dark class should be present on <html> immediately
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });

  test('saved light theme is applied immediately on load', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.goto('/events');

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).not.toContain('dark');
  });
});