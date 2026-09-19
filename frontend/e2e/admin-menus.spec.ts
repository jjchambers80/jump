// Content › Menus (spec 027): list, tree editor with picker, button moves,
// save bar → whole-tree PUT, broken link badge — backend mocked.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-menus';

type Item = {
  id: string;
  label: string;
  linkType: string;
  targetId: string | null;
  url: string | null;
  newTab: boolean;
  target: { title: string | null; status: 'ok' | 'missing' | 'hidden'; href: string | null };
  children: Item[];
};

const home: Item = {
  id: 'i-home',
  label: 'Home',
  linkType: 'HOME',
  targetId: null,
  url: null,
  newTab: false,
  target: { title: null, status: 'ok', href: `/organizations/${ORG_ID}` },
  children: [],
};
const events: Item = {
  id: 'i-events',
  label: 'Events',
  linkType: 'EVENTS',
  targetId: null,
  url: null,
  newTab: false,
  target: { title: null, status: 'ok', href: `/organizations/${ORG_ID}#events` },
  children: [],
};
const broken: Item = {
  id: 'i-broken',
  label: 'Old page',
  linkType: 'PAGE',
  targetId: 'pg-gone',
  url: null,
  newTab: false,
  target: { title: null, status: 'missing', href: null },
  children: [],
};

const mainMenu = {
  id: 'menu-main',
  title: 'Main menu',
  handle: 'main-menu',
  isDefault: true,
  items: [home, events, broken],
  updatedAt: '2026-09-19T12:00:00.000Z',
};
const footerMenu = {
  id: 'menu-footer',
  title: 'Footer menu',
  handle: 'footer-menu',
  isDefault: true,
  items: [home],
  updatedAt: '2026-09-19T12:00:00.000Z',
};

async function mockMenusApi(page: Page) {
  const calls: { method: string; url: string; body?: any }[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Menus Org',
          slug: 'menus-org',
          status: 'ACTIVE',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ]),
    })
  );
  // Catch-all first: Playwright runs later-registered routes first.
  await page.route(`${API}/admin/menus**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        menus: [mainMenu, footerMenu].map((m) => ({
          id: m.id,
          title: m.title,
          handle: m.handle,
          isDefault: m.isDefault,
          itemLabels: m.items.map((i) => i.label),
          updatedAt: m.updatedAt,
        })),
      }),
    })
  );
  await page.route(`${API}/admin/menus/*`, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const menu = [mainMenu, footerMenu].find((m) => m.id === id);
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'PUT' ? request.postDataJSON() : undefined,
    });
    if (!menu)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Menu not found' }),
      });
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { title?: string; items: any[] };
      let n = 0;
      const decorate = (items: any[]): Item[] =>
        items.map((item) => ({
          id: `saved-${(n += 1)}`,
          label: item.label,
          linkType: item.linkType,
          targetId: item.targetId ?? null,
          url: item.url ?? null,
          newTab: !!item.newTab,
          target: {
            title: item.targetId ? 'Vendors' : null,
            status: 'ok',
            href: item.url ?? `/organizations/${ORG_ID}`,
          },
          children: decorate(item.children ?? []),
        }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...menu,
          title: body.title ?? menu.title,
          items: decorate(body.items),
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(menu),
    });
  });
  await page.route(`${API}/admin/menus/link-targets**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [{ id: 'ev-1', title: 'Expo 2026', hint: 'Oct 4' }],
        venues: [],
        pages: [{ id: 'pg-vendors', title: 'Vendors' }],
        blogs: [{ id: 'b-news', title: 'News' }],
        blogPosts: [],
      }),
    })
  );
  return { calls };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'menus-admin', email: 'menus-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
});

test('lists menus with their top-level items', async ({ page }) => {
  await mockMenusApi(page);
  await page.goto('/admin/content/menus');
  await expect(page.getByRole('heading', { name: 'Menus' })).toBeVisible();
  const rows = page.getByTestId('menu-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Footer menu'); // sorted by name
  await expect(rows.nth(1)).toContainText('Home, Events, Old page');
  await expect(page.getByRole('button', { name: 'Create menu' })).toBeVisible();
});

test('edits the tree: add with the picker, nest, move, save the whole tree', async ({ page }) => {
  const { calls } = await mockMenusApi(page);
  await page.goto('/admin/content/menus/menu-main');
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByText('Handle: main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-item-row')).toHaveCount(3);
  await expect(page.getByTestId('broken-link')).toBeVisible();
  await expect(page.getByTestId('save-bar')).toHaveCount(0);

  // Add a page link at the root through the picker.
  await page.getByRole('button', { name: 'Add menu item', exact: true }).click();
  await page.getByLabel('Label').fill('Vendors');
  await page.getByRole('combobox').fill('vend');
  await page.getByRole('option', { name: /Vendors/ }).click();
  await page.getByRole('button', { name: 'Confirm item' }).click();
  await expect(page.getByTestId('menu-item-row')).toHaveCount(4);
  await expect(page.getByTestId('save-bar')).toBeVisible();

  // Add a child under Vendors: external link, new tab.
  await page.getByRole('button', { name: 'Add menu item to Vendors' }).click();
  await page.getByLabel('Label').fill('Packet');
  await page.getByRole('combobox').fill('https://x.test/packet.pdf');
  await page
    .getByRole('option', { name: /x\.test\/packet\.pdf/ })
    .first()
    .click();
  await page.getByLabel('Open in new tab').check();
  await page.getByRole('button', { name: 'Confirm item' }).click();
  await expect(page.locator('[data-testid="menu-item-row"][data-depth="1"]')).toHaveCount(1);

  // Move Vendors up above the broken item with the button path.
  await page.getByRole('button', { name: 'Move Vendors up' }).click();
  const labels = await page
    .locator('[data-testid="menu-item-row"][data-depth="0"] p.font-medium')
    .allTextContents();
  expect(labels).toEqual(['Home', 'Events', 'Vendors', 'Old page']);

  // Remove the broken link and save.
  await page.getByRole('button', { name: 'Remove Old page' }).click();
  await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast')).toContainText('Menu saved');
  await expect(page.getByTestId('save-bar')).toHaveCount(0);

  const put = calls.find((call) => call.method === 'PUT');
  expect(put?.body).toEqual({
    title: 'Main menu',
    items: [
      { label: 'Home', linkType: 'HOME', targetId: null, url: null, newTab: false, children: [] },
      {
        label: 'Events',
        linkType: 'EVENTS',
        targetId: null,
        url: null,
        newTab: false,
        children: [],
      },
      {
        label: 'Vendors',
        linkType: 'PAGE',
        targetId: 'pg-vendors',
        url: null,
        newTab: false,
        children: [
          {
            label: 'Packet',
            linkType: 'EXTERNAL',
            targetId: null,
            url: 'https://x.test/packet.pdf',
            newTab: true,
            children: [],
          },
        ],
      },
    ],
  });
});

test('renaming the menu dirties the form and Discard restores it', async ({ page }) => {
  await mockMenusApi(page);
  await page.goto('/admin/content/menus/menu-main');
  await page.getByLabel('Name').fill('Primary');
  await expect(page.getByTestId('save-bar')).toBeVisible();
  await page.getByTestId('save-bar').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Main menu');
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0); // default menus cannot be deleted
});
