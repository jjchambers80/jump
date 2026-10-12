// Contacts › Lists CSV import (spec 055-D): choose a file, match columns,
// import, see the results and download the skipped rows. Backend mocked.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG = { id: 'org-import', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers', status: 'ACTIVE' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const LIST = {
  id: 'list-crew',
  name: 'Stage crew',
  type: 'MANUAL',
  builtIn: false,
  filters: null,
  contactCount: 0,
  createdBy: { id: 'u1', name: 'Jamie Staff' },
  createdAt: '2026-10-01T12:00:00.000Z',
  lastActivityAt: '2026-10-10T12:00:00.000Z',
  filterWarnings: [],
};

const PREVIEW = {
  headers: ['E-mail', 'Name', 'Mobile'],
  mapping: { email: 0, firstName: null, lastName: null, name: 1, phone: 2, tags: null },
  sample: [
    ['ada@example.com', 'Ada Lovelace', '+19195550123'],
    ['nope', 'Bad Row', ''],
  ],
  rowCount: 2,
};

const CSV = 'E-mail,Name,Mobile\nada@example.com,Ada Lovelace,+19195550123\nnope,Bad Row,\n';

async function mockApi(page: Page, baseURL: string, { granted }: { granted?: string[] } = {}) {
  await signInAsStaff(page, { id: 'import-admin', email: 'import-admin@test.com', role: granted ? 'ORGANIZER' : 'ADMIN' }, baseURL);
  const uploads: { path: string; body: string }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/organizations') return route.fulfill(json([ORG]));
    if (path === '/admin/permissions') return granted ? route.fulfill(json({ granted, hiddenPaths: [] })) : route.fulfill(json({}, 404));
    if (path === `/admin/contact-lists/${LIST.id}`) return route.fulfill(json(LIST));
    if (path === `/admin/contact-lists/${LIST.id}/import/preview`) {
      uploads.push({ path, body: req.postData() ?? '' });
      return route.fulfill(json(PREVIEW));
    }
    if (path === `/admin/contact-lists/${LIST.id}/import`) {
      uploads.push({ path, body: req.postData() ?? '' });
      return route.fulfill(
        json({ rowCount: 2, added: 1, created: 1, alreadyOn: 0, skipped: [{ row: 3, email: 'nope', reason: 'invalid email' }] })
      );
    }
    if (path === '/admin/customers') return route.fulfill(json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
    return route.fulfill(json({}));
  });
  return uploads;
}

test('imports a CSV: matches columns, shows results and offers the skipped rows', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const uploads = await mockApi(page, baseURL!);
  await page.goto(`/admin/contacts/lists/${LIST.id}`);

  const open = page.getByRole('button', { name: 'Import CSV' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Import contacts into Stage crew' });
  await dialog.getByLabel('CSV file').setInputFiles({ name: 'crew.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  await expect(dialog.getByText('Match the columns (2 contacts in the file)')).toBeVisible();
  await expect(dialog.getByLabel(/^Email/)).toHaveValue('0');
  await expect(dialog.getByLabel(/^Full name/)).toHaveValue('1');
  await expect(dialog.getByRole('cell', { name: 'Ada Lovelace' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);

  await dialog.getByLabel(/^Phone/).selectOption('');
  await dialog.getByRole('button', { name: 'Import 2 contacts' }).click();

  await expect(dialog.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await expect(dialog.getByText('Added to the list').locator('..')).toContainText('1');
  await expect(dialog.getByRole('cell', { name: 'invalid email' })).toBeVisible();
  const importCall = uploads.find((u) => u.path.endsWith('/import'));
  expect(importCall?.body).toContain('"email":0');
  expect(importCall?.body).toContain('"phone":null');
  expect(importCall?.body).toContain('ada@example.com');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download skipped rows' }).click();
  expect((await download).suggestedFilename()).toBe('skipped-rows.csv');

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('without customers.import there is no Import CSV', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, baseURL!, { granted: ['dashboard', 'customers', 'customers.lists'] });
  await page.goto(`/admin/contacts/lists/${LIST.id}`);
  await expect(page.getByRole('link', { name: 'Add contacts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
});
