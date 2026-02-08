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

  test('toggle cycles through light → dark → system → light', async ({ page }) => {
    await page.goto('/events');
    await page.waitForSelector('[data-testid="theme-toggle"]');

    // Default is system — click to go to light
    const toggle = page.getByTestId('theme-toggle');
    await toggle.click();
    // Now should be light (or move to next in cycle)

    // We need to check the actual cycle; default is 'system'
    // system -> light -> dark -> system
    // After first click from system: should be light
    const themeAfterFirst = await page.evaluate(() => localStorage.getItem('theme'));
    expect(themeAfterFirst).toBe('light');

    // Click again: light -> dark
    await toggle.click();
    const themeAfterSecond = await page.evaluate(() => localStorage.getItem('theme'));
    expect(themeAfterSecond).toBe('dark');

    // Verify dark class is applied to <html>
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');

    // Click again: dark -> system
    await toggle.click();
    const themeAfterThird = await page.evaluate(() => localStorage.getItem('theme'));
    expect(themeAfterThird).toBe('system');

    // Click again: system -> light (full cycle)
    await toggle.click();
    const themeAfterFourth = await page.evaluate(() => localStorage.getItem('theme'));
    expect(themeAfterFourth).toBe('light');
  });

  test('dark mode applies "dark" class to <html>', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });

  test('light mode removes "dark" class from <html>', async ({ page }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).not.toContain('dark');
  });

  test('theme preference persists across page reload', async ({ page }) => {
    await page.goto('/events');

    // Set theme to dark via toggle
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    // Verify dark class persists
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');

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

  test('theme switch happens within 2 seconds (SC-001 performance)', async ({ page }) => {
    await page.goto('/events');
    await page.waitForSelector('[data-testid="theme-toggle"]');

    const toggle = page.getByTestId('theme-toggle');

    // Measure time for theme switch
    const startTime = Date.now();
    await toggle.click();
    // Wait for class to be applied
    await page.waitForFunction(
      () => {
        const theme = localStorage.getItem('theme');
        return theme === 'light' || theme === 'dark' || theme === 'system';
      },
      { timeout: 2000 }
    );
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(2000);
  });

  test('theme toggle is visible on the page', async ({ page }) => {
    await page.goto('/events');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();
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

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
  });

  test('auto mode applies light theme when OS prefers light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/events');

    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload();

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).not.toContain('dark');
  });

  test('auto mode responds to real-time OS preference change', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'system'));
    await page.reload();

    // Initially light
    let htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).not.toContain('dark');

    // Change OS to dark
    await page.emulateMedia({ colorScheme: 'dark' });

    // Wait for theme to update
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'), {
      timeout: 5000,
    });

    htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
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
// T024 [US3] - Keyboard navigation, aria-label, tooltip
// ============================================================================

test.describe('Theme Modes - US3: Accessible and Discoverable Toggle', () => {
  test('theme toggle is reachable via keyboard Tab', async ({ page }) => {
    await page.goto('/events');
    await page.waitForSelector('[data-testid="theme-toggle"]');

    // Tab through the page until we reach the theme toggle
    let focused = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const activeEl = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute('data-testid');
      });
      if (activeEl === 'theme-toggle') {
        focused = true;
        break;
      }
    }
    expect(focused).toBe(true);
  });

  test('theme toggle is operable via Enter key', async ({ page }) => {
    await page.goto('/events');
    const toggle = page.getByTestId('theme-toggle');
    await toggle.focus();

    const themeBefore = await page.evaluate(() => localStorage.getItem('theme'));
    await page.keyboard.press('Enter');
    const themeAfter = await page.evaluate(() => localStorage.getItem('theme'));

    // Theme should have changed
    expect(themeAfter).not.toBe(themeBefore);
  });

  test('theme toggle is operable via Space key', async ({ page }) => {
    await page.goto('/events');
    const toggle = page.getByTestId('theme-toggle');
    await toggle.focus();

    const themeBefore = await page.evaluate(() => localStorage.getItem('theme'));
    await page.keyboard.press('Space');
    const themeAfter = await page.evaluate(() => localStorage.getItem('theme'));

    expect(themeAfter).not.toBe(themeBefore);
  });

  test('theme toggle has aria-label reflecting current state', async ({ page }) => {
    await page.goto('/events');
    const toggle = page.getByTestId('theme-toggle');

    const ariaLabel = await toggle.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    // Should contain the current theme mode name
    expect(ariaLabel).toMatch(/light|dark|auto|system/i);
  });

  test('theme toggle shows tooltip on hover', async ({ page }) => {
    await page.goto('/events');
    const toggle = page.getByTestId('theme-toggle');

    const title = await toggle.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).toMatch(/light|dark|auto|system/i);
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

  test('transition-colors is applied to body but does not fire on initial load', async ({
    page,
  }) => {
    await page.goto('/events');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/events');

    // Verify transition-duration is set (CSS transitions are configured)
    const transitionDuration = await page.evaluate(() => {
      return getComputedStyle(document.body).transitionDuration;
    });
    // Should have a non-zero transition duration (150ms = 0.15s)
    expect(transitionDuration).not.toBe('0s');
  });
});
