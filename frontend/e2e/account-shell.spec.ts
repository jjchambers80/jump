// Patron account shell (spec 040 card A): the sections nav on phones and
// desktop, the Applications tab only for applicants, applications waiting on
// the buyer surfaced on the overview, upcoming vs past tickets, and the
// orders section. Backend and buyer proxies mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-shell';
const ORG = { id: ORG_ID, name: 'Shell Org', logoUrl: null, coverUrl: null, brandColor: '#0f766e', themeMode: 'SYSTEM', buyerSignInLinks: true };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const future = new Date(Date.now() + 30 * 86400000).toISOString();
const past = new Date(Date.now() - 30 * 86400000).toISOString();
const ticket = (id: string, n: number, eventDate: string, eventName: string) => ({
  id, ticketNumber: n, eventId: 'ev', eventName, eventDate, eventTimezone: 'America/New_York', venue: 'Hall', priceTierName: 'GA', status: 'VALID', pricePaid: 20, isRefundable: false,
});
const TICKETS = [ticket('t1', 1, future, 'Spring Fair'), ticket('t2', 2, past, 'Winter Fair')];
const ORDERS = [
  { id: 'o1', orderRef: 'ORD-1', kind: 'TICKET', eventName: 'Spring Fair', eventDate: future, eventTimezone: 'America/New_York', quantity: 2, totalAmount: 40, status: 'PAID', createdAt: past },
  { id: 'o2', orderRef: 'ORD-2', kind: 'APPLICATION', applicationId: 'a1', description: 'Vendor', eventName: 'Spring Fair', eventDate: future, eventTimezone: 'America/New_York', quantity: 0, totalAmount: 100, status: 'PAID', createdAt: past },
];
const APPLICATION = {
  id: 'a1', orderRef: null, form: { id: 'f', name: 'Vendors', kind: 'PAID' }, event: { id: 'ev', name: 'Spring Fair', date: future, timezone: 'America/New_York' },
  organization: { id: ORG_ID, name: 'Shell Org' }, status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', tier: null,
  amounts: { subtotal: 100, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 100, orgReceives: 100, feeMode: 'PASS', currency: 'usd' },
  addOns: [], adjustments: [], paymentDueAt: future, selection: null, profile: { id: 'p', businessName: 'Biz', description: null, website: null, socials: {}, photos: [] },
  answers: [], boothLabel: null, booth: null, hasCardOnFile: false, submittedAt: past, decidedAt: past, paidAt: null, refundedTotal: 0,
  canWithdraw: true, canResume: false, canPay: true, canUpdateCard: false,
};

async function mockAccount(page: Page, { applications = [] as unknown[] } = {}) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me', (r) => r.fulfill(json({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'L', organization: { id: ORG_ID, name: 'Shell Org' } })));
  await page.route('**/api/buyer/me/tickets', (r) => r.fulfill(json({ data: TICKETS })));
  await page.route('**/api/buyer/me/orders', (r) => r.fulfill(json({ data: ORDERS })));
  await page.route('**/api/buyer/me/applications', (r) => r.fulfill(json({ data: applications })));
  await page.route('**/api/buyer/me/applicant-profile', (r) => r.fulfill(json(null)));
}

test('overview splits upcoming and past tickets; no Applications tab without applications', async ({ page }) => {
  await mockAccount(page);
  await page.goto(`/organizations/${ORG_ID}/account`);

  await expect(page.getByRole('heading', { name: 'Hi, Ada' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Account' });
  await expect(nav.getByRole('link', { name: 'Tickets' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Applications' })).toHaveCount(0);

  await expect(page.getByRole('list', { name: 'Upcoming' }).getByText('Spring Fair · #1')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Past' }).getByText('Winter Fair · #2')).toBeVisible();
  await expect(page.getByTestId('account-action-needed')).toHaveCount(0);
});

test('applications waiting on the buyer show on the overview and link to the Applications tab', async ({ page }) => {
  await mockAccount(page, { applications: [APPLICATION] });
  await page.goto(`/organizations/${ORG_ID}/account`);

  const action = page.getByTestId('account-action-needed');
  await expect(action).toContainText('Payment due');
  await expect(action).toContainText('Spring Fair · Vendors');
  await action.getByRole('link').click();

  await expect(page).toHaveURL(new RegExp(`/organizations/${ORG_ID}/account/applications$`));
  const nav = page.getByRole('navigation', { name: 'Account' });
  await expect(nav.getByRole('link', { name: 'Applications' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('account-applications')).toBeVisible();
});

test('orders section: ticket orders open the order, application orders the Applications tab', async ({ page }) => {
  await mockAccount(page, { applications: [APPLICATION] });
  await page.goto(`/organizations/${ORG_ID}/account/orders`);

  const rows = page.getByTestId('account-order');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', '/orders/o1');
  await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', `/organizations/${ORG_ID}/account/applications`);
  await expect(rows.nth(0)).toContainText('ORD-1');
  await expect(rows.nth(0)).toContainText('$40.00');
});

test('phones: the nav is one scrolling tab row above the content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAccount(page, { applications: [APPLICATION] });
  await page.goto(`/organizations/${ORG_ID}/account/orders`);

  const nav = page.getByTestId('account-nav');
  await expect(nav).toHaveCount(1);
  const tabs = nav.getByRole('link');
  await expect(tabs).toHaveCount(3);
  const [first, second] = [await tabs.nth(0).boundingBox(), await tabs.nth(1).boundingBox()];
  expect(first && second && Math.abs(first.y - second.y) < 2).toBeTruthy();
  await expect(nav.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
  const body = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(body).toBeTruthy();
});
