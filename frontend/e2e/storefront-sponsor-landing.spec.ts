// The Sponsors landing page: a full-width Content page built from theme
// sections (Hero, Feature grid, Tiers, Image with text, Steps, Call to
// action), served by the SSR fixture API (fixtures/sponsorLanding.mjs).
// Checks the structure screen readers get, the tier lists, the apply links
// and axe, on phone and desktop.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test } from '@playwright/test';
import { SPONSOR_TIERS } from './fixtures/sponsorLanding.mjs';

const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const URL = '/organizations/theme-sponsors/pages/sponsors';
const APPLY = '/organizations/theme-sponsors/pages/sponsor-application';

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`sponsor landing page on ${viewport.name}: structure, tiers, apply links and axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const main = page.locator('main#storefront-main');

    // One h1, from the hero; the old page body is not rendered.
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Sponsor Raleigh Retro Gamers');
    await expect(main.getByTestId('storefront-page')).toHaveCount(0);

    const order = await main.locator('[data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['Hero', 'FeatureGrid', 'Tiers', 'ImageWithText', 'Steps', 'CallToAction']);

    // The primary call to action is on screen and every apply button goes to the application page.
    const primary = main.getByRole('link', { name: 'Become a sponsor' });
    await expect(primary).toHaveCount(2);
    await expect(primary.first()).toBeInViewport();
    for (const link of [...(await primary.all()), main.getByRole('link', { name: 'Ask about a custom package' })]) {
      await expect(link).toHaveAttribute('href', APPLY);
    }
    await expect(main.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/organizations/theme-sponsors/pages/contact');

    // Each tier is a list item named by its h3, with every benefit of the original page.
    const tiers = main.getByRole('region', { name: 'Sponsorship tiers' });
    await expect(tiers.getByRole('heading', { level: 3 })).toHaveText(SPONSOR_TIERS.map((t) => t.name));
    for (const tier of SPONSOR_TIERS) {
      const card = tiers.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: tier.name }) });
      await expect(card.getByRole('listitem')).toHaveText(tier.benefits);
    }
    await expect(tiers.getByText('Most popular')).toBeVisible();
    await expect(main.getByRole('region', { name: 'How sponsorship works' }).getByRole('listitem')).toHaveCount(3);

    // Phone first: nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page })
      .include('main#storefront-main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    if (process.env.SPONSOR_SCREENSHOTS) await page.screenshot({ path: `${process.env.SPONSOR_SCREENSHOTS}/sponsors-${viewport.name}.png`, fullPage: true });
  });
}
