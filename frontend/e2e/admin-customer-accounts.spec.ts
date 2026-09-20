import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Settings › Customer accounts (spec 031 phase 1): nav entry, sign-in links
// toggle, read-only authentication row, account URL card. Backend mocked.

const API = 'http://localhost:3002';
const ORG_ID = 'org-cust';

interface Settings {
  buyerSignInLinks: boolean;
  refundPolicy: { enabled: boolean; cutoffHours: number | null; feeType: 'NONE' | 'FIXED' | 'PERCENT'; feeValue: number | null };
  signInMethod: 'LINK';
  accountUrl: string;
  domain: { hostname: string } | null;
}

const DEFAULTS: Settings = {
  buyerSignInLinks: true,
  refundPolicy: { enabled: true, cutoffHours: null, feeType: 'NONE', feeValue: null },
  signInMethod: 'LINK',
  accountUrl: `http://localhost:3001/organizations/${ORG_ID}/account`,
  domain: null,
};

async function mockApi(page: Page, initial: Partial<Settings> = {}) {
  let settings: Settings = { ...DEFAULTS, ...initial };
  const patches: Record<string, unknown>[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: ORG_ID, name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE', createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z' },
      ]),
    })
  );
  await page.route(`${API}/admin/settings/customer-accounts`, async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      const policy = { ...settings.refundPolicy };
      if ('selfServeRefundsEnabled' in body) policy.enabled = body.selfServeRefundsEnabled as boolean;
      if ('selfServeRefundCutoffHours' in body) policy.cutoffHours = body.selfServeRefundCutoffHours as number | null;
      if ('selfServeRefundFeeType' in body) policy.feeType = body.selfServeRefundFeeType as Settings['refundPolicy']['feeType'];
      if ('selfServeRefundFeeValue' in body) policy.feeValue = body.selfServeRefundFeeValue as number | null;
      if (policy.feeType === 'NONE') policy.feeValue = null;
      settings = { ...settings, ...(('buyerSignInLinks' in body) ? { buyerSignInLinks: body.buyerSignInLinks as boolean } : {}), refundPolicy: policy };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });
  return { patches, current: () => settings };
}

test.describe('as ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'cust-admin', email: 'cust-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('Customer accounts sits in the Settings nav and shows the three cards', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/settings');

    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    const link = nav.getByRole('link', { name: 'Customer accounts' });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.y).toBeGreaterThan((await nav.getByRole('link', { name: 'Applications' }).boundingBox())!.y);
    await link.click();

    await expect(page).toHaveURL(/\/admin\/settings\/customer-accounts$/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Customer accounts', level: 2 })).toBeVisible();

    const links = page.getByTestId('sign-in-links-card');
    await expect(links.getByRole('switch', { name: 'Show sign-in links' })).toHaveAttribute('aria-checked', 'true');

    const accounts = page.getByTestId('customer-accounts-card');
    await expect(accounts.getByRole('link', { name: 'Customize' })).toHaveAttribute('href', '/admin/settings');
    await expect(page.getByTestId('authentication-row')).toContainText('Email link');
    await expect(page.getByLabel('Customer account URL')).toHaveValue(DEFAULTS.accountUrl);
    await expect(page.getByTestId('account-url-row').getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/admin/settings/domains');
  });

  test('toggling sign-in links saves at once and reflects the response', async ({ page }) => {
    const { patches } = await mockApi(page);
    await page.goto('/admin/settings/customer-accounts');

    const toggle = page.getByRole('switch', { name: 'Show sign-in links' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('status')).toHaveText('Saved');
    expect(patches).toEqual([{ buyerSignInLinks: false }]);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => patches.length).toBe(2);
    expect(patches).toEqual([{ buyerSignInLinks: false }, { buyerSignInLinks: true }]);
  });

  test('the refund policy saves cutoff and fee, and the toggle hides the form', async ({ page }) => {
    const { patches } = await mockApi(page);
    await page.goto('/admin/settings/customer-accounts');

    const row = page.getByTestId('self-serve-refunds-row');
    await expect(row.getByRole('switch', { name: 'Self-serve refunds' })).toHaveAttribute('aria-checked', 'true');
    const save = page.getByTestId('refund-policy-save');
    await expect(save).toBeDisabled();

    await page.getByLabel('Cutoff (hours before the event)').fill('48');
    await page.getByLabel('Fee', { exact: true }).selectOption('FIXED');
    await expect(save).toBeDisabled(); // a fee type needs a value
    await expect(row).toContainText('Enter a fee amount above 0.');
    await page.getByLabel('Fee amount ($)').fill('2.50');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    expect(patches).toEqual([{ selfServeRefundCutoffHours: 48, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 2.5 }]);
    await expect(save).toBeDisabled(); // clean again

    await page.getByLabel('Fee', { exact: true }).selectOption('PERCENT');
    await page.getByLabel('Fee (%)').fill('150');
    await expect(row).toContainText('Enter a percentage above 0 and up to 100.');
    await expect(save).toBeDisabled();

    await row.getByRole('switch', { name: 'Self-serve refunds' }).click();
    await expect(page.getByTestId('refund-policy-form')).toHaveCount(0);
    await expect.poll(() => patches.length).toBe(2);
    expect(patches.at(-1)).toEqual({ selfServeRefundsEnabled: false });
  });

  test('the URL card shows the custom domain when one is active', async ({ page }) => {
    await mockApi(page, { accountUrl: 'https://tickets.rrg.test/account', domain: { hostname: 'tickets.rrg.test' } });
    await page.goto('/admin/settings/customer-accounts');
    await expect(page.getByLabel('Customer account URL')).toHaveValue('https://tickets.rrg.test/account');
    await expect(page.getByTestId('account-url-row')).toContainText('tickets.rrg.test');
  });
});

test('organizers see the toggle disabled', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'cust-org', email: 'cust-org@test.com', role: 'ORGANIZER' }, baseURL!);
  await mockApi(page);
  await page.goto('/admin/settings/customer-accounts');
  await expect(page.getByRole('switch', { name: 'Show sign-in links' })).toBeDisabled();
  await expect(page.getByText('Only admins can change this.')).toBeVisible();
});
