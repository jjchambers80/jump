// Settings › Payments — Stripe Connect payouts (spec 010 phase 2): provider
// card states, the Payout bank account page (empty state, onboarding return
// flows, schedule dialog), Finance › Payouts and the dashboard banner. Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-connect';

type ConnectStatus = 'not_started' | 'onboarding' | 'restricted' | 'active' | 'disconnected';

interface MockAccount {
  stripeAccountId: string;
  mode: 'test' | 'live';
  status: ConnectStatus;
  chargesEnabled: boolean;
  transfersEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  currentlyDue: string[];
  bank: { name: string | null; last4: string; currency: string | null } | null;
  payouts: {
    interval: 'daily' | 'weekly' | 'monthly' | 'manual' | null;
    anchor: string | null;
    delayDays: number | null;
    statementDescriptor: string | null;
    lastPayoutAt: string | null;
    lastPayoutFailure: string | null;
  };
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
}

function account(status: ConnectStatus, over: Partial<MockAccount> = {}): MockAccount {
  const base: MockAccount = {
    stripeAccountId: 'acct_e2e',
    mode: 'test',
    status,
    chargesEnabled: status === 'active',
    transfersEnabled: status === 'active',
    payoutsEnabled: status === 'active',
    detailsSubmitted: status !== 'onboarding',
    disabledReason: null,
    currentlyDue: status === 'restricted' ? ['external_account', 'individual.ssn_last_4'] : [],
    bank: status === 'active' ? { name: 'Wells Fargo', last4: '3544', currency: 'usd' } : null,
    payouts: { interval: 'daily', anchor: null, delayDays: 2, statementDescriptor: 'ROMAN SKIN', lastPayoutAt: '2026-09-12T00:00:00.000Z', lastPayoutFailure: null },
    disconnectedAt: status === 'disconnected' ? '2026-09-10T00:00:00.000Z' : null,
    lastSyncedAt: '2026-09-15T00:00:00.000Z',
  };
  return { ...base, ...over };
}

interface MockOptions {
  enabled?: boolean;
  status?: ConnectStatus;
  account?: MockAccount | null;
  canEdit?: boolean;
  role?: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN';
  /** What sync returns (defaults to the current state). */
  afterSync?: { status: ConnectStatus; account: MockAccount | null };
  payoutsError?: string;
  /** GET /admin/finance/payouts activity once onboarding is complete. */
  activity?: {
    balance: { available: number; pending: number; currency: string } | null;
    payouts: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      arrivalDate: string | null;
      createdAt: string | null;
      automatic: boolean;
      statementDescriptor: string | null;
      failureMessage: string | null;
      bank: { name: string | null; last4: string | null } | null;
    }>;
    error: string | null;
  };
}

async function mockSession(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN' = 'ADMIN') {
  await signInAsStaff(page, { id: `connect-${role.toLowerCase()}`, email: `connect-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: ORG_ID, name: 'Roman Skin Care', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]),
        })
      : route.fallback()
  );
  // Dashboard data for the banner test
  await page.route(`${API}/admin/dashboard/stats**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalCapacity: 0, ticketsSold: 0, remainingCapacity: 0, totalRevenue: 0, eventsCount: 0 }) })
  );
  await page.route(`${API}/admin/events**`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], total: 0 }) }));
}

async function mockPaymentsApi(page: Page, options: MockOptions = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const state = {
    enabled: options.enabled ?? true,
    status: options.status ?? 'not_started',
    account: options.account === undefined ? (options.status && options.status !== 'not_started' ? account(options.status) : null) : options.account,
  };
  const connect = () => ({ enabled: state.enabled, status: state.status, account: state.account });
  const provider = { provider: 'STRIPE', mode: 'test', charges: 'active', statementDescriptorPrefix: 'JUMP', capabilities: {}, error: null };
  const settings = {
    organization: { name: 'Roman Skin Care', phoneCountryCode: '+1', phoneNumber: null },
    statementDescriptorSuffix: null,
    descriptor: { prefix: 'JUMP', suffix: 'ROMAN SKIN CARE', full: 'JUMP* ROMAN SKIN CARE', derived: true, budget: 16 },
    enabledPaymentMethods: [],
    methods: { cards: ['visa'], wallets: ['apple_pay'], optional: [] },
    rates: { platformFeePercent: 0.05, processingFeePercent: 0.029, processingFeeFixed: 0.3 },
    updatedAt: null,
  };

  await page.route(`${API}/admin/finance/payouts**`, (route) => {
    calls.push({ method: 'GET', path: '/admin/finance/payouts' });
    const ready = state.enabled && state.account?.detailsSubmitted && !state.account.disconnectedAt;
    return route.fulfill(json({ connect: connect(), activity: ready ? options.activity ?? null : null, canEdit: options.canEdit ?? true }));
  });

  await page.route(`${API}/admin/settings/payments**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    calls.push({ method, path, body: method === 'PATCH' ? req.postDataJSON() : undefined });

    if (path === '/admin/settings/payments' && method === 'GET') {
      return route.fulfill(json({ provider, settings, connect: connect(), canEdit: options.canEdit ?? true }));
    }
    if (path.endsWith('/connect/onboard')) return route.fulfill(json({ url: 'https://connect.stripe.com/setup/e/acct_e2e/link' }));
    if (path.endsWith('/connect/login-link')) return route.fulfill(json({ url: 'https://connect.stripe.com/express/acct_e2e/login' }));
    if (path.endsWith('/connect/sync')) {
      if (options.afterSync) {
        state.status = options.afterSync.status;
        state.account = options.afterSync.account;
      }
      return route.fulfill(json({ connect: connect() }));
    }
    if (path.endsWith('/connect/payouts')) {
      if (options.payoutsError) return route.fulfill(json({ error: 'ValidationError', message: options.payoutsError }, 400));
      const body = req.postDataJSON() as { interval?: string; anchor?: string | number; statementDescriptor?: string };
      if (state.account) {
        state.account = {
          ...state.account,
          payouts: {
            ...state.account.payouts,
            ...(body.interval && { interval: body.interval as MockAccount['payouts']['interval'], anchor: body.anchor == null ? null : String(body.anchor) }),
            ...(body.statementDescriptor !== undefined && { statementDescriptor: body.statementDescriptor }),
          },
        };
      }
      return route.fulfill(json({ connect: connect() }));
    }
    return route.fallback();
  });

  // Stripe-hosted pages are never reached in tests; stop the navigation.
  await page.route('https://connect.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe</title>' }));

  return { calls, state };
}

test('flag off: no payouts pill, row or page content, phase 1 footer stays', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { enabled: false });
  await page.goto('/admin/settings/payments');
  await expect(page.getByTestId('payments-charges-pill')).toHaveText(/Accepting payments/);
  await expect(page.getByTestId('payments-payouts-pill')).toHaveCount(0);
  // The bank account row is always there; the page behind it explains
  await expect(page.getByTestId('payments-payouts-row')).toContainText('Coming soon');
  await expect(page.getByText('coming with Stripe Connect')).toBeVisible();

  await page.goto('/admin/settings/payments/payout-bank-account');
  await expect(page.getByTestId('payouts-disabled')).toBeVisible();
  await expect(page.getByTestId('payouts-connect-card')).toHaveCount(0);

  await page.goto('/admin/finance/payouts');
  await expect(page.getByTestId('finance-payouts-disabled')).toBeVisible();
});

test('not started: pill, action starts onboarding and redirects to Stripe', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page);
  await page.goto('/admin/settings/payments');

  await expect(page.getByTestId('payments-payouts-pill')).toHaveText('Set up payouts');
  await expect(page.getByTestId('payments-payouts-row')).toContainText('Not connected');
  await expect(page.getByText('coming with Stripe Connect')).toHaveCount(0);
  await expect(page.getByTestId('payments-connect-manage')).toHaveCount(0);

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);

  await page.getByTestId('payments-connect-action').click();
  await page.waitForURL('https://connect.stripe.com/setup/e/acct_e2e/link');
  expect(api.calls.some((c) => c.method === 'POST' && c.path.endsWith('/connect/onboard'))).toBe(true);
});

test('active: receiving payouts pill, Manage opens the Express dashboard, bank on the row', async ({ page, baseURL, context }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { status: 'active' });
  await page.goto('/admin/settings/payments');

  await expect(page.getByTestId('payments-payouts-pill')).toHaveText('Receiving payouts');
  await expect(page.getByTestId('payments-connect-action')).toHaveCount(0);
  await expect(page.getByTestId('payments-payouts-row')).toContainText('Wells Fargo •••• 3544');

  const popup = context.waitForEvent('page');
  await page.getByTestId('payments-connect-manage').click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toBe('https://connect.stripe.com/express/acct_e2e/login');
});

test('restricted: action required pill and guidance; ORGANIZER sees state but no actions', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!, 'ORGANIZER');
  await mockPaymentsApi(page, { status: 'restricted', canEdit: false, role: 'ORGANIZER' });
  await page.goto('/admin/settings/payments');
  await expect(page.getByTestId('payments-payouts-pill')).toHaveText('Action required');
  await expect(page.getByTestId('payments-connect-restricted')).toContainText('Sales still go through');
  await expect(page.getByTestId('payments-connect-action')).toHaveCount(0);

  await page.goto('/admin/settings/payments/payout-bank-account');
  await expect(page.getByTestId('payouts-restricted')).toContainText('Bank account, Personal details');
  await expect(page.getByTestId('payouts-action')).toHaveCount(0);
  await expect(page.getByTestId('payouts-sync')).toHaveCount(0);
});

test('payouts page: active account shows bank, schedule, on-hold and failure states', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, {
    status: 'active',
    account: account('active', {
      payoutsEnabled: false,
      payouts: { interval: 'weekly', anchor: 'friday', delayDays: 2, statementDescriptor: 'ROMAN SKIN', lastPayoutAt: '2026-09-12T00:00:00.000Z', lastPayoutFailure: 'Bank account closed' },
    }),
  });
  await page.goto('/admin/settings/payments/payout-bank-account');

  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/admin/settings/payments');
  await expect(page.getByTestId('payouts-status-pill')).toHaveText('Receiving payouts');
  await expect(page.getByTestId('payouts-on-hold')).toContainText('on hold');
  await expect(page.getByTestId('payouts-failure')).toContainText('Bank account closed');
  await expect(page.getByTestId('payouts-bank')).toHaveText('Wells Fargo •••• 3544');
  await expect(page.getByTestId('payouts-bank-card')).toContainText('Latest payout on Sep 12, 2026');
  await expect(page.getByTestId('payouts-schedule-row')).toContainText('Weekly on Friday · ROMAN SKIN');
  await expect(page.getByTestId('payouts-settings-card')).toContainText('2 business days');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('payout schedule dialog: monthly anchor and payout name save, focus returns', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page, { status: 'active' });
  await page.goto('/admin/settings/payments/payout-bank-account');

  const row = page.getByTestId('payouts-schedule-row');
  await expect(row).toContainText('Every business day · ROMAN SKIN');
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Payout frequency and statement name' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Payout every')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await dialog.getByLabel('Payout every').selectOption('monthly');
  await dialog.getByLabel('On day').selectOption('15');
  const name = dialog.getByLabel('Payout name');
  await name.fill('roman*skin');
  await expect(dialog.getByRole('alert')).toHaveText('Letters, numbers and spaces only.');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await name.fill('roman skin co');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(api.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ interval: 'monthly', anchor: 15, statementDescriptor: 'ROMAN SKIN CO' });
  await expect(row).toContainText('Monthly on the 15th · ROMAN SKIN CO');
  await expect(page.getByTestId('payouts-notice')).toContainText('Payout settings saved');
});

test('payout schedule dialog: server rejection stays in the dialog', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { status: 'active', payoutsError: 'Stripe rejected the payout settings: delay_days too low' });
  await page.goto('/admin/settings/payments/payout-bank-account');
  await page.getByTestId('payouts-schedule-row').click();
  const dialog = page.getByRole('dialog', { name: 'Payout frequency and statement name' });
  await dialog.getByLabel('Payout every').selectOption('weekly');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('delay_days too low');
  await expect(dialog).toBeVisible();
});

test('returning from Stripe with ?onboarding=complete syncs and reports the outcome', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page, { status: 'onboarding', afterSync: { status: 'active', account: account('active') } });
  await page.goto('/admin/settings/payments/payout-bank-account?onboarding=complete');

  await expect(page.getByTestId('payouts-notice')).toContainText('Stripe setup complete');
  await expect(page.getByTestId('payouts-status-pill')).toHaveText('Receiving payouts');
  await expect(page).toHaveURL(/\/admin\/settings\/payments\/payout-bank-account$/);
  expect(api.calls.filter((c) => c.path.endsWith('/connect/sync'))).toHaveLength(1);
});

test('returning with ?onboarding=complete but details still due shows what Stripe needs', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { status: 'onboarding', afterSync: { status: 'restricted', account: account('restricted') } });
  await page.goto('/admin/settings/payments/payout-bank-account?onboarding=complete');
  await expect(page.getByTestId('payouts-notice')).toContainText('Stripe still needs: Bank account, Personal details');
  await expect(page.getByTestId('payouts-action')).toHaveText('Update details');
});

test('returning with ?onboarding=refresh mints a new link and redirects', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page, { status: 'onboarding' });
  await page.goto('/admin/settings/payments/payout-bank-account?onboarding=refresh');
  await page.waitForURL('https://connect.stripe.com/setup/e/acct_e2e/link');
  expect(api.calls.filter((c) => c.path.endsWith('/connect/onboard'))).toHaveLength(1);
});

test('dashboard banner nudges setup and can be dismissed for the session', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page);
  await page.goto('/admin/dashboard');

  const banner = page.getByTestId('payouts-banner');
  await expect(banner).toContainText('Set up payouts');
  await expect(banner.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute('href', '/admin/settings/payments/payout-bank-account');
  await banner.getByRole('button', { name: 'Dismiss payouts reminder' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('payouts-banner')).toHaveCount(0);
});

test('dashboard banner is absent when active or when Connect is off', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { status: 'active' });
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('payouts-banner')).toHaveCount(0);
});

test('bank account page: empty state connects the bank through Stripe onboarding', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page);
  await page.goto('/admin/settings/payments/payout-bank-account');

  const card = page.getByTestId('payouts-connect-card');
  await expect(card).toContainText('Connect your bank account');
  await expect(card).toContainText('Add your external bank account to transfer funds');
  await expect(page.getByTestId('payouts-bank-card')).toHaveCount(0);
  await expect(page.getByTestId('payouts-about-card')).toContainText('What are payouts?');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);

  await page.getByTestId('payouts-action').click();
  await page.waitForURL('https://connect.stripe.com/setup/e/acct_e2e/link');
  expect(api.calls.some((c) => c.path.endsWith('/connect/onboard'))).toBe(true);
});

test('bank account page: active account shows last four and Change bank opens the Stripe dashboard', async ({ page, baseURL, context }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { status: 'active' });
  await page.goto('/admin/settings/payments/payout-bank-account');

  await expect(page.getByTestId('payouts-connect-card')).toHaveCount(0);
  await expect(page.getByTestId('payouts-bank')).toHaveText('Wells Fargo •••• 3544');
  await expect(page.getByTestId('payouts-bank-card')).toContainText('4 calendar days');

  const popup = context.waitForEvent('page');
  await page.getByTestId('payouts-change-bank').click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toBe('https://connect.stripe.com/express/acct_e2e/login');
});

test('finance: sidebar entry, landing links, and the payouts page before a bank is connected', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page);
  await page.goto('/admin/finance');

  const nav = page.getByRole('complementary').first();
  await expect(nav.getByRole('link', { name: 'Finance', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Payouts', exact: true })).toHaveAttribute('href', '/admin/finance/payouts');
  await expect(page.getByTestId('finance-payouts-link')).toHaveAttribute('href', '/admin/finance/payouts');
  await expect(page.getByTestId('finance-taxes-link')).toHaveAttribute('href', '/admin/settings/tax');
  await expect(page.getByTestId('finance-settings-link')).toHaveAttribute('href', '/admin/settings/payments');

  await page.getByTestId('finance-payouts-link').click();
  await expect(page).toHaveURL(/\/admin\/finance\/payouts$/);
  await expect(nav.getByRole('link', { name: 'Payouts', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('finance-payouts-empty')).toContainText('No payout bank account yet');
  await expect(page.getByTestId('finance-payouts-connect')).toHaveAttribute('href', '/admin/settings/payments/payout-bank-account');
});

test('finance payouts: balance, schedule and history once active; Stripe outage degrades gracefully', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, {
    status: 'active',
    activity: {
      balance: { available: 1234.5, pending: 250, currency: 'usd' },
      payouts: [
        { id: 'po_1', amount: 980.25, currency: 'usd', status: 'in_transit', arrivalDate: '2026-09-22T00:00:00.000Z', createdAt: '2026-09-20T00:00:00.000Z', automatic: true, statementDescriptor: 'ROMAN SKIN', failureMessage: null, bank: { name: 'Wells Fargo', last4: '3544' } },
        { id: 'po_2', amount: 410, currency: 'usd', status: 'paid', arrivalDate: '2026-09-12T00:00:00.000Z', createdAt: '2026-09-10T00:00:00.000Z', automatic: true, statementDescriptor: 'ROMAN SKIN', failureMessage: null, bank: { name: 'Wells Fargo', last4: '3544' } },
        { id: 'po_3', amount: 75, currency: 'usd', status: 'failed', arrivalDate: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-03T00:00:00.000Z', automatic: false, statementDescriptor: null, failureMessage: 'Account closed', bank: null },
      ],
      error: null,
    },
  });
  await page.goto('/admin/finance/payouts');

  await expect(page.getByTestId('finance-balance-available')).toContainText('$1,234.50');
  await expect(page.getByTestId('finance-balance-pending')).toContainText('$250.00');
  await expect(page.getByTestId('finance-payout-schedule')).toContainText('Every business day');
  await expect(page.getByTestId('finance-payout-schedule')).toContainText('Wells Fargo •••• 3544');
  await expect(page.getByTestId('finance-payouts-history')).toContainText('1 on the way · $980.25');
  const rows = page.getByTestId('finance-payout-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Sep 22, 2026');
  await expect(rows.nth(0)).toContainText('In transit');
  await expect(rows.nth(2)).toContainText('Failed');
  await expect(rows.nth(2)).toContainText('Account closed');
  await expect(rows.nth(2)).toContainText('Manual');
  await expect(page.getByTestId('finance-payouts-stripe')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);

  await mockPaymentsApi(page, { status: 'active', activity: { balance: null, payouts: [], error: 'Stripe could not be reached. Balance and payout history are temporarily unavailable.' } });
  await page.getByTestId('finance-payouts-refresh').click();
  await expect(page.getByTestId('finance-payouts-stripe-error')).toContainText('could not be reached');
  await expect(page.getByTestId('finance-balance-available')).toContainText('—');
  await expect(page.getByTestId('finance-payout-row')).toHaveCount(0);
});
