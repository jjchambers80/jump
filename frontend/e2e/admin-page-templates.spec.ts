// Spec 042: developer screen for page templates — SYSTEM_ADMIN uploads a
// JSON manifest to the active organization. Backend mocked.

import { readFileSync } from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-templates';
const CONTACT_FILE = path.join(__dirname, '..', '..', 'templates', 'pages', 'page.contact.json');

async function mockApi(page: Page) {
  const templates: Record<string, unknown>[] = [];
  const posts: unknown[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: ORG_ID, name: 'Template Org', slug: 'template-org', status: 'ACTIVE', createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z' },
      ]),
    })
  );
  await page.route(`${API}/admin/page-templates`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push(body);
      if (body.name === 'broken') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'The template is not valid',
            details: [{ field: 'sections[0].type', message: 'sections[0].type must be one of page_content, rich_text, contact_form' }],
          }),
        });
      }
      const saved = { id: 'tpl-1', name: body.name, label: body.label, description: body.description, sections: body.sections, pageCount: 0, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' };
      templates.push(saved);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(saved) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates }) });
  });
  return { posts };
}

test('SYSTEM_ADMIN uploads the contact template and sees errors for a bad one', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'dev', email: 'dev@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
  const api = await mockApi(page);
  await page.goto('/admin/online-store/page-templates');

  await expect(page.getByRole('heading', { name: 'Page templates', level: 1 })).toBeVisible();
  await expect(page.getByTestId('page-templates-empty')).toBeVisible();

  await page.getByTestId('template-file-input').setInputFiles(CONTACT_FILE);
  await expect(page.getByRole('status')).toContainText('Uploaded “Contact” (contact)');
  const table = page.getByRole('table', { name: 'Page templates' });
  await expect(table).toContainText('Contact');
  await expect(table).toContainText('Page content · Contact form');
  expect(api.posts[0]).toEqual(JSON.parse(readFileSync(CONTACT_FILE, 'utf8')));

  await page.getByTestId('template-file-input').setInputFiles({
    name: 'page.broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, name: 'broken', label: 'Broken', sections: [{ type: 'script' }] })),
  });
  const alert = page.getByRole('alert').filter({ hasText: 'not uploaded' });
  await expect(alert).toContainText('The template was not uploaded');
  await expect(alert).toContainText('sections[0].type');

  await page.getByTestId('template-file-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not json'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'not uploaded' })).toContainText('not valid JSON');
});

test('organization admins cannot manage templates', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  await mockApi(page);
  await page.goto('/admin/online-store/page-templates');
  await expect(page.getByText('Page templates are uploaded by Eventimus developers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload template' })).toHaveCount(0);
});
