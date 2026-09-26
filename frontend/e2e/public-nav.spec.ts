// Storefront navigation (spec 027): header dropdown, mobile drawer, footer — backend mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG = {
  id: 'org-nav',
  name: 'Nav Org',
  logoUrl: null,
  coverUrl: null,
  brandColor: '#b91c1c',
  themeMode: 'SYSTEM',
};
const menus = {
  main: [
    { id: 'm1', label: 'Home', href: '/organizations/org-nav', newTab: false, children: [] },
    {
      id: 'm2',
      label: 'Vendors',
      href: '/organizations/org-nav/pages/vendors',
      newTab: false,
      children: [
        { id: 'm21', label: 'Apply', href: '/events/ev-1', newTab: false, children: [] },
        {
          id: 'm22',
          label: 'Packet',
          href: 'https://x.test/packet.pdf',
          newTab: true,
          children: [],
        },
      ],
    },
    {
      id: 'm3',
      label: 'Blog',
      href: '/organizations/org-nav/blogs/news',
      newTab: false,
      children: [],
    },
  ],
  footer: [
    { id: 'f1', label: 'Home', href: '/organizations/org-nav', newTab: false, children: [] },
    {
      id: 'f2',
      label: 'About',
      href: '/organizations/org-nav/pages/about',
      newTab: false,
      children: [
        {
          id: 'f21',
          label: 'Team',
          href: '/organizations/org-nav/pages/team',
          newTab: false,
          children: [],
        },
      ],
    },
  ],
};

async function mockStorefront(page: Page) {
  await page.route(`${API}/organizations/org-nav/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ organization: ORG, locked: false, events: [] }),
    })
  );
  await page.route(`${API}/organizations/org-nav/public/menus`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(menus) })
  );
  await page.route(`${API}/organizations/org-nav/public/pages/vendors`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: ORG,
        page: { id: 'p', title: 'Vendors', slug: 'vendors', content: '<p>Apply here.</p>' },
      }),
    })
  );
}

test('desktop header shows the main menu with a keyboard-friendly dropdown', async ({ page }) => {
  await mockStorefront(page);
  await page.goto('/organizations/org-nav');
  const nav = page.getByTestId('organization-header').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute(
    'href',
    '/organizations/org-nav'
  );
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Blog' })).toHaveAttribute(
    'href',
    '/organizations/org-nav/blogs/news'
  );

  const trigger = nav.getByRole('button', { name: 'Vendors' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Apply' })).toHaveAttribute('href', '/events/ev-1');
  const packet = nav.getByRole('link', { name: 'Packet' });
  await expect(packet).toHaveAttribute('target', '_blank');
  await expect(packet).toHaveAttribute('rel', 'noopener');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  const footer = page.getByTestId('storefront-footer');
  await expect(footer.getByRole('navigation', { name: 'Footer' })).toBeVisible();
  await expect(footer.getByRole('heading', { name: 'About' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Team' })).toHaveAttribute(
    'href',
    '/organizations/org-nav/pages/team'
  );
  await expect(footer).toContainText(`© ${new Date().getFullYear()} Nav Org`);
});

test('mobile header opens a drawer with an accordion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockStorefront(page);
  await page.goto('/organizations/org-nav');
  await expect(page.getByTestId('storefront-nav')).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Apply' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Expand Vendors' }).click();
  await expect(drawer.getByRole('link', { name: 'Apply' })).toBeVisible();
  await drawer.getByRole('link', { name: 'Vendors' }).click();
  await expect(page).toHaveURL(/\/organizations\/org-nav\/pages\/vendors$/);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
  await expect(page.getByTestId('storefront-page')).toContainText('Apply here.');
});

test('header renders no nav row when the main menu is empty', async ({ page }) => {
  await page.route(`${API}/organizations/org-nav/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ organization: ORG, locked: false, events: [] }),
    })
  );
  await page.route(`${API}/organizations/org-nav/public/menus`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ main: [], footer: [] }),
    })
  );
  await page.goto('/organizations/org-nav');
  await expect(page.getByTestId('organization-header')).toContainText('Nav Org');
  await expect(page.getByTestId('storefront-nav')).toHaveCount(0);
  await expect(page.getByTestId('storefront-footer')).toHaveCount(0);
});

test('header and footer sit on the page surface with no background or border', async ({ page }) => {
  await mockStorefront(page);
  await page.goto('/organizations/org-nav');
  for (const id of ['organization-header', 'storefront-footer']) {
    const style = await page.getByTestId(id).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, top: s.borderTopWidth, bottom: s.borderBottomWidth };
    });
    expect(style).toEqual({ bg: 'rgba(0, 0, 0, 0)', top: '0px', bottom: '0px' });
  }
});

test('skip link moves focus past the header', async ({ page }) => {
  await mockStorefront(page);
  await page.goto('/organizations/org-nav');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  const inHeader = await page.evaluate(
    () => !!document.activeElement?.closest('[data-testid="organization-header"]')
  );
  expect(inHeader).toBe(false);
});

test('mobile drawer traps focus and returns it to the menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockStorefront(page);
  await page.goto('/organizations/org-nav');
  const openButton = page.getByRole('button', { name: 'Open menu' });
  const box = (await openButton.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await openButton.click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer.getByRole('button', { name: 'Close menu' })).toBeFocused();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(openButton).toBeFocused();
});
