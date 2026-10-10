// User menu (OrgSwitcher): menu semantics, keyboard pattern and a long org list on a phone.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';

const orgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `org-${i + 1}`,
    name: `Organization number ${i + 1}`,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));

async function signIn(page: Page, baseURL: string, count: number) {
  await signInAsStaff(page, { id: 'user-sys', email: 'sys@example.com', role: 'SYSTEM_ADMIN', name: 'Sys Admin' }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orgs(count)) })
  );
}

test('keyboard: focus moves into the menu, arrows wrap, Home/End, Escape returns focus', async ({ page, baseURL }) => {
  await signIn(page, baseURL!, 3);
  await page.goto('/admin');
  const trigger = page.getByTestId('org-switcher-trigger');
  await trigger.click();

  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  // 3 orgs + Create organization + System administration + account + Log out
  await expect(items).toHaveCount(7);
  await expect(items.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toContainText('Log out');
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // Tab closes the menu too
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
});

test('40 organizations at 375px: panel stays on screen and the list scrolls', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signIn(page, baseURL!, 40);
  await page.goto('/admin');
  await page.getByTestId('org-switcher-trigger').click();

  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThanOrEqual(667);

  const list = menu.getByRole('group', { name: 'Organizations' });
  const scroll = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(scroll.sh).toBeGreaterThan(scroll.ch);

  // The actions below the list remain reachable without scrolling the page.
  await expect(page.getByTestId('org-switcher-account')).toBeInViewport();
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeInViewport();

  // End reaches Log out; the last org scrolls into view when focused.
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
  const lastOrg = menu.getByRole('menuitem', { name: /Organization number 40/ });
  await lastOrg.focus();
  await expect(lastOrg).toBeInViewport();

  // Touch targets are at least 44px tall below sm.
  for (const item of await menu.getByRole('menuitem').all()) {
    const h = (await item.boundingBox())?.height ?? 0;
    if (h) expect(h).toBeGreaterThanOrEqual(44);
  }
});
