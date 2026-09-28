import { test, expect, type Page } from '@playwright/test';

// Samples the <html> class on every DOM mutation batch from before the body
// is parsed. The blocking script sets the class synchronously before <main>
// is parsed, so the first batch that contains <main> shows the first-paint mode.
async function trackHtmlClass(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__classes = [];
    new MutationObserver(() => {
      w.__classes.push({ cls: document.documentElement.className, main: !!document.querySelector('main') });
    }).observe(document, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  });
}

async function firstContentClass(page: Page) {
  return page.evaluate(() => {
    const list = (window as any).__classes as { cls: string; main: boolean }[];
    return { atFirstPaint: list.find((e) => e.main)?.cls ?? '', all: list.filter((e) => e.main) };
  });
}

test.describe('server-rendered theme (fixture server)', () => {
  test('public page is in the server HTML', async ({ request }) => {
    const html = await (await request.get('/spike/storefront/org-public')).text();
    expect(html).toContain('Summer Series 2027');
    expect(html).toContain('Show number 1');
  });

  test('private store: gate on the server, unlock sets cookie, stale cookie cleared', async ({ page, context, request }) => {
    const html = await (await request.get('/spike/storefront/org-private')).text();
    expect(html).toContain('store-gate');
    expect(html).not.toContain('Show number 1');

    await page.goto('/spike/storefront/org-private');
    await page.getByLabel('Enter password').fill('letmein');
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.getByText('Summer Series 2027').first()).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === 'jump_store_access_org-private');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.domain).toBe('localhost'); // host-only

    await context.clearCookies();
    await context.addCookies([{ name: 'jump_store_access_org-private', value: 'stale', domain: 'localhost', path: '/' }]);
    await page.goto('/spike/storefront/org-private');
    await expect(page.getByTestId('store-gate')).toBeVisible();
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === 'jump_store_access_org-private')).toBe(false);
  });

  for (const [org, scheme, expected] of [
    ['org-public', 'dark', 'light'],
    ['org-dark', 'light', 'dark'],
    ['org-system', 'dark', 'dark'],
    ['org-system', 'light', 'light'],
  ] as const) {
    test(`no theme flash: ${org} with OS ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await trackHtmlClass(page);
      await page.goto(`/spike/storefront/${org}`);
      await page.waitForLoadState('networkidle');
      const { atFirstPaint, all } = await firstContentClass(page);
      const final = await page.evaluate(() => document.documentElement.className);
      expect(atFirstPaint.split(' ')).toContain(expected);
      expect(final.split(' ')).toContain(expected);
      // Once <main> exists the class never flips away from the expected mode.
      const after = all.map((e) => e.cls.includes('dark') ? 'dark' : 'light');
      expect(after.every((m) => m === expected), JSON.stringify(all)).toBe(true);
    });
  }

  test('control: today\'s BrandScope flashes (proves the probe detects a flash)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await trackHtmlClass(page);
    await page.goto('/spike/legacy-dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    const { atFirstPaint } = await firstContentClass(page);
    expect(atFirstPaint).not.toContain('dark');
  });

  test('visitor mode returns after leaving the org page (gotcha 7)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/spike/storefront/org-dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('link', { name: 'Leave store' }).click();
    await expect(page.getByText('blank')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('five thumbnails at once, each its own theme, dark written in HTML without script', async ({ page }) => {
    const orgs = ['org-public', 'org-dark', 'org-private', 'org-system', 'org-big'];
    await page.setContent(
      orgs
        .map((o) => `<iframe sandbox title="${o}" src="http://localhost:${process.env.PLAYWRIGHT_PORT || '3111'}/theme-thumbnail/${o}?t=thumb-${o}" width="640" height="400"></iframe>`)
        .join(''),
    );
    for (const o of orgs) {
      const frame = page.frameLocator(`iframe[title="${o}"]`);
      await expect(frame.getByText('Summer Series 2027').first()).toBeVisible();
      await expect(frame.locator('[data-thumbnail-mode]')).toHaveAttribute('data-thumbnail-mode', o === 'org-dark' ? 'dark' : 'light');
    }
    // Private store thumbnail renders the theme, not the gate.
    await expect(page.frameLocator('iframe[title="org-private"]').getByTestId('store-gate')).toHaveCount(0);
  });

  test('thumbnail route 404s without a token', async ({ request }) => {
    expect((await request.get('/theme-thumbnail/org-public')).status()).toBe(404);
  });
});
