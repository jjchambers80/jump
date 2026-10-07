// A full-width Content page built from the landing sections (Image with
// text + video, Stats, Feature grid with photos, Checklist, Steps, Call to action),
// served by the SSR fixture API (fixtures/vendorLanding.mjs). Checks the
// structure screen readers get, the apply links and axe, on phone and desktop.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const URL = '/organizations/theme-vendors/pages/vendors';
const APPLY = '/organizations/theme-vendors/pages/vendor-application';

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`vendor landing page on ${viewport.name}: structure, apply links and axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // No network in the suite: the player frame stays empty.
    await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
    await page.goto(URL);
    const main = page.locator('main#storefront-main');

    // One h1, from the opening section; the old page body is not rendered.
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Interested in becoming a vendor?');
    await expect(main.getByTestId('storefront-page')).toHaveCount(0);
    await expect(main.locator('iframe[title="Raleigh Retro Gamers vendor video"]')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/UavsDmOhMys',
    );

    const order = await main.locator('[data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['ImageWithText', 'Stats', 'FeatureGrid', 'Checklist', 'Checklist', 'Steps', 'CallToAction']);

    // Every apply button goes to the application page; the first is on screen.
    const apply = main.getByRole('link', { name: 'Apply to be a vendor' });
    await expect(apply).toHaveCount(2);
    for (const link of await apply.all()) await expect(link).toHaveAttribute('href', APPLY);
    await expect(apply.first()).toBeInViewport();

    const stats = main.getByRole('region', { name: 'We are always looking for new vendors' });
    await expect(stats.getByRole('definition').first()).toHaveText('25,000+');
    // The "Why" cards carry the event photos, each with its own description.
    const photos = main.getByRole('region', { name: 'Why should I become a vendor?' }).getByRole('img');
    await expect(photos).toHaveCount(3);
    for (const img of await photos.all()) expect((await img.getAttribute('alt'))?.length).toBeGreaterThan(20);
    const wanted = main.getByRole('region', { name: 'What types of vendors are you looking for?' }).getByRole('listitem');
    await expect(wanted).toHaveCount(13);
    const notAllowed = main.getByRole('region', { name: 'What types of vendors are not allowed?' }).getByRole('listitem');
    await expect(notAllowed).toHaveCount(4);
    await expect(main.getByRole('region', { name: 'How to sign up' }).getByRole('listitem')).toHaveCount(4);
    await expect(main.getByRole('link', { name: 'event page' })).toHaveAttribute('href', 'https://raleighretrogamers.com/event-details/');

    // Phone first: nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page })
      .include('main#storefront-main')
      // The YouTube player is a third-party document.
      .exclude('iframe')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    if (process.env.VENDOR_SCREENSHOTS) await page.screenshot({ path: `${process.env.VENDOR_SCREENSHOTS}/vendors-${viewport.name}.png`, fullPage: true });
  });
}
