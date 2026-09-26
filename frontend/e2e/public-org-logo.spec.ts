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

const COVER = svgLogo(1600, 900, 'gray');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

function orgResponse(id: string, logoUrl: string | null, coverUrl: string | null = COVER) {
  return {
    organization: { id, name: 'Logo Test Org', logoUrl, coverUrl, brandColor: null, themeMode: 'LIGHT' },
    events: [],
  };
}

async function mockOrg(
  page: import('@playwright/test').Page,
  id: string,
  logoUrl: string | null,
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

test.describe('public organization logo header', () => {
  test.use({ viewport: MOBILE });

  test('full-width header contains the logo and precedes the mobile cover', async ({ page }) => {
    await mockOrg(page, 'org-header', svgLogo(200, 200, 'navy'));
    await page.goto('/organizations/org-header');

    const header = page.getByTestId('organization-header');
    const box = page.getByTestId('logo-box');
    const cover = page.getByRole('img', { name: 'Logo Test Org cover' });

    const headerDims = (await header.boundingBox())!;
    const boxDims = (await box.boundingBox())!;
    const coverDims = (await cover.boundingBox())!;
    expect(Math.round(headerDims.x)).toBe(0);
    expect(Math.round(headerDims.width)).toBe(MOBILE.width);
    expect(Math.round(boxDims.width)).toBe(56);
    expect(coverDims.y).toBeGreaterThanOrEqual(headerDims.y + headerDims.height - 1);
    await expect(header.getByRole('heading', { name: 'Logo Test Org', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  });

  test('desktop keeps the logo in the full-width header at its larger size', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockOrg(page, 'org-desktop', svgLogo(400, 100, 'teal'));
    await page.goto('/organizations/org-desktop');

    const header = page.getByTestId('organization-header');
    const box = header.getByTestId('logo-box');
    const headerDims = (await header.boundingBox())!;
    const boxDims = (await box.boundingBox())!;
    expect(Math.round(headerDims.x)).toBe(0);
    expect(Math.round(headerDims.width)).toBe(DESKTOP.width);
    expect(Math.round(boxDims.width)).toBe(64);
    await expect(header.getByRole('img', { name: 'Logo Test Org logo' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  });

  test('no cover keeps the logo in the header on mobile', async ({ page }) => {
    await mockOrg(page, 'org-nocover', svgLogo(400, 100, 'teal'), null);
    await page.goto('/organizations/org-nocover');

    const header = page.getByTestId('organization-header');
    await expect(header.getByRole('img', { name: 'Logo Test Org logo' })).toBeVisible();
    await expect(header.getByTestId('logo-box')).toBeVisible();
  });

  test('header retains its page heading when no logo is configured', async ({ page }) => {
    await mockOrg(page, 'org-no-logo', null);
    await page.goto('/organizations/org-no-logo');

    const header = page.getByTestId('organization-header');
    await expect(header.getByRole('heading', { name: 'Logo Test Org', level: 1 })).toBeVisible();
    await expect(header.getByTestId('logo-box')).toHaveCount(0);
  });

  test('square logo fills the box', async ({ page }) => {
    await mockOrg(page, 'org-square', svgLogo(200, 200, 'navy'));
    await page.goto('/organizations/org-square');

    const box = page.getByTestId('logo-box');
    const dims = await box.boundingBox();
    expect(dims).not.toBeNull();
    expect(Math.round(dims!.width)).toBe(Math.round(dims!.height));

    const logo = box.getByRole('img', { name: 'Logo Test Org logo' });
    const logoDims = await logo.boundingBox();
    expect(Math.round(logoDims!.width)).toBe(Math.round(dims!.width));
    expect(Math.round(logoDims!.height)).toBe(Math.round(dims!.height));
  });

  test('landscape logo spans full width with no blurred backdrop', async ({ page }) => {
    await mockOrg(page, 'org-landscape', svgLogo(400, 100, 'teal'));
    await page.goto('/organizations/org-landscape');

    const box = page.getByTestId('logo-box');
    await expect(box.getByRole('img')).toHaveCount(1);
    expect(await box.evaluate((el) => el.querySelectorAll('img').length)).toBe(1);

    const logo = box.getByRole('img', { name: 'Logo Test Org logo' });
    await expect(logo).toHaveCSS('object-fit', 'contain');
    await expect(logo).toHaveCSS('filter', 'none');

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

  test('portrait logo spans full height with no blurred backdrop', async ({ page }) => {
    await mockOrg(page, 'org-portrait', svgLogo(100, 400, 'crimson'));
    await page.goto('/organizations/org-portrait');

    const box = page.getByTestId('logo-box');
    expect(await box.evaluate((el) => el.querySelectorAll('img').length)).toBe(1);

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

    await expect(page.getByRole('img', { name: 'Logo Test Org logo' })).toHaveCount(1);
  });
});
