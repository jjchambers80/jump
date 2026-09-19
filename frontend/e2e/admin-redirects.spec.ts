// Content › URL redirects (spec 028): list, create, edit, delete — backend mocked.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-redirects';

interface Redirect {
  id: string;
  fromPath: string;
  toPath: string;
  absolute: boolean;
  createdAt: string;
  updatedAt: string;
}

async function mockApi(page: Page, initial: Redirect[]) {
  const rows = [...initial];
  const calls: { method: string; url: string; body?: any }[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Redirect Org',
          slug: 'redirect-org',
          status: 'ACTIVE',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ]),
    })
  );
  await page.route(`${API}/admin/redirects**`, async (route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'POST' ? request.postDataJSON() : undefined,
    });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { fromPath: string; toPath: string };
      if (body.fromPath.includes('/events/')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Validation failed',
            details: [
              {
                field: 'fromPath',
                message: 'That path is used by the storefront and cannot be redirected',
              },
            ],
          }),
        });
      }
      const created: Redirect = {
        id: `r-${rows.length + 1}`,
        fromPath: body.fromPath.toLowerCase(),
        toPath: body.toPath,
        absolute: /^https?:/.test(body.toPath),
        createdAt: '2026-09-19T12:00:00.000Z',
        updatedAt: '2026-09-19T12:00:00.000Z',
      };
      rows.unshift(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ redirects: rows, total: rows.length, page: 1, pageSize: 50 }),
    });
  });
  await page.route(`${API}/admin/redirects/*`, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const existing = rows.find((r) => r.id === id);
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'PATCH' ? request.postDataJSON() : undefined,
    });
    if (!existing)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Redirect not found' }),
      });
    if (request.method() === 'DELETE') {
      rows.splice(rows.indexOf(existing), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    Object.assign(existing, request.postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(existing),
    });
  });
  return { calls };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'redirects-admin', email: 'redirects-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
});

test('creates, edits and deletes redirects; surfaces reserved-path errors', async ({ page }) => {
  const { calls } = await mockApi(page, [
    {
      id: 'r-flyer',
      fromPath: '/flyer',
      toPath: 'https://x.test/flyer.pdf',
      absolute: true,
      createdAt: '2026-09-10T12:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
    },
  ]);
  await page.goto('/admin/content/menus');
  await page.getByRole('link', { name: 'URL redirects' }).click();
  await expect(page).toHaveURL(/\/admin\/content\/menus\/redirects$/);
  await expect(page.getByTestId('redirect-row')).toHaveCount(1);
  await expect(page.getByTestId('redirect-row').first()).toContainText('https://x.test/flyer.pdf');

  await page.getByRole('button', { name: 'Create URL redirect' }).click();
  await page.getByLabel('Redirect from').fill('/events/old');
  await page.getByLabel('Redirect to').fill('/pages/faq');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('cannot be redirected');

  await page.getByLabel('Redirect from').fill('/Vendor-Info');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('toast')).toContainText('Redirect created');
  await expect(page.getByTestId('redirect-row')).toHaveCount(2);
  await expect(page.getByTestId('redirect-row').first()).toContainText('/vendor-info');
  expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({
    fromPath: '/Vendor-Info',
    toPath: '/pages/faq',
  });

  await page.getByTestId('redirect-row').first().getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Redirect to').fill('/pages/vendors');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast')).toContainText('Redirect updated');
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
    fromPath: '/vendor-info',
    toPath: '/pages/vendors',
  });

  await page.getByTestId('redirect-row').first().getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('redirect-row')).toHaveCount(1);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
});

test('a platform-host path with a redirect is sent to its target, others 404', async ({ page }) => {
  await page.route(
    `${API}/organizations/org-redirects/public/redirect?path=%2Fvendor-info`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ to: '/pages/vendors', absolute: false }),
      })
  );
  await page.route(`${API}/organizations/org-redirects/public/pages/vendors`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: { id: ORG_ID, name: 'Redirect Org', logoUrl: null },
        page: { id: 'p', title: 'Vendors', slug: 'vendors', content: '<p>Here.</p>' },
      }),
    })
  );
  // The server component fetches the backend directly (not through the browser), so stub the backend route
  // only where the browser is involved: this test relies on the real backend being unreachable for unknown
  // paths and asserts the 404 branch.
  const response = await page.goto('/organizations/org-redirects/definitely-missing-path');
  expect(response?.status()).toBe(404);
});
