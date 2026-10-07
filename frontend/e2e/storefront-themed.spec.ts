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

  test('full-width page: theme sections edge to edge around the page content', async ({ page }) => {
    await page.goto('/organizations/theme-light/pages/vendors');
    const main = page.locator('main#storefront-main');
    await expect(main.getByRole('heading', { name: 'Book your table' })).toBeVisible();
    await expect(main.getByTestId('storefront-page').getByRole('heading', { name: 'Sell at the market' })).toBeVisible();
    await expect(main.getByText('Tables from $40.')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Questions before you apply?' })).toBeVisible();
    // One landmark: the page body renders as a div inside the frame's main.
    await expect(page.locator('main')).toHaveCount(1);
    const order = await main.locator('[data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['Hero', 'PageContent', 'CallToAction']);
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

test.describe('starter homepage sections (038S)', () => {
  test('a saved homepage renders on the server from the starter sections', async ({ request }) => {
    const html = await (await request.get('/organizations/theme-home')).text();
    expect(html).toContain('Summer Series 2031');
    expect(html).toContain('About the series');
    expect(html).toContain('Bring a friend');
    expect(html).not.toContain('data-section="EventList"');
  });

  test('buttons resolve their links, a gone target drops out, upcoming events link to the Events page', async ({ page }) => {
    await page.goto('/organizations/theme-home');
    const hero = page.locator('[data-section="Hero"]');
    await expect(hero.getByRole('heading', { level: 2, name: 'Summer Series 2031' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'See all events' })).toHaveAttribute('href', '/organizations/theme-home/events');
    await expect(hero.getByText('Deleted page')).toHaveCount(0);

    const upcoming = page.getByRole('region', { name: 'Coming up' });
    await expect(upcoming.locator('[data-testid^="event-card-name-"]')).toHaveCount(2);
    await upcoming.getByRole('link', { name: 'View all events' }).click();
    await expect(page).toHaveURL(/\/organizations\/theme-home\/events$/);
    await expect(page.locator('[data-section="EventList"]')).toHaveCount(1);
  });

  test('one h1 per page: the organization name on the homepage', async ({ page }) => {
    await page.goto('/organizations/theme-home');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riverside Presents');
  });

  test('hero carousel: slides swipe in a track, arrows and dots move it, rotation pauses (spec 041)', async ({ page }) => {
    await page.goto('/organizations/theme-blocks');
    const carousel = page.getByRole('region', { name: 'Featured' });
    await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
    await expect(carousel.getByRole('group', { name: 'Slide 1 of 3' })).toBeVisible();
    const pause = carousel.getByRole('button', { name: 'Pause slides' });
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    // Moving the slides yourself stops the rotation for good.
    await carousel.getByRole('button', { name: 'Next slide' }).click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(carousel.getByRole('button', { name: 'Slide 2 of 3' })).toHaveAttribute('aria-current', 'true');
    await expect(carousel.getByRole('heading', { name: 'Late show' })).toBeInViewport();
    await carousel.getByRole('button', { name: 'Slide 3 of 3' }).click();
    await expect(carousel.getByRole('heading', { name: 'Closing party' })).toBeInViewport();
    await expect(carousel.getByRole('link', { name: 'See all events' })).toHaveAttribute('href', '/organizations/theme-blocks/events');
  });

  test('hero carousel: the pause button comes first and phones get arrows (spec 046E)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/organizations/theme-blocks');
    const carousel = page.getByRole('region', { name: 'Featured' });
    // APG: the rotation control is the first control in the carousel's tab order.
    await expect(carousel.getByRole('button').first()).toHaveAccessibleName('Pause slides');
    const next = carousel.getByRole('button', { name: 'Next slide' });
    await expect(next).toBeVisible();
    await next.click();
    await expect(carousel.getByRole('button', { name: 'Slide 2 of 3' })).toHaveAttribute('aria-current', 'true');
    await expect(carousel.getByRole('button', { name: 'Previous slide' })).toBeVisible();
  });

  test('hero carousel never rotates on its own under reduced motion (spec 041)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/organizations/theme-blocks');
    const carousel = page.getByRole('region', { name: 'Featured' });
    await expect(carousel.getByRole('button', { name: 'Pause slides' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('hero video: edge to edge, fills the window behind the header, never plays under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/organizations/theme-video');
    const hero = page.locator('[data-section="Hero"] section');
    const video = hero.getByTestId('hero-video');
    await expect(video).toHaveAttribute('poster', /parity-cover/);
    await expect(hero.getByRole('button', { name: 'Pause background video' })).toHaveAttribute('aria-pressed', 'true');
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    const box = (await hero.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    // Home page: the header lies over the hero, which starts at the top of the window.
    expect(Math.round(box.y)).toBe(0);
    await expect.poll(async () => Math.round((await hero.boundingBox())!.height)).toBe(844);
    await expect(page.locator('[data-header-overlay]')).toHaveCount(1);
    const header = (await page.locator('[data-section="Header"]').boundingBox())!;
    await expect
      .poll(async () => (await hero.getByRole('heading', { name: 'Become a vendor' }).boundingBox())!.y)
      .toBeGreaterThan(header.y + header.height);
  });

  test('the header overlays the hero on the home page only', async ({ page }) => {
    await page.goto('/organizations/theme-video/events');
    await expect(page.getByTestId('organization-header')).toBeVisible();
    await expect(page.locator('[data-header-overlay]')).toHaveCount(0);
    // A home page that opens with a plain Hero keeps the header above it.
    await page.goto('/organizations/theme-home');
    await expect(page.getByRole('heading', { name: 'Summer Series 2031' })).toBeVisible();
    await expect(page.locator('[data-header-overlay]')).toHaveCount(0);
  });

  test('hero mobileLayout button-bottom: full-width button at the bottom on phones only', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/organizations/theme-video');
    const hero = page.locator('[data-section="Hero"] section');
    const button = hero.getByRole('link', { name: 'See all events' });
    const heading = hero.getByRole('heading', { name: 'Become a vendor' });
    await expect(button).toBeVisible();
    const heroBox = (await hero.boundingBox())!;
    const btn = (await button.boundingBox())!;
    expect(Math.round(btn.width)).toBe(390 - 48);
    const gap = heroBox.y + heroBox.height - (btn.y + btn.height);
    expect(gap).toBeGreaterThan(64);
    expect(gap).toBeLessThan(100);
    await page.screenshot({ path: test.info().outputPath('hero-mobile.png') });
    const h = (await heading.boundingBox())!;
    expect(btn.y - (h.y + h.height)).toBeGreaterThan(200);

    await page.setViewportSize({ width: 1024, height: 800 });
    const wide = (await button.boundingBox())!;
    expect(wide.width).toBeLessThan(400);
    const wideHeading = (await heading.boundingBox())!;
    expect(wide.y - (wideHeading.y + wideHeading.height)).toBeLessThan(100);
  });

  test('FAQ: native disclosures, one answer open at a time (spec 041)', async ({ page }) => {
    await page.goto('/organizations/theme-blocks');
    const faq = page.getByRole('region', { name: 'Good to know' });
    await faq.getByText('Is there parking?').click();
    await expect(faq.getByText('Free parking behind the hall.')).toBeVisible();
    await faq.getByText('When do doors open?').click();
    await expect(faq.getByText('One hour before the show.')).toBeVisible();
    await expect(faq.getByText('Free parking behind the hall.')).toBeHidden();
  });
});

// One header everywhere: a themed organization's event page is framed by the
// same theme header (and footer) as its home page, so the logo and header
// height match. The event body is still the client page, mocked in the browser.
test.describe('themed event page', () => {
  function eventBody(orgId: string, logoUrl: string | null) {
    return {
      id: `${orgId}-event-0`,
      slug: `${orgId}-show-0`,
      name: 'Summer Show 1',
      description: '<p>Fixture</p>',
      date: '2031-06-01T23:00:00.000Z',
      imageUrl: null,
      logoUrl: null,
      taxRate: 0,
      organizationId: orgId,
      organizationName: 'Riverside Presents',
      organizationLogoUrl: logoUrl,
      organizationBrandColor: '#0f766e',
      organizationThemeMode: 'LIGHT',
      organizationSignInLinks: false,
      venue: { id: 'v1', name: 'Riverside Hall', address: '1 River Rd', timezone: 'America/New_York' },
      priceTiers: [
        { id: 't1', name: 'General', description: null, price: 20, quantityTotal: 100, quantityAvailable: 100, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10 },
      ],
      createdAt: '2031-01-01T00:00:00.000Z',
      updatedAt: '2031-01-01T00:00:00.000Z',
    };
  }

  async function mockEvent(page: Page, orgId: string, logoUrl: string | null = null) {
    await page.route(`http://localhost:3002/events/${orgId}-show-0`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventBody(orgId, logoUrl)) }),
    );
  }

  test('renders inside the theme frame with one header and one footer', async ({ page }) => {
    await mockEvent(page, 'theme-light');
    await page.goto('/events/theme-light-show-0');
    await expect(page.getByRole('heading', { level: 1, name: 'Summer Show 1' })).toBeVisible();
    await expect(page.locator('[data-theme-frame]')).toHaveCount(1);
    await expect(page.getByTestId('organization-header')).toHaveCount(1);
    await expect(page.locator('[data-section="Header"]')).toHaveCount(1);
    await expect(page.locator('[data-section="Footer"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Contact us' })).toHaveCount(1);
    // The organization name is a link home here, not the page's h1.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  for (const viewport of [
    { width: 390, height: 844, logo: 90 },
    { width: 1440, height: 900, logo: 120 },
  ]) {
    test(`${viewport.width}px: logo and header height match the home page`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const measure = async () => {
        const header = page.getByTestId('organization-header');
        const logo = header.getByTestId('logo-box');
        await expect(logo).toBeVisible();
        return { header: Math.round((await header.boundingBox())!.height), logo: Math.round((await logo.boundingBox())!.width) };
      };

      await page.goto('/organizations/theme-logo');
      const home = await measure();
      await mockEvent(page, 'theme-logo');
      await page.goto('/events/theme-logo-show-0');
      const event = await measure();

      expect(home.logo).toBe(viewport.logo);
      expect(event).toEqual(home);
    });
  }
});

test.describe('Draft theme preview (038K)', () => {
  const previewToken = (sig: string) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ orgId: 'theme-home', exp: 4102444800 })).toString('base64url')}.${sig}`;

  test('a preview link sets the cookie, shows the bar, and Exit clears it', async ({ page, context }) => {
    // The route handler only reads orgId/exp; the fixture API accepts this one cookie value.
    await page.goto(`/api/storefront/preview?token=${previewToken('sig')}`);
    await expect(page).toHaveURL(/\/organizations\/theme-home$/);
    const cookie = (await context.cookies()).find((c) => c.name === 'jump_theme_preview');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    await context.addCookies([{ name: 'jump_theme_preview', value: 'fixture-preview', domain: 'localhost', path: '/' }]);
    await page.reload();
    const bar = page.getByRole('region', { name: 'Theme preview' });
    await expect(bar).toContainText('Previewing Summer draft');
    await bar.getByRole('link', { name: 'Exit preview' }).click();
    await expect(page.getByRole('region', { name: 'Theme preview' })).toHaveCount(0);
    expect((await context.cookies()).some((c) => c.name === 'jump_theme_preview')).toBe(false);
  });

  test('a refused preview cookie is expired by the route handler', async ({ page, context }) => {
    await context.addCookies([{ name: 'jump_theme_preview', value: 'expired', domain: 'localhost', path: '/' }]);
    await page.goto('/organizations/theme-home');
    await expect(page.getByRole('region', { name: 'Theme preview' })).toHaveCount(0);
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === 'jump_theme_preview')).toBe(false);
  });

  test('a preview link redirects to the public host, not the server listener', async ({ request }) => {
    // Railway's proxy: request.url is the internal listener; the browser's host arrives forwarded.
    const res = await request.get(`/api/storefront/preview?token=${previewToken('sig')}`, {
      maxRedirects: 0,
      headers: { 'x-forwarded-host': 'frontend-production-43e9.up.railway.app', 'x-forwarded-proto': 'https' },
    });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toBe('https://frontend-production-43e9.up.railway.app/organizations/theme-home');
  });

  test('preview links never redirect off-site on exit', async ({ request }) => {
    const res = await request.get('/api/storefront/preview?to=//evil.example', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers().location).pathname).toBe('/');
    expect(new URL(res.headers().location).host).toMatch(/^localhost/);
  });
});

test.describe('layout widths', () => {
  test('page width override and section widths size the content containers', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/organizations/theme-widths');
    const width = (selector: string) => page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await expect(page.getByRole('heading', { name: 'Full list' })).toBeVisible();
    // Header follows the page's own 1000 px width, not the theme's 1280.
    expect(await width('[data-section="Header"] .max-w-7xl')).toBe(1000);
    expect(await width('[data-section="UpcomingEvents"]:has-text("Narrow list") .max-w-7xl')).toBe(768);
    expect(await width('[data-section="UpcomingEvents"]:has-text("Full list") .max-w-7xl')).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  });
});
