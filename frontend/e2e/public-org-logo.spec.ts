import { expect, test } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

function svgLogo(width: number, height: number, fill: string) {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`
    )
  );
}

// The square logo box only renders below the xl breakpoint when the org has a cover image.
const COVER = svgLogo(1600, 900, 'gray');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

function orgResponse(id: string, logoUrl: string, coverUrl: string | null = COVER) {
  return {
    organization: { id, name: 'Logo Test Org', logoUrl, coverUrl, brandColor: null, themeMode: 'LIGHT' },
    events: [],
  };
}

async function mockOrg(
  page: import('@playwright/test').Page,
  id: string,
  logoUrl: string,
  coverUrl: string | null = COVER
) {
  await page.route(`${API}/organizations/${id}/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(orgResponse(id, logoUrl, coverUrl)),
    })
  );
}

test.describe('public organization logo box', () => {
  test.use({ viewport: MOBILE });

  test('box straddles the bottom edge of the mobile cover image', async ({ page }) => {
    await mockOrg(page, 'org-straddle', svgLogo(200, 200, 'navy'));
    await page.goto('/organizations/org-straddle');

    const box = page.getByTestId('logo-box');
    await expect(box).toHaveAttribute('data-logo-fit', 'square');
    const cover = page.getByRole('img', { name: 'Logo Test Org cover' });

    const boxDims = (await box.boundingBox())!;
    const coverDims = (await cover.boundingBox())!;
    const coverBottom = coverDims.y + coverDims.height;
    const boxCenter = boxDims.y + boxDims.height / 2;
    expect(Math.abs(boxCenter - coverBottom)).toBeLessThanOrEqual(1);
  });

  test('desktop uses a plain logo image with no box or backdrop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockOrg(page, 'org-desktop', svgLogo(400, 100, 'teal'));
    await page.goto('/organizations/org-desktop');

    const logo = page.getByRole('img', { name: 'Logo Test Org logo' });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveCount(1);
    // The mobile cover block (and its logo box) is display:none at xl+.
    await expect(page.getByTestId('logo-box')).toBeHidden();
  });

  test('no cover falls back to a plain logo image on mobile', async ({ page }) => {
    await mockOrg(page, 'org-nocover', svgLogo(400, 100, 'teal'), null);
    await page.goto('/organizations/org-nocover');

    await expect(page.getByRole('img', { name: 'Logo Test Org logo' })).toBeVisible();
    await expect(page.getByTestId('logo-box')).toHaveCount(0);
  });

  test('square logo fills the box with no blurred backdrop', async ({ page }) => {
    await mockOrg(page, 'org-square', svgLogo(200, 200, 'navy'));
    await page.goto('/organizations/org-square');

    const box = page.getByTestId('logo-box');
    await expect(box).toHaveAttribute('data-logo-fit', 'square');
    await expect(page.getByTestId('logo-box-backdrop')).toHaveCount(0);

    const dims = await box.boundingBox();
    expect(dims).not.toBeNull();
    expect(Math.round(dims!.width)).toBe(Math.round(dims!.height));

    const logo = box.getByRole('img', { name: 'Logo Test Org logo' });
    const logoDims = await logo.boundingBox();
    expect(Math.round(logoDims!.width)).toBe(Math.round(dims!.width));
    expect(Math.round(logoDims!.height)).toBe(Math.round(dims!.height));
  });

  test('landscape logo spans full width and gets a blurred backdrop', async ({ page }) => {
    await mockOrg(page, 'org-landscape', svgLogo(400, 100, 'teal'));
    await page.goto('/organizations/org-landscape');

    const box = page.getByTestId('logo-box');
    await expect(box).toHaveAttribute('data-logo-fit', 'backdrop');

    const backdrop = page.getByTestId('logo-box-backdrop');
    await expect(backdrop).toHaveCount(1);
    await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await expect(backdrop).toHaveCSS('filter', /blur\(/);
    await expect(backdrop).toHaveCSS('object-fit', 'cover');

    const logo = box.getByRole('img', { name: 'Logo Test Org logo' });
    await expect(logo).toHaveCSS('object-fit', 'contain');

    // Rendered (painted) size follows object-fit: contain — measure via naturalWidth ratio.
    const painted = await logo.evaluate((img: HTMLImageElement) => {
      const ratio = img.naturalWidth / img.naturalHeight;
      const boxW = img.clientWidth;
      const boxH = img.clientHeight;
      const w = ratio >= 1 ? boxW : boxH * ratio;
      const h = ratio >= 1 ? boxW / ratio : boxH;
      return { boxW, boxH, w, h };
    });
    expect(Math.round(painted.w)).toBe(Math.round(painted.boxW));
    expect(painted.h).toBeLessThan(painted.boxH);
  });

  test('portrait logo spans full height and gets a blurred backdrop', async ({ page }) => {
    await mockOrg(page, 'org-portrait', svgLogo(100, 400, 'crimson'));
    await page.goto('/organizations/org-portrait');

    const box = page.getByTestId('logo-box');
    await expect(box).toHaveAttribute('data-logo-fit', 'backdrop');
    await expect(page.getByTestId('logo-box-backdrop')).toHaveCount(1);

    const logo = box.getByRole('img', { name: 'Logo Test Org logo' });
    const painted = await logo.evaluate((img: HTMLImageElement) => {
      const ratio = img.naturalWidth / img.naturalHeight;
      const boxW = img.clientWidth;
      const boxH = img.clientHeight;
      const w = ratio >= 1 ? boxW : boxH * ratio;
      const h = ratio >= 1 ? boxW / ratio : boxH;
      return { boxW, boxH, w, h };
    });
    expect(Math.round(painted.h)).toBe(Math.round(painted.boxH));
    expect(painted.w).toBeLessThan(painted.boxW);
  });

  test('only one accessible logo image is exposed', async ({ page }) => {
    await mockOrg(page, 'org-a11y', svgLogo(400, 100, 'teal'));
    await page.goto('/organizations/org-a11y');

    await expect(page.getByTestId('logo-box')).toHaveAttribute('data-logo-fit', 'backdrop');
    await expect(page.getByRole('img', { name: 'Logo Test Org logo' })).toHaveCount(1);
  });
});
