// Patron account › Privacy (spec 040 card C): "Download my data" saves the
// JSON file the backend builds; the daily cap shows the server's message.
// Backend and buyer proxies mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-privacy';
const ORG = { id: ORG_ID, name: 'Privacy Org', logoUrl: null, coverUrl: null, brandColor: '#1d4ed8', themeMode: 'SYSTEM', buyerSignInLinks: true };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockAccount(page: Page) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me', (r) => r.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'L', organization: { id: ORG_ID, name: 'Privacy Org' } })));
  for (const path of ['tickets', 'orders', 'applications', 'rsvps']) {
    await page.route(`**/api/buyer/me/${path}`, (r) => r.fulfill(json({ data: [] })));
  }
}

test('Download my data saves the JSON file with the server’s filename', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/export', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Content-Disposition': 'attachment; filename="privacy-org-my-data-2026-09-30.json"' },
      body: JSON.stringify({ format: { name: 'jump-customer-data', version: 1 }, contact: { email: 'ada@example.com' } }),
    })
  );
  await page.goto(`/organizations/${ORG_ID}/account/privacy`);
  await expect(page.getByRole('heading', { name: 'Your data with Privacy Org' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
  expect(download.suggestedFilename()).toBe('privacy-org-my-data-2026-09-30.json');
  await expect(page.getByRole('status')).toHaveText('Your file is downloading.');
});

test('the daily cap shows the server’s message', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/export', (r) => r.fulfill(json({ message: 'You can download your data 3 times a day. Try again tomorrow.' }, 429)));
  await page.goto(`/organizations/${ORG_ID}/account/privacy`);
  await page.getByRole('button', { name: 'Download my data' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('You can download your data 3 times a day. Try again tomorrow.');
});
