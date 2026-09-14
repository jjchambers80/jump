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
}

async function mockTaxApi(page: Page, regions: MockRegion[], options: MockOptions = {}) {
  const rows = new Map(regions.map((r) => [r.region, r]));
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${API}/admin/settings/tax**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/admin/settings/tax', '');
    const method = req.method();
    calls.push({ method, path, body: method === 'PUT' ? req.postDataJSON() : undefined });

    if (method === 'GET' && path === '') {
      return route.fulfill(
        json({
          service: options.service ?? activeService,
          regions: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
          needsAddress: options.needsAddress ?? [],
          canEdit: options.canEdit ?? true,
        })
      );
    }
    const recalc = path.match(/^\/regions\/US\/([A-Z]{2})\/recalculate$/);
    if (method === 'POST' && recalc) {
      const existing = rows.get(recalc[1])!;
      const outcome = options.recalc ?? { lastRate: 0.0725, lastError: null };
      const updated: MockRegion = { ...existing, ...outcome, lastSource: existing.source, lastCheckedAt: '2026-09-14T00:00:00.000Z' };
      rows.set(recalc[1], updated);
      return route.fulfill(json({ region: updated, recalculatedEvents: existing.upcomingEventCount }));
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
  expect(api.calls.find((c) => c.method === 'PUT')).toEqual({ method: 'PUT', path: '/regions/US/TX', body: { collecting: true, source: 'MANUAL', manualRate: 0.0625 } });
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
  await expect(dialog.getByRole('status')).toContainText('Lookup ran on 1 upcoming event: No Stripe Tax registration for North Carolina');
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
