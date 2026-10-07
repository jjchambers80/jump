// The About landing page: a full-width Content page built from theme sections
// (Hero, Stats, Image with text, Feature grid, Upcoming events, Call to
// action), served by the SSR fixture API (fixtures/aboutLanding.mjs). Checks
// the structure, both calls to action, the hero buttons on the photo, and axe,
// on phone and desktop.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const URL = '/organizations/theme-about/pages/about';

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`about landing page on ${viewport.name}: structure, calls to action and axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const main = page.locator('main#storefront-main');

    await expect(main.getByRole('heading', { level: 1 })).toHaveText('About Raleigh Retro Gamers');
    await expect(main.getByTestId('storefront-page')).toHaveCount(0);

    const order = await main.locator('[data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['Hero', 'Stats', 'ImageWithText', 'FeatureGrid', 'ImageWithText', 'FeatureGrid', 'UpcomingEvents', 'CallToAction']);

    // Both calls to action are on screen in the hero and resolve everywhere.
    const hero = main.locator('[data-section="Hero"]');
    const events = hero.getByRole('link', { name: 'See upcoming events' });
    const vendor = hero.getByRole('link', { name: 'Become a vendor' });
    await expect(events).toBeInViewport();
    await expect(vendor).toBeInViewport();
    for (const link of await main.getByRole('link', { name: 'See upcoming events' }).all()) {
      await expect(link).toHaveAttribute('href', '/organizations/theme-about/events');
    }
    for (const link of await main.getByRole('link', { name: 'Become a vendor' }).all()) {
      await expect(link).toHaveAttribute('href', '/organizations/theme-about/pages/vendors');
    }

    // The outlined button sits on the darkened photo: its text must be white,
    // not the page's text color (axe cannot measure contrast over an image).
    await expect(vendor).toHaveCSS('color', 'rgb(255, 255, 255)');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page })
      .include('main#storefront-main')
      .exclude('iframe')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
