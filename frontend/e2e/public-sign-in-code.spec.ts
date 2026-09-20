// Buyer account page for a CODE organization (spec 031 phase 3): after the
// email step a 6-digit field appears; a wrong code shows the error, the right
// one signs in (proxy stubbed) and honours a stored return path.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-code';
const ORG = { id: ORG_ID, name: 'Code Org', logoUrl: null, coverUrl: null, brandColor: null, themeMode: 'SYSTEM', buyerSignInLinks: true, buyerSignInMethod: 'CODE' };

async function mockAccount(page: Page, { method = 'CODE' } = {}) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  let signedIn = false;
  const verifyBodies: Record<string, unknown>[] = [];
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) =>
    route.fulfill(json({ organization: { ...ORG, buyerSignInMethod: method }, locked: false, events: [] }))
  );
  await page.route('**/api/buyer/me', (route) =>
    signedIn
      ? route.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', organization: { id: ORG_ID, name: 'Code Org' } }))
      : route.fulfill(json({ error: 'Not signed in' }, 401))
  );
  await page.route('**/api/buyer/me/orders', (route) => route.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/tickets', (route) => route.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/applications', (route) => route.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/applicant-profile', (route) => route.fulfill(json(null)));
  await page.route('**/api/buyer/request', (route) => route.fulfill(json({ ok: true }, 202)));
  await page.route('**/api/buyer/verify-code', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    verifyBodies.push(body);
    if (body.code === '246810') {
      signedIn = true;
      return route.fulfill(json({ organizationId: ORG_ID }));
    }
    return route.fulfill(json({ error: 'This code is incorrect or has expired' }, 401));
  });
  return verifyBodies;
}

test('the code step appears after the email, rejects a wrong code and signs in with the right one', async ({ page }) => {
  const bodies = await mockAccount(page);
  await page.goto(`/organizations/${ORG_ID}/account`);
  await page.getByLabel('Email').fill('Ada@Example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const form = page.getByTestId('sign-in-code-form');
  await expect(form).toBeVisible();
  await expect(page.getByText(/a 6-digit code is on its way/)).toBeVisible();

  await form.getByLabel('Sign-in code').fill('123');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByRole('alert')).toHaveText('Enter the 6-digit code from the email');
  expect(bodies).toHaveLength(0);

  await form.getByLabel('Sign-in code').fill('000000');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByRole('alert')).toHaveText('This code is incorrect or has expired');

  await form.getByLabel('Sign-in code').fill('246 810');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Signed in as ada@example.com')).toBeVisible();
  expect(bodies.at(-1)).toEqual({ organizationId: ORG_ID, email: 'ada@example.com', code: '246810' });
});

test('a LINK organization never shows the code field', async ({ page }) => {
  await mockAccount(page, { method: 'LINK' });
  await page.goto(`/organizations/${ORG_ID}/account`);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByTestId('sign-in-code-form')).toHaveCount(0);
  await expect(page.getByText(/a sign-in link is on its way/)).toBeVisible();
});

test('signing in with a code continues to the stored return path', async ({ page }) => {
  await mockAccount(page);
  await page.route(`${API}/organizations/${ORG_ID}/public/pages/faq`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organization: ORG, page: { id: 'p', title: 'FAQ', slug: 'faq', content: '<p>Hi</p>' } }) })
  );
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ main: [], footer: [] }) })
  );
  await page.goto(`/organizations/${ORG_ID}/account?next=${encodeURIComponent(`/organizations/${ORG_ID}/pages/faq`)}`);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByTestId('sign-in-code-form').getByLabel('Sign-in code').fill('246810');
  await page.getByTestId('sign-in-code-form').getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${ORG_ID}/pages/faq`), { timeout: 20_000 });
});
