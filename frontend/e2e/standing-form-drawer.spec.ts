// Spec 044D: below `lg` a page with a standing form shows one Apply button
// that opens the form in a panel (sheet on phones); from `lg` the form sits
// inline after the copy. Backend mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG = { id: 'org-apply', slug: 'apply-org', name: 'Retro Market', logoUrl: null, coverUrl: null, brandColor: '#4338ca', themeMode: 'LIGHT' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const standingForm = {
  id: 'form-vendor',
  kind: 'FREE',
  name: 'Become a vendor',
  slug: 'become-a-vendor',
  intro: 'Tell us what you sell.',
  acceptance: { open: true, reason: null },
  chargeTiming: null,
  feeMode: null,
  organizationName: 'Retro Market',
  tiers: [],
  questions: [{ id: 'q1', label: 'What do you sell?', helpText: null, type: 'SHORT_TEXT', required: true, options: [], displayOrder: 0 }],
  collectBusiness: true,
  successMessage: 'Thanks! We review vendors every Monday.',
  organization: ORG,
};

async function mockPage(page: Page, status: 'OPEN' | 'CLOSED' = 'OPEN') {
  await page.route(`${API}/organizations/org-apply/public/pages/vendors`, (route) =>
    route.fulfill(
      json({
        organization: ORG,
        page: {
          id: 'pg-vendors',
          title: 'Vendors',
          slug: 'vendors',
          content: '<p>We are always looking for new vendors.</p>',
          template: null,
          applyForm: { slug: 'become-a-vendor', name: 'Become a vendor', intro: 'Tell us what you sell.', label: 'Apply to vend', status, opensAt: null },
        },
      })
    )
  );
  await page.route(`${API}/legal/versions`, (route) => route.fulfill(json({ terms: 't1', privacy: 'p1' })));
  const posts: string[] = [];
  await page.route(`${API}/organizations/org-apply/public/apply/become-a-vendor`, (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postData() ?? '');
      return route.fulfill(json({ applicationId: 'app-1', statusUrl: 'http://localhost/organizations/org-apply/apply/status/app-1?token=t' }, 201));
    }
    return route.fulfill(json(standingForm));
  });
  return { posts };
}

const PHONE = { width: 390, height: 844 };

for (const viewport of [
  { name: 'phone', ...PHONE },
  { name: 'tablet', width: 820, height: 1180 },
]) {
  test(`${viewport.name}: Apply opens the panel, validates, submits and thanks`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const api = await mockPage(page);
    await page.goto('/organizations/org-apply/pages/vendors');

    const band = page.getByTestId('apply-cta-band');
    await expect(band).toContainText('Become a vendor');
    await band.getByRole('link', { name: 'Apply to vend' }).click();

    const drawer = page.getByRole('dialog', { name: 'Become a vendor' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Tell us what you sell.');

    // Native validation stops an empty submit: nothing is posted.
    await drawer.getByRole('button', { name: 'Submit application' }).click();
    expect(api.posts).toHaveLength(0);

    await drawer.getByLabel('First name').fill('Vera');
    await drawer.getByLabel('Last name').fill('Vendor');
    await drawer.getByLabel('Email', { exact: true }).fill('vera@example.com');
    await drawer.getByLabel('Business or outlet name').fill('Vera Retro');
    await drawer.getByLabel(/What do you sell/).fill('Cartridges');
    await drawer.getByTestId('apply-consent').check();
    await drawer.getByRole('button', { name: 'Submit application' }).click();

    await expect(drawer.getByRole('heading', { name: 'Application sent' })).toBeFocused();
    await expect(drawer).toContainText('We review vendors every Monday.');
    expect(api.posts[0]).toContain('"formSlug":"become-a-vendor"');
    expect(api.posts[0]).toContain('"businessName":"Vera Retro"');
    await expect(drawer.getByRole('link', { name: 'View your application' })).toHaveAttribute('href', '/organizations/org-apply/apply/status/app-1?token=t');

    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toBeHidden();
  });
}

test('desktop: the form is inline after the copy, with no Apply button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const api = await mockPage(page);
  await page.goto('/organizations/org-apply/pages/vendors');

  await expect(page.getByTestId('apply-cta-button')).toBeHidden();
  const inline = page.getByRole('region', { name: 'Become a vendor' });
  await expect(inline).toBeVisible();
  await inline.getByLabel('First name').fill('Vera');
  await inline.getByLabel('Last name').fill('Vendor');
  await inline.getByLabel('Email', { exact: true }).fill('vera@example.com');
  await inline.getByLabel('Business or outlet name').fill('Vera Retro');
  await inline.getByLabel(/What do you sell/).fill('Cartridges');
  await inline.getByTestId('apply-consent').check();
  await inline.getByRole('button', { name: 'Submit application' }).click();

  await expect(inline.getByRole('heading', { name: 'Application sent' })).toBeFocused();
  expect(api.posts).toHaveLength(1);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('keyboard: Escape closes the panel and returns focus to the button; #apply opens it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await mockPage(page);
  await page.goto('/organizations/org-apply/pages/vendors');
  const cta = page.getByTestId('apply-cta-button');
  await cta.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Become a vendor' });
  await expect(drawer.getByLabel('First name')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(cta).toBeFocused();

  await page.goto('/organizations/org-apply/pages/vendors#apply');
  await expect(page.getByRole('dialog', { name: 'Become a vendor' })).toBeVisible();
});

test('a closed form shows the band without a button', async ({ page }) => {
  await mockPage(page, 'CLOSED');
  await page.goto('/organizations/org-apply/pages/vendors');
  await expect(page.getByTestId('apply-cta-closed')).toContainText('Applications are closed right now');
  await expect(page.getByTestId('apply-cta-button')).toHaveCount(0);
  await expect(page.getByTestId('apply-inline')).toHaveCount(0);
});
