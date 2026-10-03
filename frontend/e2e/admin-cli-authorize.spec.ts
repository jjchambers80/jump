import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 043: Jump CLI browser sign-in and Settings › Developers.

const API = 'http://localhost:3002';
const CALLBACK = 'http://127.0.0.1:53682/callback';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const authorizeUrl = (extra = '') =>
  `/admin/cli/authorize?store=riverside&redirect_uri=${encodeURIComponent(CALLBACK)}&state=s123&code_challenge=${challenge}&name=Jump%20CLI%20on%20laptop${extra}`;

async function mockApi(page: Page) {
  const calls: unknown[] = [];
  await page.route(`${API}/**`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API}/developer/authorize?*`, (route) =>
    route.fulfill({ json: { organization: { id: 'org-1', name: 'Riverside Presents', slug: 'riverside' } } }),
  );
  await page.route(`${API}/developer/authorize`, async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { code: 'one-time-code', organization: { id: 'org-1', name: 'Riverside Presents', slug: 'riverside' } } });
  });
  await page.route(`${CALLBACK}?*`, (route) => route.fulfill({ contentType: 'text/html', body: '<p>CLI got it</p>' }));
  return calls;
}

test.describe('Jump CLI sign-in (043A)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'dev-1', email: 'dev@test.com', role: 'ORGANIZER' }, baseURL!);
  });

  test('approving hands the code back to the loopback listener', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(authorizeUrl());
    await expect(page.getByText(/wants to edit the online store themes of/)).toContainText('Riverside Presents');
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL(/127\.0\.0\.1:53682\/callback/);
    const url = new URL(page.url());
    expect(url.searchParams.get('code')).toBe('one-time-code');
    expect(url.searchParams.get('state')).toBe('s123');
    expect(calls).toEqual([{ store: 'riverside', codeChallenge: challenge, redirectUri: CALLBACK, name: 'Jump CLI on laptop' }]);
  });

  test('cancel tells the CLI the request was denied', async ({ page }) => {
    await mockApi(page);
    await page.goto(authorizeUrl());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(/127\.0\.0\.1:53682\/callback/);
    expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');
  });

  test('a non-loopback redirect is refused before anything is asked', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/admin/cli/authorize?store=riverside&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&state=s&code_challenge=${challenge}`);
    await expect(page.getByText('This sign-in link is incomplete.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('Settings › Developers lists and revokes sign-ins', async ({ page }) => {
    let tokens = [
      {
        id: 't1',
        name: 'Jump CLI on laptop',
        prefix: 'jmp_abc123',
        scopes: ['themes'],
        user: { id: 'dev-1', name: 'Dana Dev' },
        createdAt: '2027-03-01T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: '2027-05-30T10:00:00.000Z',
      },
    ];
    await page.route(`${API}/**`, (route) => route.fulfill({ json: [] }));
    await page.route(`${API}/admin/developer-tokens`, (route) => route.fulfill({ json: { tokens } }));
    await page.route(`${API}/admin/developer-tokens/t1`, async (route) => {
      tokens = [];
      await route.fulfill({ status: 204, body: '' });
    });
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/admin/settings/developers');
    const list = page.getByTestId('developer-tokens');
    await expect(list).toContainText('Jump CLI on laptop');
    await expect(list).toContainText('Dana Dev · themes · last used never');
    await list.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No one has signed in to the Jump CLI for this store.')).toBeVisible();
  });
});
