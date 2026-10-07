// The Vendor FAQ landing page: a full-width Content page built from theme
// sections, with the questions in three Faq accordions, served by the SSR
// fixture API (fixtures/vendorFaqLanding.mjs). Checks the structure, the
// calls to action, keyboard use of the accordion, and axe with every answer
// open, on phone and desktop.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const URL = '/organizations/theme-vendor-faq/pages/vendor-faq';

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`vendor FAQ landing page on ${viewport.name}: structure, accordion, calls to action and axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const main = page.locator('main#storefront-main');

    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Vendor FAQ');
    const order = await main.locator('[data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['Hero', 'Stats', 'Checklist', 'ImageWithText', 'Faq', 'Steps', 'Faq', 'ImageWithText', 'Faq', 'CallToAction']);

    const hero = main.locator('[data-section="Hero"]');
    await expect(hero.getByRole('link', { name: 'Apply to be a vendor' })).toBeInViewport();
    await expect(hero.getByRole('link', { name: 'Contact us' })).toBeInViewport();
    await expect(hero.getByRole('link', { name: 'Contact us' })).toHaveCSS('color', 'rgb(255, 255, 255)');
    for (const link of await main.getByRole('link', { name: 'Apply to be a vendor' }).all()) {
      await expect(link).toHaveAttribute('href', '/organizations/theme-vendor-faq/pages/vendor-application');
    }
    for (const link of await main.getByRole('link', { name: 'Contact us' }).all()) {
      await expect(link).toHaveAttribute('href', '/organizations/theme-vendor-faq/pages/contact');
    }

    // Every question of the original page, closed until asked; the keyboard opens one.
    const questions = main.locator('details > summary');
    await expect(questions).toHaveCount(14);
    const refund = main.locator('details', { has: page.getByText('Are vendor fees refundable?') });
    await expect(refund).not.toHaveAttribute('open');
    await refund.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(refund).toHaveAttribute('open');
    await expect(refund.getByText('There is a 5% refund fee if you cancel outside of 30 days.', { exact: false })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Open every answer so axe checks their contents too.
    await main.locator('details').evaluateAll((els) => els.forEach((el) => ((el as HTMLDetailsElement).open = true)));
    const results = await new AxeBuilder({ page })
      .include('main#storefront-main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
