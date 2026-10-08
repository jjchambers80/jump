// Photo galleries on a themed page (spec 046C): masonry with section links,
// the lightbox (keyboard, focus return, counter), the carousel (buttons at
// every width, pause first, no autoplay under reduced motion) and axe, on
// phone and desktop. Served by the SSR fixture API (fixtures/storefront.mjs).

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test } from '@playwright/test';
import { GALLERY } from './fixtures/storefront.mjs';

const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });

const URL = '/organizations/theme-gallery';
// The fixture API serves no image bytes: photos get a real PNG unless a test breaks them.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/uploads/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
});
const TOTAL = GALLERY.sections.reduce((sum, section) => sum + section.items.length, 0);

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test.describe(`gallery on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('masonry: sections, lightbox by keyboard, focus return, axe', async ({ page }) => {
      await page.goto(URL);
      const main = page.locator('main#storefront-main');
      const masonry = main.locator('[data-section="Gallery"]').first();
      await expect(masonry).toBeVisible();
      // A deleted gallery renders nothing at all.
      await expect(main.getByRole('heading', { name: 'Gone' })).toHaveCount(0);

      // Section titles are h3 under the placement's h2; four sections get a link bar.
      await expect(masonry.getByRole('heading', { level: 3 })).toHaveText(GALLERY.sections.map((s) => s.title));
      await expect(masonry.getByRole('navigation', { name: 'Gallery sections' }).getByRole('link')).toHaveCount(4);
      await expect(masonry.getByText('Saturday noon')).toBeVisible();

      // Every photo reserves its box before it loads (no layout shift).
      const sizes = await masonry.locator('img').evaluateAll((imgs) => imgs.map((img) => [img.getAttribute('width'), img.getAttribute('height')]));
      expect(sizes.every(([w, h]) => Number(w) > 0 && Number(h) > 0)).toBe(true);
      const photos = masonry.getByRole('button', { name: /^Open photo/ });
      await expect(photos).toHaveCount(TOTAL);
      await expect(photos.first()).toHaveAccessibleName(`Open photo 1 of ${TOTAL}: Crowd at the arcade row`);
      // A photo with no alt text is still named by its position.
      await expect(photos.nth(3)).toHaveAccessibleName(`Open photo 4 of ${TOTAL}`);

      // Open from the keyboard, move with the arrow keys, close with Escape.
      await photos.nth(1).focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Photos from the show' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'Pinball tournament');
      await expect(dialog.getByText(`2 of ${TOTAL} · Main floor`)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(dialog.getByText(`3 of ${TOTAL} · Cosplay`)).toBeVisible();
      // A photo nobody has described yet is named by its position.
      await page.keyboard.press('ArrowRight');
      await expect(dialog.getByRole('img')).toHaveAttribute('alt', `Photo 4 of ${TOTAL}`);
      await page.keyboard.press('End');
      await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'Closing party');
      await expect(dialog.getByRole('button', { name: 'Next photo' })).toHaveAttribute('aria-disabled', 'true');
      await dialog.getByRole('button', { name: 'Previous photo' }).click();
      await expect(dialog.getByText(`${TOTAL - 1} of ${TOTAL} · After dark`)).toBeVisible();
      const results = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(photos.nth(1)).toBeFocused();

      // Phone first: nothing wider than the screen.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const pageResults = await new AxeBuilder({ page })
        .include('main#storefront-main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(pageResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });

    test('carousel: pause first, buttons at every width, opens the lightbox', async ({ page }) => {
      await page.goto(URL);
      const carousel = page.getByRole('region', { name: 'Highlights' });
      await expect(carousel).toBeVisible();
      const slides = carousel.locator('[aria-roledescription="slide"]');
      await expect(slides).toHaveCount(TOTAL);
      await expect(slides.first()).toHaveAttribute('aria-label', `1 of ${TOTAL}`);

      // The rotation control is the carousel's first control.
      const controls = carousel.getByRole('button');
      await expect(controls.first()).toHaveAccessibleName('Pause photos');
      await expect(carousel.getByRole('button', { name: 'Previous photo' })).toBeVisible();
      // Moving it stops the rotation for good. Retry the click: under load it can land
      // on the server-rendered button before the carousel has hydrated.
      await expect(async () => {
        await carousel.getByRole('button', { name: 'Next photo' }).click();
        await expect(carousel.getByRole('button', { name: 'Pause photos' })).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      await expect(carousel.getByRole('button', { name: 'Previous photo' })).toHaveAttribute('aria-disabled', 'false');

      await carousel.getByRole('button', { name: `Open photo 1 of ${TOTAL}: Crowd at the arcade row` }).click();
      await expect(page.getByRole('dialog', { name: 'Highlights' })).toBeVisible();
    });

    test('carousel never rotates under reduced motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(URL);
      const carousel = page.getByRole('region', { name: 'Highlights' });
      await expect(carousel.getByRole('button', { name: 'Pause photos' })).toHaveAttribute('aria-pressed', 'true');
      // Nothing moves on its own here, so the start is stable: Previous is disabled.
      await expect(carousel.getByRole('button', { name: 'Previous photo' })).toHaveAttribute('aria-disabled', 'true');
    });
  });
}

// Rich-text embeds (spec 046D): galleries render where the editor put them.
for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`content page embeds on ${viewport.name}: in place, unknown ones skipped, axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/organizations/theme-gallery/pages/photos');
    const article = page.locator('main');
    await expect(article.getByText('Our favourite shots.')).toBeVisible();
    // Text, carousel, text, masonry, text — the deleted gallery leaves no trace.
    const order = await article
      .locator('p, [aria-roledescription="carousel"], [data-gallery] ul[role="list"]')
      .evaluateAll((els) =>
        els
          .map((el) => (el.matches('[aria-roledescription="carousel"]') ? 'carousel' : el.matches('ul') ? 'masonry' : el.textContent?.trim()))
          .filter((v, i, all) => v !== all[i - 1] && (v === 'carousel' || v === 'masonry' || /shots|room|next year/.test(v ?? '')))
      );
    expect(order).toEqual(['Our favourite shots.', 'carousel', 'Every photo, by room:', 'masonry', 'See you next year.']);
    await expect(article.locator('[data-gallery]')).toHaveCount(2);

    await article.getByRole('button', { name: `Open photo 3 of ${TOTAL}: Costume contest winners` }).last().click();
    await expect(page.getByRole('dialog', { name: GALLERY.title })).toBeVisible();
    await page.keyboard.press('Escape');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('a photo that fails to load keeps its box and shows its alt text (spec 046)', async ({ page }) => {
  await page.route('**/uploads/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(URL);
  const masonry = page.locator('[data-section="Gallery"]').first();
  const tile = masonry.getByRole('button', { name: `Open photo 1 of ${TOTAL}: Crowd at the arcade row` });
  await expect(tile).toContainText('Crowd at the arcade row');
  // A photo with no alt text says so instead of showing nothing.
  await expect(masonry.getByRole('button', { name: `Open photo 4 of ${TOTAL}` })).toContainText('Photo unavailable');
  const box = await tile.boundingBox();
  expect(box!.height).toBeGreaterThan(40);
});

test('the first embedded gallery on a page loads its first photo first', async ({ page }) => {
  await page.goto('/organizations/theme-gallery/pages/photos');
  // The page opens with text, so no embed is first: nothing is high priority.
  await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(0);
});
