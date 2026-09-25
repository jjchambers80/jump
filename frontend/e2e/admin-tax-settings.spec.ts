// Settings › Tax (spec 009): service card, regions table, edit dialog.
// Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-tax';

type Source = 'STRIPE' | 'MANUAL';
interface MockRegion {
  country: 'US';
  region: string;
  name: string;
  venueCount: number;
  upcomingEventCount: number;
  configured: boolean;
  collecting: boolean;
  source: Source | null;
  manualRate: number | null;
  registrationFound: boolean;
  lastRate: number | null;
  lastSource: Source | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

function region(code: string, name: string, overrides: Partial<MockRegion> = {}): MockRegion {
  return {
    country: 'US',
    region: code,
    name,
    venueCount: 1,
    upcomingEventCount: 3,
    configured: false,
    collecting: false,
    source: null,
    manualRate: null,
    registrationFound: false,
    lastRate: null,
    lastSource: null,
    lastCheckedAt: null,
    lastError: null,
    ...overrides,
  };
}

const activeService = {
  provider: 'STRIPE_TAX',
  status: 'active',
  registrations: [{ country: 'US', region: 'NC' }],
  error: null,
};

async function mockSession(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN' = 'ADMIN') {
  await signInAsStaff(page, { id: `tax-${role.toLowerCase()}`, email: `tax-${role.toLowerCase()}@test.com`, role }, baseURL);
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
  service?: Record<string, unknown>;
  needsAddress?: { id: string; name: string }[];
  canEdit?: boolean;
  /** Reject the PUT with this message. */
  saveError?: string;
  /** What a recalculate returns for lastRate / lastError. */
  recalc?: { lastRate: number | null; lastError: string | null };
  taxInclusivePricing?: boolean;
  report?: { rows: Array<{ region: string | null; name: string; orders: number; taxableSales: number; taxCollected: number; taxRefunded: number; taxNet: number; sources?: Array<{ source: 'order' | 'application'; count: number; taxableSales: number; taxCollected: number; taxRefunded: number; taxNet: number }> }> };
}

async function mockTaxApi(page: Page, regions: MockRegion[], options: MockOptions = {}) {
  const rows = new Map(regions.map((r) => [r.region, r]));
  const calls: { method: string; path: string; body?: unknown; query?: Record<string, string> }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const settings = { taxInclusivePricing: options.taxInclusivePricing ?? false };

  await page.route(`${API}/admin/settings/tax**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/admin/settings/tax', '');
    const method = req.method();
    calls.push({ method, path, body: ['PUT', 'PATCH'].includes(method) ? req.postDataJSON() : undefined, query: Object.fromEntries(url.searchParams) });

    if (method === 'GET' && path === '') {
      return route.fulfill(
        json({
          service: options.service ?? activeService,
          regions: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
          needsAddress: options.needsAddress ?? [],
          settings,
          canEdit: options.canEdit ?? true,
        })
      );
    }
    if (method === 'PATCH' && path === '') {
      settings.taxInclusivePricing = (req.postDataJSON() as { taxInclusivePricing: boolean }).taxInclusivePricing;
      return route.fulfill(json(settings));
    }
    if (method === 'GET' && path === '/report') {
      // Spec 018 phase 2 shape: `count` beside the `orders` alias, per-source breakdown.
      const rowsOut = (options.report?.rows ?? []).map((r) => ({
        ...r,
        count: r.orders,
        sources: r.sources ?? [{ source: 'order', count: r.orders, taxableSales: r.taxableSales, taxCollected: r.taxCollected, taxRefunded: r.taxRefunded, taxNet: r.taxNet }],
      }));
      const totals = rowsOut.reduce(
        (t, r) => ({ orders: t.orders + r.orders, count: t.count + r.count, taxableSales: t.taxableSales + r.taxableSales, taxCollected: t.taxCollected + r.taxCollected, taxRefunded: t.taxRefunded + r.taxRefunded, taxNet: t.taxNet + r.taxNet }),
        { orders: 0, count: 0, taxableSales: 0, taxCollected: 0, taxRefunded: 0, taxNet: 0 }
      );
      return route.fulfill(json({ from: `${url.searchParams.get('from')}T00:00:00.000Z`, to: `${url.searchParams.get('to')}T23:59:59.999Z`, rows: rowsOut, totals }));
    }
    const recalc = path.match(/^\/regions\/US\/([A-Z]{2})\/recalculate$/);
    if (method === 'POST' && recalc) {
      const existing = rows.get(recalc[1])!;
      const outcome = options.recalc ?? { lastRate: 0.0725, lastError: null };
      const updated: MockRegion = { ...existing, ...outcome, lastSource: existing.source, lastCheckedAt: '2026-09-14T00:00:00.000Z' };
      rows.set(recalc[1], updated);
      const failed = Boolean(outcome.lastError);
      return route.fulfill(json({ region: updated, recalculatedEvents: failed ? 0 : existing.upcomingEventCount, keptEvents: failed ? existing.upcomingEventCount : 0 }));
    }
    const put = path.match(/^\/regions\/US\/([A-Z]{2})$/);
    if (method === 'PUT' && put) {
      if (options.saveError) return route.fulfill(json({ error: 'ValidationError', message: options.saveError }, 400));
      const body = req.postDataJSON() as { collecting: boolean; source: Source; manualRate?: number };
      const existing = rows.get(put[1])!;
      const updated: MockRegion = {
        ...existing,
        configured: true,
        collecting: body.collecting,
        source: body.source,
        manualRate: body.source === 'MANUAL' ? body.manualRate ?? null : null,
        lastRate: body.collecting ? (body.source === 'MANUAL' ? body.manualRate ?? null : 0.0825) : existing.lastRate,
        lastSource: body.collecting ? body.source : existing.lastSource,
        lastCheckedAt: body.collecting ? '2026-09-13T12:00:00.000Z' : existing.lastCheckedAt,
        lastError: null,
      };
      rows.set(put[1], updated);
      return route.fulfill(json({ region: updated, recalculatedEvents: 3 }));
    }
    return route.fallback();
  });

  return { calls, rows };
}

test('Tax appears in Settings and shows the service card, regions and an action-needed banner', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockTaxApi(
    page,
    [
      region('NC', 'North Carolina', { configured: true, collecting: true, source: 'STRIPE', registrationFound: true, lastRate: 0.0725, lastSource: 'STRIPE', lastCheckedAt: '2026-09-12T00:00:00.000Z' }),
      region('TX', 'Texas', { venueCount: 2 }),
      region('VA', 'Virginia', { configured: true, collecting: true, source: 'MANUAL', manualRate: 0.053 }),
    ],
    { needsAddress: [{ id: 'v9', name: 'The Fillmore' }] }
  );
  await page.goto('/admin/settings/tax');

  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('link', { name: 'Tax' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Tax', exact: true })).toBeVisible();

  const service = page.getByTestId('tax-service-card');
  await expect(service).toContainText('Stripe Tax');
  await expect(service).toContainText('Active');
  await expect(service).toContainText('1 active registration');
  await expect(service.getByRole('link', { name: 'Manage' })).toHaveCount(0);

  await expect(page.getByTestId('tax-action-needed')).toContainText('Texas has venues but no tax setting');

  const nc = page.getByTestId('tax-region-NC');
  await expect(nc).toContainText('North Carolina');
  await expect(nc).toContainText('Collecting');
  await expect(nc).toContainText('Stripe Tax');
  await expect(nc).toContainText('7.25%');

  const tx = page.getByTestId('tax-region-TX');
  await expect(tx).toContainText('2 venues');
  await expect(tx).toContainText('Not set');

  const va = page.getByTestId('tax-region-VA');
  await expect(va).toContainText('Manual · 5.3%');

  await expect(page.getByTestId('tax-region-needs-address')).toContainText('The Fillmore');
  await expect(page.getByTestId('tax-region-needs-address').getByRole('link', { name: 'Edit venues' })).toHaveAttribute('href', '/admin/venues');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('editing a region: toggle collecting, choose a manual rate, save, row updates and focus returns', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockTaxApi(page, [region('TX', 'Texas')]);
  await page.goto('/admin/settings/tax');

  const row = page.getByRole('button', { name: 'Edit tax region Texas' });
  await row.click();

  const dialog = page.getByRole('dialog', { name: 'Edit tax region — Texas' });
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole('checkbox', { name: /Collect sales tax in Texas/ });
  await expect(toggle).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await toggle.check();
  await expect(dialog).toContainText('No Stripe Tax registration found for Texas');
  await dialog.getByRole('radio', { name: /Manual rate/ }).check();
  const rate = dialog.getByRole('textbox', { name: 'Manual tax rate for Texas, percent' });
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await rate.fill('99');
  await expect(dialog).toContainText('Enter a rate between 0 and 50.');
  await rate.fill('6.25');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ method: 'PUT', path: '/regions/US/TX', body: { collecting: true, source: 'MANUAL', manualRate: 0.0625 } });
  await expect(page.getByRole('status').filter({ hasText: 'Texas saved' })).toContainText('recalculated on 3 upcoming events');
  await expect(page.getByTestId('tax-action-needed')).toHaveCount(0);
  const tx = page.getByTestId('tax-region-TX');
  await expect(tx).toContainText('Collecting');
  await expect(tx).toContainText('Manual · 6.25%');
  await expect(row).toBeFocused();
});

test('Recalculate now re-runs the lookup for a saved region and reports the outcome', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockTaxApi(page, [
    region('NC', 'North Carolina', { configured: true, collecting: true, source: 'STRIPE', registrationFound: true, upcomingEventCount: 2, lastRate: 0.07, lastSource: 'STRIPE', lastCheckedAt: '2026-09-01T00:00:00.000Z' }),
    region('TX', 'Texas'),
  ]);
  await page.goto('/admin/settings/tax');

  // Unconfigured regions have nothing to recalculate.
  await page.getByRole('button', { name: 'Edit tax region Texas' }).click();
  const txDialog = page.getByRole('dialog', { name: 'Edit tax region — Texas' });
  await expect(txDialog).toContainText('3 upcoming events use this region');
  await expect(txDialog.getByRole('button', { name: /Recalculate/ })).toHaveCount(0);
  await txDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Edit tax region North Carolina' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tax region — North Carolina' });
  await expect(dialog).toContainText('Last lookup: 7% via Stripe Tax');
  await expect(dialog).toContainText('2 upcoming events use this region');
  const recalc = dialog.getByRole('button', { name: 'Recalculate now' });
  await expect(recalc).toBeEnabled();

  // Unsaved edits disable it — the lookup uses the saved setting.
  await dialog.getByRole('checkbox', { name: /Collect sales tax/ }).uncheck();
  await expect(recalc).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Collect sales tax/ }).check();
  await expect(recalc).toBeEnabled();

  await recalc.click();
  await expect(dialog.getByRole('status')).toContainText('Recalculated 2 upcoming events at 7.25%.');
  await expect(dialog).toContainText('Last lookup: 7.25% via Stripe Tax');
  expect(api.calls.find((c) => c.method === 'POST')).toMatchObject({ method: 'POST', path: '/regions/US/NC/recalculate' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('tax-region-NC')).toContainText('7.25%');
});

test('Recalculate now surfaces a lookup error from Stripe', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockTaxApi(page, [region('NC', 'North Carolina', { configured: true, collecting: true, source: 'STRIPE', registrationFound: true, upcomingEventCount: 1 })], {
    recalc: { lastRate: null, lastError: 'No Stripe Tax registration for North Carolina' },
  });
  await page.goto('/admin/settings/tax');
  await page.getByRole('button', { name: 'Edit tax region North Carolina' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tax region — North Carolina' });
  await dialog.getByRole('button', { name: 'Recalculate now' }).click();
  await expect(dialog.getByRole('status')).toContainText('Lookup failed; kept the current rate on 1 event: No Stripe Tax registration for North Carolina');
  await expect(dialog).toContainText('Last lookup on');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('tax-region-NC')).toContainText('Lookup failed');
});

test('turning collecting off sends STRIPE with no rate and the row shows Not collecting', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockTaxApi(page, [region('VA', 'Virginia', { configured: true, collecting: true, source: 'MANUAL', manualRate: 0.053 })]);
  await page.goto('/admin/settings/tax');

  await page.getByRole('button', { name: 'Edit tax region Virginia' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tax region — Virginia' });
  await dialog.getByRole('checkbox', { name: /Collect sales tax in Virginia/ }).uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ collecting: false, source: 'STRIPE' });
  await expect(page.getByTestId('tax-region-VA')).toContainText('Not collecting');
});

test('a server rejection stays inside the dialog', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  await mockTaxApi(page, [region('NC', 'North Carolina', { registrationFound: true })], { saveError: 'manualRate must be between 0 and 0.5' });
  await page.goto('/admin/settings/tax');

  await page.getByRole('button', { name: 'Edit tax region North Carolina' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tax region — North Carolina' });
  await dialog.getByRole('checkbox', { name: /Collect sales tax/ }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('manualRate must be between 0 and 0.5');
  await expect(dialog).toBeVisible();
});

test('ORGANIZER can view but the dialog is read-only', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!, 'ORGANIZER');
  await mockTaxApi(page, [region('NC', 'North Carolina', { configured: true, collecting: true, source: 'STRIPE', registrationFound: true })], { canEdit: false });
  await page.goto('/admin/settings/tax');

  await page.getByRole('button', { name: 'Edit tax region North Carolina' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tax region — North Carolina' });
  await expect(dialog.getByRole('note')).toContainText('Only organization admins can change tax settings.');
  await expect(dialog.getByRole('checkbox', { name: /Collect sales tax/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('pending Stripe Tax shows the warning, and SYSTEM_ADMIN gets the Manage link', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!, 'SYSTEM_ADMIN');
  await mockTaxApi(page, [region('NC', 'North Carolina', { configured: true, collecting: true, source: 'STRIPE' })], {
    service: { provider: 'STRIPE_TAX', status: 'pending', registrations: [], manageUrl: 'https://dashboard.stripe.com/settings/tax', error: null },
  });
  await page.goto('/admin/settings/tax');

  const service = page.getByTestId('tax-service-card');
  await expect(service).toContainText('Pending setup');
  await expect(service).toContainText('not activated on the platform account');
  await expect(service.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', 'https://dashboard.stripe.com/settings/tax');
  await expect(page.getByTestId('tax-region-NC')).toContainText('Stripe Tax inactive');
});

test('Include sales tax in ticket prices asks for confirmation with a worked example, then saves', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockTaxApi(page, [region('NC', 'North Carolina', { configured: true, collecting: true, source: 'MANUAL', manualRate: 0.0825, lastRate: 0.0825, lastSource: 'MANUAL' })]);
  await page.goto('/admin/settings/tax');

  const box = page.getByRole('checkbox', { name: 'Include sales tax in ticket prices' });
  await expect(box).not.toBeChecked();
  await box.click();

  const dialog = page.getByRole('dialog', { name: 'Include sales tax in ticket prices?' });
  await expect(dialog).toBeVisible();
  const example = dialog.getByTestId('tax-inclusive-example');
  await expect(example).toContainText('Example: a $50.00 tier at 8.25%');
  await expect(example).toContainText('$50.00 incl. $3.81 tax');
  await expect(example).toContainText('$54.02');
  await expect(example).toContainText('Today the same tier costs $58.45');

  // Cancel leaves it off
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(box).not.toBeChecked();
  await expect(box).toBeFocused();
  expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);

  await box.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Include tax in prices' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ taxInclusivePricing: true });
  await expect(box).toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: 'Ticket prices now include sales tax.' })).toBeVisible();
});

test('Collected tax report lists regions with totals and downloads a CSV', async ({ page, baseURL }) => {
  await mockSession(page, baseURL!);
  const api = await mockTaxApi(page, [], {
    report: {
      rows: [
        {
          region: 'NC', name: 'North Carolina', orders: 12, taxableSales: 1200, taxCollected: 87, taxRefunded: 7.25, taxNet: 79.75,
          sources: [
            { source: 'order', count: 10, taxableSales: 1000, taxCollected: 72.5, taxRefunded: 7.25, taxNet: 65.25 },
            { source: 'application', count: 2, taxableSales: 200, taxCollected: 14.5, taxRefunded: 0, taxNet: 14.5 },
          ],
        },
        { region: 'TX', name: 'Texas', orders: 3, taxableSales: 300, taxCollected: 18.75, taxRefunded: 0, taxNet: 18.75 },
      ],
    },
  });
  await page.goto('/admin/settings/tax');
  await page.getByRole('link', { name: 'Collected tax report' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/tax\/report$/);
  await expect(page.getByRole('heading', { name: 'Collected tax report' })).toBeVisible();

  const nc = page.getByTestId('tax-report-NC');
  await expect(nc).toContainText('North Carolina');
  await expect(nc).toContainText('$1,200.00'.replace(',', '')); // formatPrice has no thousands separator
  await expect(nc).toContainText('$87.00');
  await expect(nc).toContainText('$7.25');
  await expect(nc).toContainText('$79.75');
  // Source breakdown rows appear only where both kinds of money were collected (spec 018)
  await expect(page.getByTestId('tax-report-NC-application')).toContainText('Applications');
  await expect(page.getByTestId('tax-report-NC-application')).toContainText('$14.50');
  await expect(page.getByTestId('tax-report-TX-order')).toHaveCount(0);
  const totals = page.getByTestId('tax-report-totals');
  await expect(totals).toContainText('15');
  await expect(totals).toContainText('$105.75');
  await expect(totals).toContainText('$98.50');

  // Re-run with a custom range sends it to the API
  await page.getByLabel('From').fill('2026-03-01');
  await page.getByRole('textbox', { name: 'To' }).fill('2026-03-31');
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect.poll(() => api.calls.filter((c) => c.path === '/report').at(-1)?.query).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tax-collected-2026-03-01_2026-03-31.csv');
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks as Buffer[]).toString('utf8'));
  expect(text.split('\n')[0]).toBe('"Region","State","Source","Count","Taxable sales","Tax collected","Tax refunded (est.)","Tax net"');
  expect(text).toContain('"North Carolina","NC","Orders","10","1000.00","72.50","7.25","65.25"');
  expect(text).toContain('"North Carolina","NC","Applications","2","200.00","14.50","0.00","14.50"');
  expect(text).toContain('"Total","","","15"');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});
