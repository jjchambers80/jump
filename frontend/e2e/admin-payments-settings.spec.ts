// Settings › Payments (spec 010 phase 1): provider card, statement descriptor
// dialog, payment methods page. Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-pay';

interface MockMethod {
  type: string;
  label: string;
  group: 'wallets' | 'more';
  help: string;
  available: boolean;
  enabled: boolean;
}

const OPTIONAL: MockMethod[] = [
  { type: 'link', label: 'Link', group: 'wallets', help: 'One-click checkout with a saved Stripe Link account.', available: true, enabled: false },
  { type: 'cashapp', label: 'Cash App Pay', group: 'more', help: 'Buyers pay from their Cash App balance or linked card.', available: true, enabled: false },
  { type: 'affirm', label: 'Affirm', group: 'more', help: 'Buyers pay in instalments; you receive the full amount.', available: false, enabled: false },
  { type: 'klarna', label: 'Klarna', group: 'more', help: 'Buyers pay in instalments; you receive the full amount.', available: false, enabled: false },
  { type: 'afterpay_clearpay', label: 'Afterpay', group: 'more', help: 'Buyers pay in instalments; you receive the full amount.', available: false, enabled: false },
];

const PREFIX = 'JUMP';
const BUDGET = 16;

function derive(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BUDGET).trim();
}

async function mockSession(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN' = 'ADMIN') {
  await signInAsStaff(page, { id: `pay-${role.toLowerCase()}`, email: `pay-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: ORG_ID, name: 'Roman Skin Care', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]),
        })
      : route.fallback()
  );
}

interface MockOptions {
  mode?: 'live' | 'test';
  charges?: 'active' | 'unavailable';
  prefix?: string | null;
  suffix?: string | null;
  enabled?: string[];
  canEdit?: boolean;
  role?: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN';
  /** Reject the PATCH with this message. */
  saveError?: string;
  phoneNumber?: string | null;
}

async function mockPaymentsApi(page: Page, options: MockOptions = {}) {
  const calls: { method: string; body?: unknown; query?: Record<string, string> }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const state = { suffix: options.suffix ?? null, enabled: options.enabled ?? [] };
  const prefix = options.prefix === undefined ? PREFIX : options.prefix;
  const name = 'Roman Skin Care';

  const provider = () => ({
    provider: 'STRIPE',
    mode: options.mode ?? 'live',
    charges: options.charges ?? 'active',
    statementDescriptorPrefix: prefix,
    capabilities: Object.fromEntries(OPTIONAL.map((m) => [m.type, m.available ? 'active' : 'inactive'])),
    ...(options.role === 'SYSTEM_ADMIN' ? { manageUrl: 'https://dashboard.stripe.com/', radarUrl: 'https://dashboard.stripe.com/radar/rules' } : {}),
    error: null,
  });
  const settings = () => {
    const effective = prefix ? state.suffix ?? derive(name) : null;
    return {
      organization: { name, phoneCountryCode: '+1', phoneNumber: options.phoneNumber === undefined ? '9194639575' : options.phoneNumber },
      statementDescriptorSuffix: state.suffix,
      descriptor: { prefix, suffix: effective, full: prefix && effective ? `${prefix}* ${effective}` : null, derived: state.suffix === null, budget: prefix ? BUDGET : 0 },
      enabledPaymentMethods: state.enabled,
      methods: {
        cards: ['visa', 'mastercard', 'amex', 'discover', 'diners', 'jcb'],
        wallets: ['apple_pay', 'google_pay'],
        optional: OPTIONAL.map((m) => ({ ...m, enabled: m.available && state.enabled.includes(m.type) })),
      },
      rates: { platformFeePercent: 0.05, processingFeePercent: 0.029, processingFeeFixed: 0.3 },
      updatedAt: null,
    };
  };

  await page.route(`${API}/admin/settings/payments**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    calls.push({ method, body: method === 'PATCH' ? req.postDataJSON() : undefined, query: Object.fromEntries(url.searchParams) });

    if (method === 'GET') {
      return route.fulfill(json({ provider: provider(), settings: settings(), canEdit: options.canEdit ?? true }));
    }
    if (method === 'PATCH') {
      if (options.saveError) return route.fulfill(json({ error: 'ValidationError', message: options.saveError }, 400));
      const body = req.postDataJSON() as { statementDescriptorSuffix?: string | null; enabledPaymentMethods?: string[] };
      if (body.statementDescriptorSuffix !== undefined) state.suffix = body.statementDescriptorSuffix;
      if (body.enabledPaymentMethods !== undefined) state.enabled = body.enabledPaymentMethods;
      return route.fulfill(json(settings()));
    }
    return route.fallback();
  });

  return { calls, state };
}

test('Payments appears in Settings with the provider card, derived statement name, rates and fraud row', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page);
  await page.goto('/admin/settings/payments');

  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');
  // Shopify order: Payments sits between Domains and Tax
  await expect(nav.getByRole('link')).toHaveText(['General', 'Domains', 'Payments', 'Tax', 'Users']);
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();

  const providerCard = page.getByTestId('payments-provider-card');
  await expect(providerCard).toContainText('Stripe');
  await expect(page.getByTestId('payments-charges-pill')).toHaveText(/Accepting payments/);
  await expect(page.getByTestId('payments-test-mode')).toHaveCount(0);
  await expect(providerCard.getByRole('link', { name: 'Manage' })).toHaveCount(0);
  await expect(page.getByTestId('payments-methods-row')).toContainText('Payment methods');
  await expect(page.getByTestId('payments-methods-row')).toContainText('+4');

  await expect(page.getByTestId('payments-descriptor')).toHaveText('JUMP* ROMAN SKIN CARE');
  await expect(page.getByTestId('payments-statement-card')).toContainText('Using your trade name');
  await expect(page.getByTestId('payments-statement-card')).toContainText('+1 (919) 463-9575');

  const rates = page.getByTestId('payments-rates-card');
  await expect(rates).toContainText('5% of ticket price');
  await expect(rates).toContainText('2.9% + $0.30 per order');
  await expect(rates.getByRole('link', { name: 'Per Settings › Tax' })).toHaveAttribute('href', '/admin/settings/tax');

  const fraud = page.getByTestId('payments-fraud-card');
  await expect(fraud).toContainText('Stripe Radar');
  await expect(fraud).toContainText('Active');
  await expect(fraud.getByRole('link')).toHaveCount(0);

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('test mode badge and SYSTEM_ADMIN dashboard links', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!, 'SYSTEM_ADMIN');
  const api = await mockPaymentsApi(page, { mode: 'test', role: 'SYSTEM_ADMIN' });
  await page.goto('/admin/settings/payments');

  await expect(page.getByTestId('payments-test-mode')).toBeVisible();
  await expect(page.getByTestId('payments-provider-card')).toContainText('no real money moves');
  await expect(page.getByTestId('payments-provider-card').getByRole('link', { name: 'Manage' })).toHaveAttribute('href', 'https://dashboard.stripe.com/');
  await expect(page.getByTestId('payments-fraud-card').getByRole('link')).toHaveAttribute('href', 'https://dashboard.stripe.com/radar/rules');
  // SYSTEM_ADMIN sends the switcher's org explicitly
  expect(api.calls[0].query).toMatchObject({ organizationId: ORG_ID });
});

test('editing the statement name: live preview, validation, save, focus returns', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page);
  await page.goto('/admin/settings/payments');

  const edit = page.getByTestId('payments-statement-card').getByRole('button', { name: 'Edit' });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Customer billing statement' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Roman Skin Care');
  await expect(dialog.getByTestId('statement-descriptor-prefix')).toHaveText('JUMP*');
  await expect(dialog.getByTestId('statement-descriptor-preview')).toHaveText('JUMP* ROMAN SKIN CARE');
  await expect(dialog.getByRole('link', { name: 'Edit on General' }).first()).toHaveAttribute('href', '/admin/settings');

  const input = dialog.getByLabel('Name on customer statement');
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await input.fill('roman*skin');
  await expect(dialog.getByRole('alert')).toHaveText('Letters, numbers and spaces only.');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await input.fill('2026');
  await expect(dialog.getByRole('alert')).toHaveText('Include at least one letter.');

  await input.fill('roman skin');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByTestId('statement-descriptor-preview')).toHaveText('JUMP* ROMAN SKIN');
  await expect(dialog).toContainText('6 of 16 left');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(api.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ statementDescriptorSuffix: 'ROMAN SKIN' });
  await expect(page.getByTestId('payments-descriptor')).toHaveText('JUMP* ROMAN SKIN');
  await expect(page.getByRole('status')).toContainText('Buyers will see "JUMP* ROMAN SKIN"');
});

test('server rejection is shown inside the dialog', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { saveError: 'Name on customer statement must be 16 characters or fewer with the "JUMP" prefix' });
  await page.goto('/admin/settings/payments');
  await page.getByTestId('payments-statement-card').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer billing statement' });
  await dialog.getByLabel('Name on customer statement').fill('roman skin');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('16 characters or fewer');
  await expect(dialog).toBeVisible();
});

test('no platform prefix: suffix input disabled with guidance', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { prefix: null });
  await page.goto('/admin/settings/payments');
  await expect(page.getByTestId('payments-descriptor')).toHaveText('Not available');
  await page.getByTestId('payments-statement-card').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer billing statement' });
  await expect(dialog.getByLabel('Name on customer statement')).toBeDisabled();
  await expect(dialog).toContainText('set a statement descriptor prefix');
});

test('ORGANIZER can view but not change payments', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!, 'ORGANIZER');
  await mockPaymentsApi(page, { canEdit: false, role: 'ORGANIZER' });
  await page.goto('/admin/settings/payments');
  await page.getByTestId('payments-statement-card').getByRole('button', { name: 'View' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customer billing statement' });
  await expect(dialog.getByLabel('Name on customer statement')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto('/admin/settings/payments/methods');
  await expect(page.getByRole('switch', { name: 'Link at checkout' })).toBeDisabled();
  await expect(page.getByTestId('payment-methods-card')).toContainText('Only organization admins can change payment methods');
});

test('payment methods page: groups, unavailable pills, toggling saves and rolls back on error', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockPaymentsApi(page, { enabled: ['cashapp'] });
  await page.goto('/admin/settings/payments/methods');

  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/admin/settings/payments');

  const card = page.getByTestId('payment-methods-card');
  await expect(card).toContainText('Cards');
  await expect(page.getByTestId('method-visa')).toContainText('On');
  await expect(page.getByTestId('method-apple_pay')).toContainText('Included with cards');
  await expect(page.getByTestId('method-affirm')).toContainText('Unavailable');
  await expect(page.getByTestId('method-affirm').getByRole('switch')).toHaveCount(0);

  const cashapp = page.getByRole('switch', { name: 'Cash App Pay at checkout' });
  await expect(cashapp).toHaveAttribute('aria-checked', 'true');
  const link = page.getByRole('switch', { name: 'Link at checkout' });
  await expect(link).toHaveAttribute('aria-checked', 'false');

  await link.click();
  await expect(link).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).toContainText('Link is now offered at checkout');
  expect(api.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ enabledPaymentMethods: ['cashapp', 'link'] });

  await cashapp.click();
  await expect(cashapp).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('status')).toContainText('Cash App Pay removed from checkout');
  expect(api.state.enabled).toEqual(['link']);

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('toggle rollback when the save fails', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockPaymentsApi(page, { saveError: 'link is not available on the platform Stripe account' });
  await page.goto('/admin/settings/payments/methods');
  const link = page.getByRole('switch', { name: 'Link at checkout' });
  await link.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('not available');
  await expect(link).toHaveAttribute('aria-checked', 'false');
});
