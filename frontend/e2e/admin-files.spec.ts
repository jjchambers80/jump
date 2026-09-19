// Content › Files (spec 025): list, copy link, detail save, delete — backend mocked.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-files';
const HASH = 'a'.repeat(64);

interface StoreFile {
  id: string;
  organizationId: string;
  name: string;
  extension: string;
  kind: 'image' | 'document';
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  url: string;
  downloadUrl: string;
  thumbUrl: string | null;
  previewUrl: string | null;
  focalX: number | null;
  focalY: number | null;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
  references: { kind: 'PAGE'; targetId: string; title: string; href: string }[];
}

function file(overrides: Partial<StoreFile> & Pick<StoreFile, 'id' | 'name'>): StoreFile {
  const extension = overrides.extension ?? 'png';
  const kind = extension === 'pdf' ? 'document' : 'image';
  return {
    organizationId: ORG_ID,
    extension,
    kind,
    mimeType: kind === 'image' ? 'image/png' : 'application/pdf',
    sizeBytes: 156_120,
    width: kind === 'image' ? 2048 : null,
    height: kind === 'image' ? 2048 : null,
    altText: null,
    url: `${API}/files/${overrides.id}/${HASH}/${overrides.name.toLowerCase().replace(/\s+/g, '-')}.${extension}`,
    downloadUrl: `${API}/files/${overrides.id}/${HASH}/${overrides.name}.${extension}?download=1`,
    thumbUrl: null,
    previewUrl: null,
    focalX: kind === 'image' ? 0.5 : null,
    focalY: kind === 'image' ? 0.5 : null,
    referenceCount: 0,
    createdAt: '2026-07-19T06:01:00.000Z',
    updatedAt: '2026-07-19T06:01:00.000Z',
    references: [],
    ...overrides,
  };
}

async function mockFilesApi(page: Page, initial: StoreFile[]) {
  const files = [...initial];
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Files Org',
          slug: 'files-org',
          status: 'ACTIVE',
          createdAt: '2026-09-18T12:00:00.000Z',
          updatedAt: '2026-09-18T12:00:00.000Z',
        },
      ]),
    })
  );

  await page.route(`${API}/admin/files?**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ method: request.method(), url: request.url() });
    if (request.method() === 'POST') {
      const created = file({ id: `file-${files.length + 1}`, name: 'uploaded' });
      files.unshift(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ files: [created], errors: [] }),
      });
    }
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = files.filter(
      (f) => !q || f.name.toLowerCase().includes(q) || (f.altText || '').toLowerCase().includes(q)
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ files: list, total: list.length, page: 1, pageSize: 50 }),
    });
  });
  await page.route(`${API}/admin/files`, async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), url: request.url() });
    if (request.method() === 'POST') {
      const created = file({ id: `file-${files.length + 1}`, name: 'uploaded' });
      files.unshift(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ files: [created], errors: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ files, total: files.length, page: 1, pageSize: 50 }),
    });
  });
  await page.route(`${API}/admin/files/bulk-delete**`, async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    calls.push({ method: 'POST', url: route.request().url(), body });
    for (const id of body.ids) {
      const index = files.findIndex((f) => f.id === id);
      if (index >= 0) files.splice(index, 1);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ deleted: body.ids, failed: [] }),
    });
  });
  await page.route(`${API}/admin/files/*`, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const existing = files.find((f) => f.id === id);
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'PATCH' ? request.postDataJSON() : undefined,
    });
    if (!existing)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'File not found' }),
      });
    if (request.method() === 'DELETE') {
      files.splice(files.indexOf(existing), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<StoreFile>;
      Object.assign(existing, body, { updatedAt: '2026-09-19T12:00:00.000Z' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(existing),
    });
  });

  return { calls, files };
}

const fixtures = [
  file({
    id: 'file-hero',
    name: 'Hero Image',
    altText: 'Crowd at the gate',
    referenceCount: 1,
    references: [
      {
        kind: 'PAGE',
        targetId: 'page-1',
        title: 'Vendors',
        href: '/admin/online-store/pages/page-1',
      },
    ],
  }),
  file({ id: 'file-packet', name: 'Sponsor Packet', extension: 'pdf', sizeBytes: 1_350_000 }),
];

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'files-admin', email: 'files-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'])
    .catch(() => {});
});

test('lists files with type, size, references and copies a link on hover', async ({
  page,
  browserName,
}) => {
  await mockFilesApi(page, fixtures);
  await page.goto('/admin/content/files');

  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  const rows = page.getByTestId('file-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Hero Image');
  await expect(rows.nth(0)).toContainText('PNG');
  await expect(rows.nth(0)).toContainText('Crowd at the gate');
  await expect(rows.nth(0)).toContainText('1 reference');
  await expect(rows.nth(1)).toContainText('PDF');
  await expect(rows.nth(1)).toContainText('1.29 MB');

  await rows.nth(0).hover();
  await rows.nth(0).getByTestId('copy-link').click();
  await expect(page.getByTestId('toast')).toContainText('Link copied');
  if (browserName === 'chromium') {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toBe(fixtures[0].url);
  }

  await page.getByLabel('Search files').fill('packet');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Sponsor Packet');
});

test('opens the detail page, edits name and alt text through the save bar', async ({ page }) => {
  const { calls } = await mockFilesApi(page, fixtures);
  await page.goto('/admin/content/files');
  await page.getByRole('link', { name: 'Hero Image', exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/content\/files\/file-hero$/);
  await expect(page.getByRole('heading', { name: 'Hero Image' })).toBeVisible();
  await expect(page.getByText('PNG • 2048 × 2048 • 152.5 KB')).toBeVisible();
  await expect(page.getByTestId('used-in')).toContainText('Vendors');
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /download=1$/);
  await expect(page.getByTestId('save-bar')).toHaveCount(0);

  await page.getByLabel('Name').fill('Gate crowd');
  await page.getByLabel('Alt text').fill('People queueing at the gate');
  await expect(page.getByTestId('save-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByTestId('toast')).toContainText('Saved');
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  const patch = calls.find((call) => call.method === 'PATCH');
  expect(patch?.body).toEqual({ name: 'Gate crowd', altText: 'People queueing at the gate' });
  await expect(page.getByRole('heading', { name: 'Gate crowd' })).toBeVisible();
});

test('clicking the image sets the focal point and saves it', async ({ page }) => {
  const { calls } = await mockFilesApi(page, fixtures);
  await page.goto('/admin/content/files/file-hero');
  const picker = page.getByTestId('focal-point-picker');
  await expect(picker).toBeVisible();
  const box = (await picker.boundingBox())!;
  await picker.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast')).toContainText('Saved');
  const patch = calls.find((call) => call.method === 'PATCH');
  expect(patch?.body?.focalX).toBeCloseTo(0.25, 1);
  expect(patch?.body?.focalY).toBeCloseTo(0.75, 1);
});

test('deletes a referenced file after a warning and bulk-deletes from the list', async ({
  page,
}) => {
  const { calls } = await mockFilesApi(page, fixtures);
  await page.goto('/admin/content/files/file-hero');
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Used in 1 place: Vendors');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/admin\/content\/files$/);
  expect(
    calls.some((call) => call.method === 'DELETE' && call.url.includes('/admin/files/file-hero'))
  ).toBe(true);

  await expect(page.getByTestId('file-row')).toHaveCount(1);
  await page.getByLabel('Select all files').check();
  await expect(page.getByTestId('bulk-bar')).toContainText('1 selected');
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('files-empty-state')).toBeVisible();
  // A single selection deletes through DELETE /admin/files/:id; bulk-delete is used for 2+.
  expect(
    calls.some((call) => call.method === 'DELETE' && call.url.includes('/admin/files/file-packet'))
  ).toBe(true);
});

test('uploads files through the dialog', async ({ page }) => {
  const { calls } = await mockFilesApi(page, []);
  await page.goto('/admin/content/files');
  await expect(page.getByTestId('files-empty-state')).toBeVisible();
  await page.getByRole('button', { name: 'Upload files' }).click();
  await page
    .getByTestId('upload-input')
    .setInputFiles({
      name: 'flyer.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e47', 'hex'),
    });
  await page.getByRole('button', { name: 'Upload 1' }).click();
  await expect(page.getByTestId('toast')).toContainText('1 file uploaded');
  await expect(page.getByTestId('file-row')).toHaveCount(1);
  expect(
    calls.some((call) => call.method === 'POST' && /\/admin\/files(\?|$)/.test(call.url))
  ).toBe(true);
});
