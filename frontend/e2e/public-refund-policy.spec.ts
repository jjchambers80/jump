// Buyer account page under the self-serve refund policy (spec 031 phase 2):
// per-ticket terms line, button only when eligible, confirm copy with the
// net amount. Backend + buyer proxies mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-refund';
const ORG = { id: ORG_ID, name: 'Refund Org', logoUrl: null, coverUrl: null, brandColor: null, themeMode: 'SYSTEM', buyerSignInLinks: true };

const deadline = new Date('2026-12-24T19:00:00Z').toISOString();
const base = { eventId: 'evt-1', eventName: 'Winter Show', eventDate: '2026-12-26T19:00:00Z', venue: 'Hall', priceTierName: 'GA', status: 'VALID', pricePaid: 20, isRefundable: true };
const tickets = [
  { ...base, id: 't-open', ticketNumber: 1, refundPolicy: { eligible: true, reason: null, deadline, fee: 0, refundAmount: 20 } },
  { ...base, id: 't-fee', ticketNumber: 2, refundPolicy: { eligible: true, reason: null, deadline, fee: 2.5, refundAmount: 17.5 } },
  { ...base, id: 't-closed', ticketNumber: 3, refundPolicy: { eligible: false, reason: 'WINDOW_CLOSED', deadline, fee: 0, refundAmount: 20 } },
  { ...base, id: 't-tier', ticketNumber: 4, isRefundable: false, refundPolicy: { eligible: false, reason: 'TIER', deadline, fee: 0, refundAmount: 20 } },
];

async function mockAccount(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) => route.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me', (route) =>
    route.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', organization: { id: ORG_ID, name: 'Refund Org' } }))
  );
  await page.route('**/api/buyer/me/orders', (route) => route.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/tickets', (route) => route.fulfill(json({ data: tickets })));
  await page.route('**/api/buyer/me/applications', (route) => route.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/applicant-profile', (route) => route.fulfill(json(null)));
  const refunds: string[] = [];
  await page.route('**/api/buyer/me/tickets/*/refund', (route) => {
    refunds.push(route.request().url());
    return route.fulfill(json({ id: 'r1', amount: 17.5, feeAmount: 2.5, status: 'SUCCEEDED' }));
  });
  return refunds;
}

test('each ticket explains its refund terms and only eligible ones get the button', async ({ page }) => {
  await mockAccount(page);
  await page.goto(`/organizations/${ORG_ID}/account`);

  const row = (n: number) => page.getByText(`Winter Show · #${n}`).locator('..').locator('..');
  await expect(row(1).getByTestId('refund-terms')).toHaveText(/Refundable until Dec 24, \d{1,2}:\d{2} (AM|PM)$/);
  await expect(row(1).getByRole('button', { name: 'Request refund' })).toBeVisible();
  await expect(row(2).getByTestId('refund-terms')).toHaveText(/Refundable until .* · \$2\.50 fee$/);
  await expect(row(3).getByTestId('refund-terms')).toHaveText('Refund window closed');
  await expect(row(3).getByRole('button', { name: 'Request refund' })).toHaveCount(0);
  await expect(row(4).getByTestId('refund-terms')).toHaveText('Not refundable');
  await expect(row(4).getByRole('button', { name: 'Request refund' })).toHaveCount(0);
});

test('the confirm names the net amount and the fee, then the result line shows what returns', async ({ page }) => {
  const refunds = await mockAccount(page);
  await page.goto(`/organizations/${ORG_ID}/account`);

  let confirmText = '';
  page.once('dialog', (dialog) => {
    confirmText = dialog.message();
    void dialog.accept();
  });
  const row = page.getByText('Winter Show · #2').locator('..').locator('..');
  await row.getByRole('button', { name: 'Request refund' }).click();
  await expect(page.getByRole('status')).toContainText('Ticket #2 refunded. $17.50 returns to your original payment method.');
  expect(confirmText).toContain("You'll receive $17.50 (a $2.50 fee is kept).");
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatch(/\/api\/buyer\/me\/tickets\/t-fee\/refund$/);
});
