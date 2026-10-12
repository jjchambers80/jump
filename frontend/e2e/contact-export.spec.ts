// Contacts CSV export (spec 055-E): the Contacts tab and list pages export
// what they show, the Lists row menu exports a list, a missing step-up opens
// "Confirm it's you", and the button is hidden without customers.export.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG = { id: 'org-export', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers', status: 'ACTIVE' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const CSV = 'First name,Last name,Email\r\nAda,Lovelace,ada@example.com\r\n';

const LIST = {
  id: 'list-crew',
  name: 'Stage crew',
  type: 'MANUAL',
  builtIn: false,
  filters: null,
  contactCount: 1,
  createdBy: { id: 'u1', name: 'Jamie Staff' },
  createdAt: '2026-10-01T12:00:00.000Z',
  lastActivityAt: '2026-10-10T12:00:00.000Z',
  filterWarnings: [],
};

async function mockApi(page: Page, baseURL: string, { granted, needsReauth = false }: { granted?: string[]; needsReauth?: boolean } = {}) {
  await signInAsStaff(page, { id: 'export-admin', email: 'export-admin@test.com', role: granted ? 'ORGANIZER' : 'ADMIN' }, baseURL);
  const exports: URL[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/organizations') return route.fulfill(json([ORG]));
    if (path === '/admin/permissions') return granted ? route.fulfill(json({ granted, hiddenPaths: [] })) : route.fulfill(json({}, 404));
    if (path === '/admin/customers/export.csv') {
      exports.push(url);
      if (needsReauth && !req.headers()['x-jump-reauth']) {
        return route.fulfill(json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401));
      }
      const name = url.searchParams.get('list') ? 'stage-crew-contacts-2026-10-12.csv' : 'contacts-2026-10-12.csv';
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': `attachment; filename="${name}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' },
        body: CSV,
      });
    }
    if (path === '/admin/contact-lists') return route.fulfill(json({ lists: [LIST] }));
    if (path === `/admin/contact-lists/${LIST.id}`) return route.fulfill(json(LIST));
    if (path === '/admin/customers') {
      return route.fulfill(
        json({
          data: [{ id: 'c-ada', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', sources: [], formSources: [], transactionCount: 0, totalSpent: 0, lastActivityAt: null }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        })
      );
    }
    if (path === '/account/reauth/options') return route.fulfill(json({ methods: ['password'] }));
    return route.fulfill(json({}));
  });
  return exports;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('Contacts exports what the filters show, named by the server', async ({ page, baseURL }) => {
  const exports = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts?source=tickets&search=ada&page=2');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('contacts-2026-10-12.csv');
  const query = exports[0].searchParams;
  expect(query.get('source')).toBe('tickets');
  expect(query.get('search')).toBe('ada');
  expect(query.get('scope')).toBe('all');
  expect(query.get('page')).toBeNull();
});

test("a list's page and the Lists menu export that list", async ({ page, baseURL }) => {
  const exports = await mockApi(page, baseURL!);
  await page.goto(`/admin/contacts/lists/${LIST.id}`);
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('stage-crew-contacts-2026-10-12.csv');
  expect(exports.at(-1)?.searchParams.get('list')).toBe(LIST.id);

  await page.goto('/admin/contacts/lists');
  await page.getByRole('button', { name: `Actions for ${LIST.name}` }).click();
  download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('stage-crew-contacts-2026-10-12.csv');
});

test('without a recent sign-in the export asks to confirm it is you', async ({ page, baseURL }) => {
  await mockApi(page, baseURL!, { needsReauth: true });
  await page.goto('/admin/contacts');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible();
});

test('without customers.export there is no Export CSV', async ({ page, baseURL }) => {
  await mockApi(page, baseURL!, { granted: ['dashboard', 'customers', 'customers.lists'] });
  await page.goto('/admin/contacts');
  await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  await page.goto('/admin/contacts/lists');
  await page.getByRole('button', { name: `Actions for ${LIST.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Export CSV' })).toHaveCount(0);
});
