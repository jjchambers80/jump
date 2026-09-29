// Spec 038B: server-rendered themed storefront against the SSR fixture API
// (e2e/fixtures/server.mjs). Acceptance tests 1 (private store on the
// server), 12 (no theme-mode flash) and 17 (rollback to the legacy renderer).

import { expect as baseExpect, test, type Page } from '@playwright/test';

// Server-rendered routes compile on first hit under `next dev`; give the
// first assertions room so the suite stays deterministic across shards.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

// Samples the <html> class on every DOM mutation batch from before the body
// is parsed. The blocking script sets it before the frame is parsed, so the
// first batch that contains the frame shows the first-paint mode.
async function trackHtmlClass(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __classes: { cls: string; frame: boolean }[] };
    w.__classes = [];
    new MutationObserver(() => {
      w.__classes.push({ cls: document.documentElement.className, frame: !!document.querySelector('[data-theme-frame]') });
    }).observe(document, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  });
}

async function modesAfterFrame(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __classes: { cls: string; frame: boolean }[] }).__classes
      .filter((e) => e.frame)
      .map((e) => (e.cls.split(' ').includes('dark') ? 'dark' : 'light')),
  );
}

test.describe('themed storefront (server-rendered)', () => {
  test('the org home is in the server HTML with the header group', async ({ request }) => {
    const html = await (await request.get('/organizations/theme-light')).text();
    expect(html).toContain('data-theme-frame');
    expect(html).toContain('Summer Show 1');
    expect(html).toContain('Early-bird pricing ends Friday');
    expect(html).toContain('Riverside Presents');
  });

  test('renders header, events and footer from server-resolved data', async ({ page }) => {
    await page.goto('/organizations/theme-light');
    await expect(page.getByRole('heading', { level: 1, name: 'Riverside Presents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming events' })).toBeVisible();
    await expect(page.getByText('Summer Show 2')).toBeVisible();
    await expect(page.getByTestId('storefront-footer').getByRole('link', { name: 'Contact us' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'About' }).first()).toBeVisible();
  });

  test('announcements: one at a time, pause control, close remembered for the session', async ({ page }) => {
    await page.goto('/organizations/theme-light');
    const bar = page.getByTestId('announcement-bar');
    await expect(bar.getByText('Early-bird pricing ends Friday')).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Pause announcements' })).toBeVisible();
    await bar.getByRole('button', { name: 'Next announcement' }).click();
    await expect(bar.getByText('Free parking every show')).toBeVisible();
    await bar.getByRole('button', { name: 'Close' }).click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Summer Show 1')).toBeVisible();
    await expect(page.getByTestId('announcement-bar')).toHaveCount(0);
  });

  test('skip link moves focus to the page body', async ({ page }) => {
    await page.goto('/organizations/theme-light');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    // The first stop may be the announcement bar; tab until the skip link.
    for (let i = 0; i < 6 && !(await skip.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#storefront-main')).toBeFocused();
  });

  test('content page and blog render inside the theme frame', async ({ page }) => {
    await page.goto('/organizations/theme-light/pages/about');
    await expect(page.getByTestId('storefront-page').getByRole('heading', { name: 'About the series' })).toBeVisible();
    await expect(page.locator('[data-theme-frame]')).toHaveCount(1);

    await page.goto('/organizations/theme-light/blogs/news');
    await expect(page.getByRole('heading', { name: 'News' })).toBeVisible();
    await expect(page.getByText('Lineup announced')).toBeVisible();

    await page.goto('/organizations/theme-light/blogs/news/lineup');
    await expect(page.getByTestId('blog-post').getByText('Twelve nights of music by the river.')).toBeVisible();

    await page.goto('/organizations/theme-light/pages/missing');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.locator('[data-theme-frame]')).toHaveCount(1);
  });

  test('rollback: an organization outside the rollout gets the legacy client storefront (test 17)', async ({ page }) => {
    let clientFetches = 0;
    await page.route('**/organizations/theme-legacy/public', (route) => {
      clientFetches += 1;
      return route.fulfill({
        json: {
          organization: { id: 'theme-legacy', name: 'Legacy Hall', logoUrl: null, coverUrl: null, brandColor: '#0f766e', themeMode: 'LIGHT' },
          events: [],
          locked: false,
        },
      });
    });
    await page.route('**/organizations/theme-legacy/public/menus', (route) => route.fulfill({ json: { main: [], footer: [] } }));
    await page.goto('/organizations/theme-legacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Legacy Hall' })).toBeVisible();
    await expect(page.locator('[data-theme-frame]')).toHaveCount(0);
    expect(clientFetches).toBeGreaterThan(0);
  });
});

test.describe('private store on the server (test 1)', () => {
  test('locked: the server HTML is the gate and carries no store content', async ({ request }) => {
    const html = await (await request.get('/organizations/theme-private')).text();
    expect(html).toContain('storefront-password-gate');
    expect(html).toContain('Members only until launch');
    expect(html).not.toContain('Summer Show 1');
    const page = await (await request.get('/organizations/theme-private/pages/about')).text();
    expect(page).toContain('storefront-password-gate');
    expect(page).not.toContain('Since 2009');
  });

  test('unlocking sets a host-only httpOnly cookie and the server renders the store', async ({ page, context }) => {
    await page.goto('/organizations/theme-private');
    await page.getByLabel('Password').fill('letmein');
    await page.getByRole('button', { name: /enter|unlock|continue/i }).click();
    await expect(page.getByText('Summer Show 1')).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === 'jump_store_access_theme-private');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', domain: 'localhost' });
    // The content pages read the same cookie on the server.
    await page.goto('/organizations/theme-private/pages/about');
    await expect(page.getByText('Since 2009 by the river.')).toBeVisible();
  });

  test('a stale cookie gets the gate and is expired by the route handler', async ({ page, context }) => {
    await context.addCookies([{ name: 'jump_store_access_theme-private', value: 'stale', domain: 'localhost', path: '/' }]);
    await page.goto('/organizations/theme-private');
    await expect(page.getByTestId('storefront-password-gate')).toBeVisible();
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === 'jump_store_access_theme-private'))
      .toBe(false);
  });

  test('a wrong password shows an error and sets no cookie', async ({ page, context }) => {
    await page.goto('/organizations/theme-private');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: /enter|unlock|continue/i }).click();
    await expect(page.getByText(/incorrect password/i)).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === 'jump_store_access_theme-private')).toBe(false);
  });
});

test.describe('theme mode without a flash (test 12)', () => {
  for (const [org, scheme, expected] of [
    ['theme-light', 'dark', 'light'],
    ['theme-dark', 'light', 'dark'],
    ['theme-system', 'dark', 'dark'],
    ['theme-system', 'light', 'light'],
  ] as const) {
    test(`${org} with OS ${scheme} paints ${expected} and never flips`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await trackHtmlClass(page);
      await page.goto(`/organizations/${org}`);
      await page.waitForLoadState('networkidle');
      const modes = await modesAfterFrame(page);
      expect(modes.length).toBeGreaterThan(0);
      expect(modes.every((m) => m === expected), JSON.stringify(modes)).toBe(true);
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${expected}\\b`));
    });
  }

  test('the visitor mode returns after leaving the org page (gotcha 7)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/organizations/theme-dark');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });
});
