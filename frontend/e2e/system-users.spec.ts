// System administration › Users: URL-synced list, invite behind step-up,
// promote warning with memberships, own-row lock, last-admin 409 inside the
// dialog, deactivate. Backend mocked (CI has none).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAUTH_401 = json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401);

const sysAdmin = { id: 'sys-1', email: 'sys@test.com', role: 'SYSTEM_ADMIN' as const, name: 'Sys Admin' };

const user = (over: { id: string; email: string } & Record<string, unknown>) => ({
  name: null,
  firstName: null,
  lastName: null,
  role: 'ADMIN',
  isActive: true,
  organizationId: null,
  organizationName: null,
  organizations: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  ...over,
});

const ME = user({ id: 'sys-1', email: 'sys@test.com', name: 'Sys Admin', role: 'SYSTEM_ADMIN' });
const OTHER_ADMIN = user({ id: 'sys-2', email: 'grace@test.com', name: 'Grace Hopper', role: 'SYSTEM_ADMIN' });
const ADA = user({
  id: 'u-ada',
  email: 'ada@test.com',
  name: 'Ada Admin',
  organizations: [
    { id: 'org-1', name: 'Raleigh Retro Gamers', role: 'ADMIN' },
    { id: 'org-2', name: 'Durham Comics', role: 'ORGANIZER' },
  ],
});

interface Options {
  users?: ReturnType<typeof user>[];
  /** Active system admins returned for the last-admin check. */
  admins?: ReturnType<typeof user>[];
  requireReauth?: boolean;
  patch?: (route: Route) => unknown;
}

async function mockApi(page: Page, opts: Options = {}) {
  const users = opts.users ?? [ME, OTHER_ADMIN, ADA];
  const admins = opts.admins ?? [ME, OTHER_ADMIN];
  const listQueries: string[] = [];
  const mutations: { method: string; path: string; body: any; reauth: string | null }[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: 'org-1', name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE' }]))
  );
  await page.route(`${API}/admin/system/users**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') {
      const qs = url.searchParams;
      const lastAdminCheck = qs.get('role') === 'SYSTEM_ADMIN' && qs.get('status') === 'ACTIVE' && !qs.get('q');
      if (lastAdminCheck) return route.fulfill(json({ users: admins, pagination: { page: 1, limit: 20, total: admins.length, totalPages: 1 } }));
      listQueries.push(url.search);
      const q = qs.get('q')?.toLowerCase();
      const rows = users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
      return route.fulfill(json({ users: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } }));
    }
    const reauth = req.headers()['x-jump-reauth'] ?? null;
    mutations.push({ method: req.method(), path: url.pathname, body: req.postDataJSON(), reauth });
    if (opts.requireReauth && reauth !== 'proof-1') return route.fulfill(REAUTH_401);
    if (url.pathname.endsWith('/invite')) {
      return route.fulfill(json({ user: user({ id: 'new', email: 'new@test.com', role: 'SYSTEM_ADMIN' }), promoted: false, emailSent: true }, 201));
    }
    if (opts.patch) return opts.patch(route);
    return route.fulfill(json(user({ id: url.pathname.split('/').pop() ?? '', email: 'x@test.com' })));
  });
  await page.route(`${API}/account/reauth/start`, (route) => route.fulfill(json({ methods: ['email'], sentTo: 'sys@test.com' })));
  await page.route(`${API}/account/reauth`, (route) =>
    route.fulfill(json({ reauthToken: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z' }))
  );
  return { listQueries, mutations };
}

const row = (page: Page, email: string) => page.getByTestId(`system-user-${email}`);

async function openAction(page: Page, email: string, action: string) {
  await row(page, email).getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, sysAdmin, baseURL!);
});

test('lists users and keeps search and filters in the URL', async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto('/admin/system/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await expect(row(page, 'ada@test.com')).toContainText('Raleigh Retro Gamers, Durham Comics');
  await expect(row(page, 'ada@test.com')).toContainText('Active');

  await page.getByLabel('Search users by name or email').fill('ada');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/admin\/system\/users\?q=ada$/);
  await expect(row(page, 'grace@test.com')).toHaveCount(0);
  expect(mock.listQueries.at(-1)).toContain('q=ada');

  const filters = page.getByRole('group', { name: 'Filter users' });
  await filters.getByRole('button', { name: 'Inactive' }).click();
  await expect(page).toHaveURL(/q=ada&status=INACTIVE/);
  await expect(filters.getByRole('button', { name: 'Inactive' })).toHaveAttribute('aria-pressed', 'true');
  await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => mock.listQueries.at(-1)).toContain('status=INACTIVE');
});

test('invite asks for step-up, posts the email and announces success', async ({ page }) => {
  const mock = await mockApi(page, { requireReauth: true });
  await page.goto('/admin/system/users');
  await page.getByRole('button', { name: 'Invite system admin' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite system admin' });
  await expect(dialog).toContainText('full access to every organization');
  await expect(dialog).toContainText('two-step');
  await dialog.getByLabel('Email').fill('new@test.com');
  await dialog.getByRole('button', { name: 'Send invite' }).click();

  const reauth = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(reauth).toBeVisible();
  await reauth.getByRole('button', { name: 'Send code' }).click();
  await reauth.getByLabel('Verification code').fill('123456');
  await reauth.getByRole('button', { name: 'Verify' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'new@test.com was invited' })).toContainText('We emailed them');
  expect(mock.mutations.map((m) => [m.path, m.body, m.reauth])).toEqual([
    ['/admin/system/users/invite', { email: 'new@test.com' }, null],
    ['/admin/system/users/invite', { email: 'new@test.com' }, 'proof-1'],
  ]);
});

test('make system admin lists the memberships that will be removed', async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto('/admin/system/users');
  await openAction(page, 'ada@test.com', 'Make system admin');
  const dialog = page.getByRole('dialog', { name: 'Make system admin' });
  const list = dialog.getByRole('list', { name: 'Memberships that will be removed' });
  await expect(list.getByRole('listitem')).toHaveText(['Raleigh Retro Gamers (admin)', 'Durham Comics (organizer)']);
  await dialog.getByRole('button', { name: 'Make system admin' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Ada Admin is now a system admin.' })).toBeVisible();
  expect(mock.mutations[0]).toMatchObject({ method: 'PATCH', path: '/admin/system/users/u-ada', body: { role: 'SYSTEM_ADMIN' } });
});

test('your own row is locked with a visible reason', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/system/users');
  const mine = row(page, 'sys@test.com');
  await expect(mine).toContainText("You can't change your own access.");
  await mine.getByRole('button', { name: /^Actions for/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Remove system admin' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeDisabled();
});

test('the last active system admin is locked, and a server 409 shows in the dialog', async ({ page }) => {
  await mockApi(page, {
    admins: [OTHER_ADMIN],
    patch: (route) =>
      route.fulfill(json({ error: 'ConflictError', message: 'There must always be at least one active system admin', code: 'LAST_SYSTEM_ADMIN' }, 409)),
  });
  await page.goto('/admin/system/users');
  await expect(row(page, 'grace@test.com')).toContainText('Last active system admin');
  await row(page, 'grace@test.com').getByRole('button', { name: /^Actions for/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Remove system admin' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  // A stale list (someone else just left) still gets the server's answer.
  await openAction(page, 'ada@test.com', 'Deactivate');
  const dialog = page.getByRole('dialog', { name: 'Deactivate user' });
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('There must always be at least one active system admin');
  await expect(dialog).toBeVisible();
});

test('deactivate explains that sessions end and refreshes the list', async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto('/admin/system/users');
  await openAction(page, 'ada@test.com', 'Deactivate');
  const dialog = page.getByRole('dialog', { name: 'Deactivate user' });
  await expect(dialog).toContainText('every session they have open ends immediately');
  const before = mock.listQueries.length;
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Ada Admin was deactivated.' })).toBeVisible();
  expect(mock.mutations[0]).toMatchObject({ method: 'PATCH', body: { isActive: false } });
  await expect.poll(() => mock.listQueries.length).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Actions for Ada Admin' })).toBeFocused();
});

test('fits 375px without horizontal scroll and has no axe violations', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/system/users');
  await expect(row(page, 'ada@test.com')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return main.scrollWidth - main.clientWidth + (document.documentElement.scrollWidth - window.innerWidth);
  });
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations).toEqual([]);
});
