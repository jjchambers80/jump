import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Admin sidebar sections (Finance, Online store, Content) start collapsed and
// open through their chevron toggle; the section holding the current page opens
// on its own so the active link is never hidden.

const API = 'http://localhost:3002';

test.beforeEach(async ({ page, baseURL }) => {
  await page.route(`${API}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await signInAsStaff(page, { id: 'nav-admin', email: 'nav-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('sections are collapsed by default and expand via the chevron', async ({ page }) => {
  await page.goto('/admin/venues');
  const sidebar = page.locator('aside');

  for (const label of ['Finance', 'Online store', 'Content']) {
    await expect(sidebar.getByRole('button', { name: `Expand ${label}` })).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(sidebar.getByRole('link', { name: 'Payouts' })).toBeHidden();
  await expect(sidebar.getByRole('link', { name: 'Pages' })).toBeHidden();
  await expect(sidebar.getByRole('link', { name: 'Files' })).toBeHidden();

  await sidebar.getByRole('button', { name: 'Expand Content' }).click();
  await expect(sidebar.getByRole('button', { name: 'Collapse Content' })).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('link', { name: 'Files' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Menus' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Blog posts' })).toBeVisible();
  // Other sections stay closed.
  await expect(sidebar.getByRole('link', { name: 'Payouts' })).toBeHidden();

  await sidebar.getByRole('button', { name: 'Collapse Content' }).click();
  await expect(sidebar.getByRole('link', { name: 'Files' })).toBeHidden();
});

test('the section holding the current page is open on load and after navigation', async ({ page }) => {
  await page.goto('/admin/content/menus');
  const sidebar = page.locator('aside');

  await expect(sidebar.getByRole('button', { name: 'Collapse Content' })).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('link', { name: 'Menus' })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('link', { name: 'Payouts' })).toBeHidden();

  // The parent link still navigates; the chevron only toggles.
  await sidebar.getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/finance$/);
  await expect(sidebar.getByRole('link', { name: 'Payouts' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Finance', exact: true })).toHaveAttribute('aria-current', 'page');
});
