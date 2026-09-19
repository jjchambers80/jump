import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Online store › Preferences: store access (private mode + password + message)
// and the homepage search engine listing.

const API = 'http://localhost:3002';
const ORG_ID = 'org-prefs';

interface Prefs {
  storefrontPrivate: boolean;
  hasPassword: boolean;
  storefrontMessage: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

const DEFAULTS: Prefs = {
  storefrontPrivate: false,
  hasPassword: false,
  storefrontMessage: null,
  seoTitle: null,
  seoDescription: null,
};

async function mockPreferencesApi(page: Page, initial: Partial<Prefs> = {}) {
  let prefs: Prefs = { ...DEFAULTS, ...initial };
  const patches: Record<string, unknown>[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Raleigh Retro Gamers',
          slug: 'raleigh-retro-gamers',
          status: 'ACTIVE',
          createdAt: '2026-09-18T12:00:00.000Z',
          updatedAt: '2026-09-18T12:00:00.000Z',
        },
      ]),
    })
  );

  await page.route(`${API}/admin/online-store/preferences`, async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      // Mirror the backend invariant: private mode needs a password.
      const willHavePassword = 'password' in body ? Boolean(body.password) : prefs.hasPassword;
      const willBePrivate = 'storefrontPrivate' in body ? Boolean(body.storefrontPrivate) : prefs.storefrontPrivate;
      if (willBePrivate && !willHavePassword) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Set a password before turning on private mode',
            details: [{ field: 'password', message: 'A password is required while private mode is on' }],
          }),
        });
      }
      const { password, ...rest } = body;
      prefs = { ...prefs, ...(rest as Partial<Prefs>) };
      if ('password' in body) prefs.hasPassword = Boolean(password);
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) });
  });

  return { patches, current: () => prefs };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'prefs-admin', email: 'prefs-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('Preferences link sits under Online store and opens the two sections', async ({ page }) => {
  await mockPreferencesApi(page);
  await page.goto('/admin/online-store');

  const sidebar = page.locator('aside');
  const pagesLink = sidebar.getByRole('link', { name: 'Pages' });
  const prefsLink = sidebar.getByRole('link', { name: 'Preferences' });
  await expect(prefsLink).toBeVisible();
  expect((await prefsLink.boundingBox())!.y).toBeGreaterThan((await pagesLink.boundingBox())!.y);
  await prefsLink.click();

  await expect(page).toHaveURL(/\/admin\/online-store\/preferences$/);
  await expect(prefsLink).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('link', { name: 'Online store' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Preferences', level: 1 })).toBeVisible();

  const access = page.getByTestId('store-access');
  await expect(access.getByRole('heading', { name: 'Store access' })).toBeVisible();
  await expect(access.getByRole('switch', { name: 'Private mode' })).toHaveAttribute('aria-checked', 'false');
  await expect(access.getByLabel('Password')).toBeVisible();
  await expect(access.getByLabel('Custom message to your visitors')).toBeVisible();
  await expect(page.getByTestId('store-access-status')).toHaveText('Public');

  const seo = page.getByTestId('homepage-seo');
  await expect(seo.getByRole('heading', { name: 'Social sharing image and SEO' })).toBeVisible();
  await expect(seo.getByLabel('Homepage title')).toBeVisible();
  await expect(seo.getByLabel('Meta description')).toBeVisible();
  expect((await seo.boundingBox())!.y).toBeGreaterThan((await access.boundingBox())!.y);
});

test('private mode needs a password, then saves it with the visitor message', async ({ page }) => {
  const { patches } = await mockPreferencesApi(page);
  await page.goto('/admin/online-store/preferences');

  const access = page.getByTestId('store-access');
  const save = page.getByTestId('store-access-save');
  await access.getByRole('switch', { name: 'Private mode' }).click();
  await expect(save).toBeDisabled();
  await expect(access.getByText('Set a password to turn on private mode.')).toBeVisible();

  await access.getByLabel('Password').fill('abc');
  await expect(save).toBeDisabled();
  await access.getByLabel('Password').fill('retro-1985');
  await access.getByLabel('Custom message to your visitors').fill('Opening soon!');
  await expect(save).toBeEnabled();
  await save.click();

  await expect(access.getByRole('status')).toHaveText('Saved');
  expect(patches).toEqual([
    { storefrontPrivate: true, storefrontMessage: 'Opening soon!', password: 'retro-1985' },
  ]);
  await expect(page.getByTestId('store-access-status')).toHaveText('Private');
  await expect(access.getByLabel('Password')).toHaveValue('');
  await expect(access.getByText('A password is set. Enter a new one to change it.')).toBeVisible();
  await expect(page.getByTestId('store-password-remove')).toBeVisible();
});

test('removing the password makes the store public and never echoes the password', async ({ page }) => {
  const { patches, current } = await mockPreferencesApi(page, {
    storefrontPrivate: true,
    hasPassword: true,
    storefrontMessage: 'Members only',
  });
  await page.goto('/admin/online-store/preferences');

  await expect(page.getByTestId('store-access-status')).toHaveText('Private');
  await expect(page.getByLabel('Custom message to your visitors')).toHaveValue('Members only');
  await expect(page.getByLabel('Password')).toHaveValue('');

  await page.getByTestId('store-password-remove').click();
  await expect(page.getByTestId('store-access-status')).toHaveText('Public');
  expect(patches).toEqual([{ storefrontPrivate: false, password: null }]);
  expect(current().hasPassword).toBe(false);
  await expect(page.getByTestId('store-password-remove')).toHaveCount(0);
});

test('search engine listing saves the homepage title and meta description with a live preview', async ({ page }) => {
  const { patches } = await mockPreferencesApi(page);
  await page.goto('/admin/online-store/preferences');

  const seo = page.getByTestId('homepage-seo');
  const preview = page.getByTestId('seo-preview');
  await expect(preview).toContainText('Raleigh Retro Gamers');
  await expect(preview).toContainText(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('seo-save')).toBeDisabled();

  await seo.getByLabel('Homepage title').fill('Retro Nights in Raleigh');
  await seo.getByLabel('Meta description').fill('Tickets for retro gaming nights across the Triangle.');
  await expect(preview).toContainText('Retro Nights in Raleigh');
  await expect(preview).toContainText('Tickets for retro gaming nights across the Triangle.');
  await expect(seo.getByText('23 of 70 characters used')).toBeVisible();
  await expect(seo.getByLabel('Homepage title')).toHaveAttribute('maxlength', '70');
  await expect(seo.getByLabel('Meta description')).toHaveAttribute('maxlength', '160');

  await page.getByTestId('seo-save').click();
  await expect(seo.getByRole('status')).toHaveText('Saved');
  expect(patches).toEqual([
    { seoTitle: 'Retro Nights in Raleigh', seoDescription: 'Tickets for retro gaming nights across the Triangle.' },
  ]);
  await expect(page.getByTestId('seo-save')).toBeDisabled();
});

test('server-side validation errors surface in the section', async ({ page }) => {
  await mockPreferencesApi(page);
  await page.route(`${API}/admin/online-store/preferences`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Validation failed',
        details: [{ field: 'seoTitle', message: 'seoTitle must be 70 characters or less' }],
      }),
    });
  });
  await page.goto('/admin/online-store/preferences');

  await page.getByLabel('Homepage title').fill('Too long');
  await page.getByTestId('seo-save').click();
  await expect(page.getByTestId('homepage-seo').getByRole('alert')).toHaveText('seoTitle must be 70 characters or less');
});
