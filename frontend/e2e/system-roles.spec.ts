// System administration › Roles & permissions: matrix of features and actions
// per member role, locked cells, platform feature switches, save behind
// step-up. Backend mocked (CI has none).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAUTH_401 = json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401);

const sysAdmin = { id: 'sys-1', email: 'sys@test.com', role: 'SYSTEM_ADMIN' as const, name: 'Sys Admin' };

const DEFAULTS = {
  ADMIN: { events: true, maps: true, 'orders.refund': true, 'settings.users': true },
  ORGANIZER: { events: true, maps: true, 'orders.refund': false, 'settings.users': false },
};
const MATRIX = {
  features: [
    { key: 'events', label: 'Events', locked: true, switchable: false, actions: [] },
    {
      key: 'orders',
      label: 'Orders and check-in',
      locked: true,
      switchable: false,
      actions: [{ key: 'orders.refund', label: 'Refund orders, tickets and add-ons', locked: null }],
    },
    { key: 'maps', label: 'Maps', locked: false, switchable: true, actions: [] },
    {
      key: 'settings',
      label: 'Settings',
      locked: true,
      switchable: false,
      actions: [{ key: 'settings.users', label: 'Add, remove and change staff users', locked: { ADMIN: true, ORGANIZER: true } }],
    },
  ],
  roles: DEFAULTS,
  defaults: DEFAULTS,
  disabled: [] as string[],
};

async function mockApi(page: Page) {
  const saves: { body: any; reauth: string | null }[] = [];
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([])));
  await page.route(`${API}/admin/system/roles`, (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill(json(MATRIX));
    const reauth = req.headers()['x-jump-reauth'] ?? null;
    const body = req.postDataJSON();
    saves.push({ body, reauth });
    if (reauth !== 'proof-1') return route.fulfill(REAUTH_401);
    return route.fulfill(json({ ...MATRIX, roles: body.roles, disabled: body.disabled }));
  });
  await page.route(`${API}/account/reauth/start`, (route) => route.fulfill(json({ methods: ['email'], sentTo: 'sys@test.com' })));
  await page.route(`${API}/account/reauth`, (route) =>
    route.fulfill(json({ reauthToken: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z' }))
  );
  return saves;
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, sysAdmin, baseURL!);
});

test('shows the matrix with locked cells and saves changes behind step-up', async ({ page }) => {
  const saves = await mockApi(page);
  await page.goto('/admin/system/roles');
  await expect(page.getByRole('heading', { level: 1, name: 'Roles & permissions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page');

  await expect(page.getByLabel('Organizers: Add, remove and change staff users (fixed)')).toBeDisabled();
  await expect(page.getByRole('img', { name: 'Events: always visible to Organizers' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  await page.getByLabel('Organizers: Refund orders, tickets and add-ons').check();
  await page.getByLabel('Organizers can see Maps').uncheck();
  await expect(page.getByText('2 unsaved changes')).toBeVisible();

  await save.click();
  const reauth = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await reauth.getByRole('button', { name: 'Send code' }).click();
  await reauth.getByLabel('Verification code').fill('123456');
  await reauth.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByText('No unsaved changes')).toBeVisible();
  expect(saves.at(-1)?.reauth).toBe('proof-1');
  expect(saves.at(-1)?.body.roles.ORGANIZER).toMatchObject({ 'orders.refund': true, maps: false });
});

test('turning a feature off platform-wide asks first and greys out its column', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/system/roles');
  const mapsSwitch = page.getByRole('switch', { name: /Maps/ });
  await expect(mapsSwitch).toHaveAttribute('aria-checked', 'true');

  page.once('dialog', (d) => d.dismiss());
  await mapsSwitch.click();
  await expect(mapsSwitch).toHaveAttribute('aria-checked', 'true');

  page.once('dialog', (d) => d.accept());
  await mapsSwitch.click();
  await expect(mapsSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Off for everyone')).toBeVisible();
  await expect(page.getByLabel('Admins can see Maps')).toBeDisabled();

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(mapsSwitch).toHaveAttribute('aria-checked', 'true');
});

test('has no axe violations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/system/roles');
  await expect(page.getByRole('heading', { name: 'Permissions', exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations).toEqual([]);
});
