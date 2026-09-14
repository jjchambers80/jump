// Settings › Domains (spec 008): list table, Connect existing dialog, and the
// per-domain setup page. Backend mocked at the network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-domains';
const PLATFORM_URL = `http://localhost:3001/organizations/${ORG_ID}`;

type RecordStatus = 'pending' | 'valid' | 'invalid' | 'missing';
interface MockDomain {
  id: string;
  hostname: string;
  zone: string;
  status: 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'FAILED';
  isPrimary: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failingSince: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: { key: 'cname' | 'txt'; type: 'CNAME' | 'TXT'; name: string; value: string; currentValue: string | null; status: RecordStatus }[];
  tlsManagedByRailway: boolean;
  certificateStatus: 'PENDING' | 'ISSUED' | 'FAILED' | null;
  dnsProvider: { key: string; name: string; dnsConsoleUrl: string; supportsApexCname: boolean } | null;
}

function makeDomain(hostname: string, overrides: Partial<MockDomain> = {}): MockDomain {
  const zone = hostname.split('.').slice(-2).join('.');
  return {
    id: `dom-${hostname.replace(/\W/g, '-')}`,
    hostname,
    zone,
    status: 'PENDING',
    isPrimary: false,
    verifiedAt: null,
    lastCheckedAt: null,
    failingSince: null,
    lastError: null,
    createdAt: '2026-09-13T12:00:00.000Z',
    dnsRecords: [
      { key: 'cname', type: 'CNAME', name: hostname, value: 'frontend.up.railway.app', currentValue: null, status: 'pending' },
      { key: 'txt', type: 'TXT', name: `_jump-verify.${hostname}`, value: 'jump-verify=0123456789abcdef', currentValue: null, status: 'pending' },
    ],
    tlsManagedByRailway: false,
    certificateStatus: null,
    dnsProvider: { key: 'cloudflare', name: 'Cloudflare', dnsConsoleUrl: 'https://dash.cloudflare.com/', supportsApexCname: true },
    ...overrides,
  };
}

async function mockAdminSession(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'domains-admin', email: 'domains-admin@test.com', role: 'ADMIN' }, baseURL);
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

/** In-memory domains API: list, get, add, verify (scripted), primary, delete. */
async function mockDomainsApi(page: Page, initial: MockDomain[], options: { verifyResult?: (d: MockDomain) => MockDomain } = {}) {
  const domains = new Map(initial.map((d) => [d.id, d]));
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${API}/admin/settings/domains**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/admin/settings/domains', '');
    const method = req.method();
    calls.push({ method, path, body: method === 'POST' ? req.postDataJSON() : undefined });

    if (method === 'GET' && path === '') {
      const list = [...domains.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      return route.fulfill(json({ domains: list, platformUrl: PLATFORM_URL }));
    }
    if (method === 'POST' && path === '') {
      const raw = (req.postDataJSON() as { hostname: string }).hostname;
      const hostname = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0]; // as the backend normalizes
      if ([...domains.values()].some((d) => d.hostname === hostname)) {
        return route.fulfill(json({ error: 'ConflictError', message: 'That hostname is already registered' }, 409));
      }
      const created = makeDomain(hostname, { isPrimary: domains.size === 0 });
      domains.set(created.id, created);
      return route.fulfill(json(created, 201));
    }
    const [, id, action] = path.split('/');
    const d = id ? domains.get(id) : undefined;
    if (!d) return route.fulfill(json({ error: 'NotFoundError', message: 'Domain not found' }, 404));

    if (method === 'GET') return route.fulfill(json(d));
    if (method === 'DELETE') {
      domains.delete(d.id);
      if (d.isPrimary) { const next = [...domains.values()][0]; if (next) next.isPrimary = true; } // backend promotes the oldest
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'POST' && action === 'verify') {
      const next = options.verifyResult ? options.verifyResult(d) : { ...d, lastCheckedAt: new Date().toISOString() };
      domains.set(d.id, next);
      return route.fulfill(json(next));
    }
    if (method === 'POST' && action === 'primary') {
      for (const other of domains.values()) other.isPrimary = other.id === d.id;
      return route.fulfill(json(d));
    }
    return route.fallback();
  });

  return { calls, domains };
}

test.beforeEach(async ({ page, baseURL }) => {
  await mockAdminSession(page, baseURL!);
});

test('Domains appears under General in Settings and lists the Jump URL when nothing is connected', async ({ page }) => {
  await mockDomainsApi(page, []);
  await page.goto('/admin/settings/domains');

  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  const links = nav.getByRole('link');
  await expect(links).toHaveText(['General', 'Domains', 'Tax', 'Users']);
  await expect(nav.getByRole('link', { name: 'Domains' })).toHaveAttribute('aria-current', 'page');

  await expect(page.getByRole('heading', { name: 'Domains' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect existing' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Buy new domain' })).toBeDisabled();

  const rows = page.getByRole('list', { name: 'Domains' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`localhost:3001/organizations/${ORG_ID}`);
  await expect(rows.first()).toContainText('Connected');
  await expect(page.getByText('Sell tickets on your own domain')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('lists the primary domain first with the Jump URL nested beneath it', async ({ page }) => {
  await mockDomainsApi(page, [
    makeDomain('shop.romanskincare.com', { status: 'PENDING' }),
    makeDomain('tickets.romanskincare.com', { status: 'ACTIVE', isPrimary: true, verifiedAt: '2026-09-13T12:30:00.000Z' }),
  ]);
  await page.goto('/admin/settings/domains');

  const rows = page.getByRole('list', { name: 'Domains' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('tickets.romanskincare.com');
  await expect(rows.nth(0)).toContainText('Primary');
  await expect(rows.nth(0)).toContainText('Connected');
  await expect(rows.nth(1)).toContainText('Jump URL');
  await expect(rows.nth(2)).toContainText('shop.romanskincare.com');
  await expect(rows.nth(2)).toContainText('Needs setup');
  await expect(rows.nth(0).getByRole('link', { name: 'tickets.romanskincare.com' })).toHaveAttribute('href', '/admin/settings/domains/dom-tickets-romanskincare-com');
});

test('Connect existing: validates inline, then Next registers the domain and opens its setup page', async ({ page }) => {
  const api = await mockDomainsApi(page, []);
  await page.goto('/admin/settings/domains');

  await page.getByRole('button', { name: 'Connect existing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect existing domain' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByLabel('Domain');
  await expect(field).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();

  // The Shopify screenshot's mistake: an email address in the domain field.
  await field.fill('test@test.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Enter a domain, not an email address.')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

  await field.fill('romanskincare.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText(/Root domains are not supported yet/)).toBeVisible();

  await field.fill('https://Tickets.RomanSkinCare.com/');
  await dialog.getByRole('button', { name: 'Next' }).click();

  await expect(page).toHaveURL(/\/admin\/settings\/domains\/dom-tickets-romanskincare-com$/);
  expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ hostname: 'https://Tickets.RomanSkinCare.com/' });

  await expect(page.getByRole('heading', { name: /tickets\.romanskincare\.com/ })).toBeVisible();
  await expect(page.getByText('Needs setup')).toBeVisible();
  await expect(page.getByText('Managed by Cloudflare')).toBeVisible();
  await expect(page.getByRole('link', { name: /Log in to Cloudflare/ })).toHaveAttribute('href', 'https://dash.cloudflare.com/');
});

test('Connect existing surfaces a server rejection inside the dialog', async ({ page }) => {
  await mockDomainsApi(page, [makeDomain('tickets.romanskincare.com', { isPrimary: true })]);
  await page.goto('/admin/settings/domains');
  await page.getByRole('button', { name: 'Connect existing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect existing domain' });
  await dialog.getByLabel('Domain').fill('tickets.romanskincare.com');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('That hostname is already registered')).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('setup page shows the DNS records with current values and walks the checklist to Connected', async ({ page }) => {
  const domain = makeDomain('tickets.romanskincare.com', { isPrimary: true });
  let verifies = 0;
  await mockDomainsApi(page, [domain], {
    verifyResult: (d) => {
      verifies += 1;
      if (verifies === 1) {
        // First check: TXT published, CNAME still points at the old host.
        return {
          ...d,
          lastCheckedAt: '2026-09-13T13:00:00.000Z',
          lastError: 'CNAME tickets.romanskincare.com points to customers.atom.com; expected frontend.up.railway.app',
          dnsRecords: [
            { ...d.dnsRecords[0], currentValue: 'customers.atom.com', status: 'invalid' },
            { ...d.dnsRecords[1], currentValue: 'jump-verify=0123456789abcdef', status: 'valid' },
          ],
        };
      }
      return {
        ...d,
        status: 'ACTIVE',
        verifiedAt: '2026-09-13T13:05:00.000Z',
        lastCheckedAt: '2026-09-13T13:05:00.000Z',
        lastError: null,
        dnsRecords: d.dnsRecords.map((r) => ({ ...r, currentValue: r.value, status: 'valid' as const })),
      };
    },
  });
  await page.goto(`/admin/settings/domains/${domain.id}`);

  const steps = page.getByRole('list', { name: 'Domain setup steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute('data-step-state', 'active');
  await expect(steps.nth(0)).toContainText('Configure DNS records on Cloudflare');
  await expect(steps.nth(0)).toContainText('open DNS management for romanskincare.com');
  await expect(steps.nth(1)).toHaveAttribute('data-step-state', 'todo');
  await expect(steps.nth(2)).toHaveAttribute('data-step-state', 'todo');

  // Records are shown relative to the zone, with the FQDN as a tooltip.
  const txtRow = page.locator('tr[data-record="txt"]');
  await expect(txtRow).toContainText('TXT');
  await expect(txtRow.locator('code[title="_jump-verify.tickets.romanskincare.com"]')).toHaveText('_jump-verify.tickets');
  await expect(txtRow).toContainText('(not checked yet)');
  await expect(txtRow).toContainText('jump-verify=0123456789abcdef');
  const cnameRow = page.locator('tr[data-record="cname"]');
  await expect(cnameRow.locator('code[title="tickets.romanskincare.com"]')).toHaveText('tickets');
  await expect(cnameRow).toContainText('frontend.up.railway.app');
  await expect(page.getByRole('button', { name: 'Copy TXT record value' })).toBeVisible();

  // First check: one record valid, one wrong — still step 1, with the current value shown.
  await page.getByRole('button', { name: 'I updated DNS records' }).click();
  await expect(cnameRow).toHaveAttribute('data-record-status', 'invalid');
  await expect(cnameRow).toContainText('customers.atom.com');
  await expect(txtRow).toHaveAttribute('data-record-status', 'valid');
  await expect(steps.nth(0)).toHaveAttribute('data-step-state', 'active');
  await expect(page.getByRole('status')).toContainText('DNS records not found yet');

  // Second check: connected.
  await page.getByRole('button', { name: 'I updated DNS records' }).click();
  await expect(page.getByRole('heading', { name: /tickets\.romanskincare\.com/ })).toContainText('Connected');
  await expect(steps.nth(0)).toHaveAttribute('data-step-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-step-state', 'done');
  await expect(steps.nth(2)).toHaveAttribute('data-step-state', 'info');
  await expect(page.getByText(/Live at/)).toContainText('https://tickets.romanskincare.com/');
  await expect(page.getByRole('status')).toContainText('tickets.romanskincare.com is connected.');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('Railway-managed domain shows the certificate step until it is issued', async ({ page }) => {
  const domain = makeDomain('tickets.romanskincare.com', {
    isPrimary: true,
    status: 'VERIFIED',
    tlsManagedByRailway: true,
    certificateStatus: 'PENDING',
    verifiedAt: '2026-09-13T13:00:00.000Z',
    lastCheckedAt: '2026-09-13T13:00:00.000Z',
    dnsRecords: [
      { key: 'cname', type: 'CNAME', name: 'tickets.romanskincare.com', value: 'abc.up.railway.app', currentValue: 'abc.up.railway.app', status: 'valid' },
      { key: 'txt', type: 'TXT', name: '_railway-verify.tickets.romanskincare.com', value: 'railway-verify=deadbeef', currentValue: 'railway-verify=deadbeef', status: 'valid' },
    ],
  });
  await mockDomainsApi(page, [domain]);
  await page.goto(`/admin/settings/domains/${domain.id}`);

  await expect(page.getByText('Verifying', { exact: true })).toBeVisible();
  const steps = page.getByRole('list', { name: 'Domain setup steps' }).getByRole('listitem');
  await expect(steps.nth(0)).toHaveAttribute('data-step-state', 'done');
  await expect(steps.nth(1)).toHaveAttribute('data-step-state', 'done');
  await expect(steps.nth(2)).toHaveAttribute('data-step-state', 'active');
  await expect(steps.nth(2)).toContainText('certificate is being issued');
  await expect(page.locator('tr[data-record="txt"]')).toContainText('_railway-verify.tickets');
});

test('More actions: make primary and delete domain', async ({ page }) => {
  const primary = makeDomain('tickets.romanskincare.com', { isPrimary: true, status: 'ACTIVE' });
  const second = makeDomain('shop.romanskincare.com');
  const api = await mockDomainsApi(page, [primary, second]);
  await page.goto(`/admin/settings/domains/${second.id}`);

  await page.getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Make primary', 'Delete domain']);
  await menu.getByRole('menuitem', { name: 'Make primary' }).click();
  await expect(page.getByRole('heading', { name: /shop\.romanskincare\.com/ })).toContainText('Primary');
  expect(api.calls.some((c) => c.method === 'POST' && c.path === `/${second.id}/primary`)).toBe(true);

  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu', { name: 'More actions' }).getByRole('menuitem')).toHaveText(['Delete domain']);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('menuitem', { name: 'Delete domain' }).click();

  await expect(page).toHaveURL(/\/admin\/settings\/domains$/);
  expect(api.calls.some((c) => c.method === 'DELETE' && c.path === `/${second.id}`)).toBe(true);
  const rows = page.getByRole('list', { name: 'Domains' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('tickets.romanskincare.com');
});

test('failed domain explains the outage and keeps the checklist on step 1', async ({ page }) => {
  const domain = makeDomain('tickets.romanskincare.com', {
    isPrimary: true,
    status: 'FAILED',
    failingSince: '2026-09-09T12:00:00.000Z',
    verifiedAt: '2026-09-01T12:00:00.000Z',
    lastError: 'TXT _jump-verify.tickets.romanskincare.com not found (ENOTFOUND)',
    dnsRecords: [
      { key: 'cname', type: 'CNAME', name: 'tickets.romanskincare.com', value: 'frontend.up.railway.app', currentValue: null, status: 'missing' },
      { key: 'txt', type: 'TXT', name: '_jump-verify.tickets.romanskincare.com', value: 'jump-verify=0123456789abcdef', currentValue: null, status: 'missing' },
    ],
  });
  await mockDomainsApi(page, [domain]);
  await page.goto(`/admin/settings/domains/${domain.id}`);

  await expect(page.getByRole('alert').filter({ hasText: 'DNS records' })).toContainText('have been missing since');
  const steps = page.getByRole('list', { name: 'Domain setup steps' }).getByRole('listitem');
  await expect(steps.nth(0)).toHaveAttribute('data-step-state', 'failed');
  await expect(page.locator('tr[data-record="cname"]')).toContainText('(empty)');
  await expect(page.getByRole('button', { name: 'I updated DNS records' })).toBeVisible();
});
