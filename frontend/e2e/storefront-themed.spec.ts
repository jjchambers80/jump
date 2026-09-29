// Spec 038B: server-rendered themed storefront against the SSR fixture API
// (e2e/fixtures/server.mjs). Acceptance tests 1 (private store on the
// server), 12 (no theme-mode flash) and 17 (rollback to the legacy renderer).

import { expect as baseExpect, test, type Page } from '@playwright/test';
import { PARITY_COVER, parityMenus, parityPublic } from './fixtures/storefront.mjs';

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

test.describe('Events page (038C)', () => {
  test('the org home falls back to the Events template and /events renders it too (D5)', async ({ page }) => {
    await page.goto('/organizations/theme-light');
    await expect(page.locator('[data-section="EventList"]')).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('heading', { name: 'Upcoming events' })).toBeVisible();
    await page.goto('/organizations/theme-light/events');
    await expect(page.locator('[data-section="EventList"]')).toHaveCount(1);
    await expect(page.getByText('Summer Show 3')).toBeVisible();
  });

  test('an organization outside the rollout gets today\'s storefront on /events too', async ({ page }) => {
    await page.route('**/organizations/legacy-events/public', (route) => route.fulfill({ json: parityPublic('legacy-events') }));
    await page.route('**/organizations/legacy-events/public/menus', (route) => route.fulfill({ json: parityMenus() }));
    await page.route(`**${PARITY_COVER}`, (route) => route.fulfill({ contentType: 'image/png', body: COVER_PNG }));
    await page.goto('/organizations/legacy-events/events');
    await expect(page.getByText('Summer Show 1').first()).toBeVisible();
    await expect(page.locator('[data-theme-frame]')).toHaveCount(0);
  });
});

// 1×1 teal PNG, stretched by object-cover: the same pixels on both pages.
const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgqP/PAAAC/gF6+CQL1QAAAABJRU5ErkJggg==',
  'base64',
);

/** Share of pixels that differ by more than a small per-channel tolerance, computed in the browser. */
async function pixelDiff(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([a64, b64]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${src}`;
        });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { ratio: 1, size: [ia.width, ia.height, ib.width, ib.height] };
      const read = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const da = read(ia);
      const db = read(ib);
      let differing = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) > 16 || Math.abs(da[i + 1] - db[i + 1]) > 16 || Math.abs(da[i + 2] - db[i + 2]) > 16) differing += 1;
      }
      return { ratio: differing / (da.length / 4), size: [ia.width, ia.height] };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

test.describe('screenshot parity with today\'s org home (test 10)', () => {
  for (const width of [1440, 390]) {
    for (const mode of ['LIGHT', 'DARK'] as const) {
      test(`${width}px ${mode.toLowerCase()}`, async ({ page, browser }) => {
        const themedOrg = mode === 'DARK' ? 'theme-parity-dark' : 'theme-parity';
        const legacyOrg = mode === 'DARK' ? 'parity-legacy-dark' : 'parity-legacy';
        const shoot = async (p: Page, url: string) => {
          await p.setViewportSize({ width, height: 900 });
          await p.route(`**${PARITY_COVER}`, (route) => route.fulfill({ contentType: 'image/png', body: COVER_PNG }));
          await p.goto(url);
          await expect(p.getByText('Summer Show 3').first()).toBeVisible();
          // The legacy page fetches its menus after the events: wait for the footer and nav too.
          await expect(p.getByTestId('storefront-footer')).toBeVisible();
          await expect(p.locator('img[alt$="cover"]')).toHaveJSProperty('complete', true);
          await p.waitForLoadState('networkidle');
          // Settle: the list's entrance animation and the org's forced mode.
          await p.waitForTimeout(600);
          return p.screenshot({ fullPage: true, animations: 'disabled' });
        };

        const legacy = await browser.newPage();
        await legacy.route(`**/organizations/${legacyOrg}/public`, (route) => route.fulfill({ json: parityPublic(legacyOrg, mode) }));
        await legacy.route(`**/organizations/${legacyOrg}/public/menus`, (route) => route.fulfill({ json: parityMenus() }));
        const before = await shoot(legacy, `/organizations/${legacyOrg}`);
        await legacy.close();

        const after = await shoot(page, `/organizations/${themedOrg}/events`);
        if (process.env.PARITY_SHOTS_DIR) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(`${process.env.PARITY_SHOTS_DIR}/${width}-${mode}-legacy.png`, before);
          writeFileSync(`${process.env.PARITY_SHOTS_DIR}/${width}-${mode}-themed.png`, after);
        }
        const diff = await pixelDiff(page, before, after);
        expect(diff.ratio, JSON.stringify(diff)).toBeLessThan(0.001);
      });
    }
  }
});
