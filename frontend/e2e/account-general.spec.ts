// Account › General (spec 030 feature A): org-menu entry, name / phone /
// time-zone dialogs, verified email change pending state, photo removal.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';

const baseAccount = {
  id: 'user-ada',
  email: 'ada@example.com',
  emailVerified: '2026-01-01T00:00:00.000Z',
  pendingEmail: null as string | null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  name: 'Ada Lovelace',
  phone: null as string | null,
  locale: 'en-US',
  timeZone: null as string | null,
  avatar: null as null | { id: string; hash: string; urls: Record<string, string> },
  imageFallbackUrl: null,
  providers: [{ provider: 'google', connectedAt: '2026-01-01T00:00:00.000Z' }],
  supportedLocales: [{ code: 'en-US', label: 'English (United States)' }],
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function signIn(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'user-ada', email: 'ada@example.com', role: 'ADMIN', name: 'Ada Lovelace' }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'org-1', name: 'Analytical Engines', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]),
    })
  );
}

/** Stateful stub of /account: PATCH merges, email goes pending, avatar toggles. */
async function mockAccountApi(page: Page, initial: Partial<typeof baseAccount> = {}) {
  let current = { ...baseAccount, ...initial };
  const patches: Record<string, unknown>[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${API}/account`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill(json(current));
    if (method === 'PATCH') {
      const patch = route.request().postDataJSON();
      patches.push(patch);
      current = { ...current, ...patch };
      if ('firstName' in patch || 'lastName' in patch) {
        current.name = [current.firstName, current.lastName].filter(Boolean).join(' ') || '';
      }
      return route.fulfill(json(current));
    }
    return route.fallback();
  });
  await page.route(`${API}/account/email`, async (route) => {
    const { email } = route.request().postDataJSON();
    if (email === 'taken@example.com') return route.fulfill(json({ error: 'ConflictError', message: 'That email address is already in use', code: 'EMAIL_TAKEN' }, 409));
    current = { ...current, pendingEmail: email };
    return route.fulfill(json(current));
  });
  await page.route(`${API}/account/email/pending`, async (route) => {
    current = { ...current, pendingEmail: null };
    return route.fulfill(json(current));
  });
  await page.route(`${API}/account/avatar`, async (route) => {
    if (route.request().method() === 'DELETE') {
      current = { ...current, avatar: null };
      return route.fulfill(json(current));
    }
    return route.fallback();
  });
  return { patches, get: () => current };
}

test.describe('Account › General', () => {
  test('the org menu links to the account page and General renders the profile', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockAccountApi(page);
    await page.goto('/admin');
    await page.getByTestId('org-switcher-trigger').click();
    const entry = page.getByTestId('org-switcher-account');
    await expect(entry).toContainText('Ada Lovelace');
    await expect(entry).toContainText('ada@example.com');
    await entry.click();
    await expect(page).toHaveURL(/\/admin\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'General', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Edit name' })).toContainText('Ada Lovelace');
    await expect(page.getByRole('button', { name: 'Change email address' })).toContainText('ada@example.com');
    await expect(page.getByRole('button', { name: 'Change time zone' })).toContainText('Browser default');
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });

  test('editing the name PATCHes only the name fields', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockAccountApi(page);
    await page.goto('/admin/account');
    await page.getByRole('button', { name: 'Edit name' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit name' });
    await dialog.getByLabel('Last name').fill('King');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(mock.patches).toEqual([{ firstName: 'Ada', lastName: 'King' }]);
    await expect(page.getByRole('button', { name: 'Edit name' })).toContainText('Ada King');
    await expect(page.getByRole('button', { name: 'Edit name' })).toBeFocused();
  });

  test('phone is normalized on the client and removable', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockAccountApi(page);
    await page.goto('/admin/account');
    await page.getByRole('button', { name: 'Add phone number' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add phone number' });
    await dialog.getByLabel('Phone number').fill('123');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Enter a valid phone number.')).toBeVisible();
    await dialog.getByLabel('Phone number').fill('919 555 0100');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(mock.patches).toEqual([{ phone: '+19195550100' }]);
    await expect(page.getByRole('button', { name: 'Edit phone number' })).toContainText('(919) 555-0100');

    await page.getByRole('button', { name: 'Edit phone number' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit phone number' });
    await edit.getByLabel('Phone number').fill('');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    expect(mock.patches[1]).toEqual({ phone: null });
    await expect(page.getByRole('button', { name: 'Add phone number' })).toBeVisible();
  });

  test('email change goes pending with resend and cancel; a taken address is a field error', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockAccountApi(page);
    await page.goto('/admin/account');
    await page.getByRole('button', { name: 'Change email address' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change email address' });
    await dialog.getByLabel('New email address').fill('taken@example.com');
    await dialog.getByRole('button', { name: 'Send confirmation' }).click();
    await expect(dialog.getByText('That email address is already in use.')).toBeVisible();
    await dialog.getByLabel('New email address').fill('ada@newdomain.example');
    await dialog.getByRole('button', { name: 'Send confirmation' }).click();
    await expect(dialog).toBeHidden();
    const pending = page.getByTestId('account-email-pending');
    await expect(pending).toContainText('ada@newdomain.example');
    await expect(page.getByRole('button', { name: 'Change email address' })).toContainText('Pending confirmation');
    await pending.getByRole('button', { name: 'Cancel change' }).click();
    await expect(pending).toBeHidden();
  });

  test('time zone can be searched and saved; language shows the supported list', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockAccountApi(page);
    await page.goto('/admin/account');
    await page.getByRole('button', { name: 'Change time zone' }).click();
    const dialog = page.getByRole('dialog', { name: 'Time zone' });
    await dialog.getByLabel('Search').fill('Denver');
    await dialog.getByLabel('Time zone', { exact: true }).selectOption('America/Denver');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(mock.patches).toEqual([{ timeZone: 'America/Denver' }]);
    await expect(page.getByRole('button', { name: 'Change time zone' })).toContainText('Denver (GMT');

    await page.getByRole('button', { name: 'Change preferred language' }).click();
    const language = page.getByRole('dialog', { name: 'Preferred language' });
    await expect(language.getByLabel('Language')).toHaveValue('en-US');
    await expect(language.getByText("It doesn't affect the language your customers see")).toBeVisible();
    await expect(language.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('removing the photo asks for confirmation and falls back to initials', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockAccountApi(page, {
      avatar: { id: 'img-1', hash: 'abc', urls: { original: '/images/img-1/abc/original', thumb: '/images/img-1/abc/thumb', card: '/images/img-1/abc/card', hero: '/images/img-1/abc/hero' } },
    });
    await page.route(`${API}/images/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') })
    );
    await page.goto('/admin/account');
    await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.getByLabel('No photo; showing initials')).toHaveText('AL');
    await expect(page.getByRole('button', { name: 'Upload photo' })).toBeVisible();
  });
});
