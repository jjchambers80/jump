// Patron account › Privacy (spec 040 cards C and D): "Download my data" saves
// the JSON file the backend builds; "Delete my data" previews, asks for the
// emailed code and schedules, can be cancelled, and explains blockers.
// Backend and buyer proxies mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-privacy';
const ORG = { id: ORG_ID, name: 'Privacy Org', logoUrl: null, coverUrl: null, brandColor: '#1d4ed8', themeMode: 'SYSTEM', buyerSignInLinks: true };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const future = new Date(Date.now() + 20 * 86400000).toISOString();
const PREVIEW = {
  ticketsToVoid: [{ id: 't1', ticketNumber: 7, eventName: 'Spring Fair', eventDate: future, eventTimezone: 'America/New_York' }],
  applicationsToWithdraw: [{ id: 'a1', formName: 'Press', eventName: 'Spring Fair' }],
  rsvpsToCancel: [],
  blockers: [],
  scheduledFor: null,
  graceDays: 7,
};

async function mockAccount(page: Page, preview: Record<string, unknown> = PREVIEW) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me', (r) => r.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'L', organization: { id: ORG_ID, name: 'Privacy Org' } })));
  for (const path of ['tickets', 'orders', 'applications', 'rsvps']) {
    await page.route(`**/api/buyer/me/${path}`, (r) => r.fulfill(json({ data: [] })));
  }
  await page.route('**/api/buyer/me/erasure', (r) => r.fulfill(r.request().method() === 'DELETE' ? json({ scheduledFor: null }) : json(preview)));
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

test('Delete my data: warns about tickets, needs the checkbox and the emailed code, then schedules', async ({ page }) => {
  await mockAccount(page);
  const scheduledFor = new Date(Date.now() + 7 * 86400000).toISOString();
  const confirms: unknown[] = [];
  await page.route('**/api/buyer/me/erasure/request', (r) => r.fulfill(json({ codeSent: true }, 202)));
  await page.route('**/api/buyer/me/erasure/confirm', (r) => {
    confirms.push(r.request().postDataJSON());
    return r.fulfill(json({ scheduledFor }));
  });
  await page.goto(`/organizations/${ORG_ID}/account/privacy`);

  const card = page.getByTestId('delete-data');
  await expect(card.getByTestId('delete-tickets')).toContainText('1 upcoming ticket will be cancelled with no refund');
  await expect(card.getByTestId('delete-tickets')).toContainText('Spring Fair · #7');
  await expect(card).toContainText('1 open application will be withdrawn.');

  const send = card.getByRole('button', { name: 'Email me a confirmation code' });
  await expect(send).toBeDisabled();
  await card.getByRole('checkbox').check();
  await send.click();

  const form = page.getByTestId('delete-code-form');
  await form.getByLabel('Confirmation code').fill('12');
  await form.getByRole('button', { name: 'Delete my data' }).click();
  await expect(card.getByRole('alert')).toHaveText('Enter the 6-digit code from the email');
  await form.getByLabel('Confirmation code').fill('123456');
  await form.getByRole('button', { name: 'Delete my data' }).click();

  await expect(card.getByRole('status')).toContainText('will be deleted on');
  await expect(page.getByTestId('erasure-banner')).toBeVisible();
  expect(confirms).toEqual([{ code: '123456' }]);

  await card.getByRole('button', { name: 'Cancel deletion' }).click();
  await expect(page.getByTestId('erasure-banner')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Email me a confirmation code' })).toBeVisible();
});

test('Delete my data: blockers are explained and nothing can be requested', async ({ page }) => {
  await mockAccount(page, { ...PREVIEW, blockers: [{ code: 'APPROVED_APPLICATION', message: 'Your approved Vendors application for Spring Fair holds a place. Ask the organizer to cancel it first.' }] });
  await page.goto(`/organizations/${ORG_ID}/account/privacy`);
  const blockers = page.getByTestId('delete-blockers');
  await expect(blockers).toContainText('Your data can’t be deleted yet');
  await expect(blockers).toContainText('Ask the organizer to cancel it first.');
  await expect(page.getByRole('button', { name: 'Email me a confirmation code' })).toHaveCount(0);
});
