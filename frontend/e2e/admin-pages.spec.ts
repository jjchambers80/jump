import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-pages';

interface StorePage {
  id: string;
  title: string;
  content: string;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

async function mockPagesApi(page: Page, initial: StorePage[]) {
  const pages = [...initial];
  const calls: { method: string; body?: Record<string, unknown> }[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Page Test Organization',
          slug: 'page-test',
          status: 'ACTIVE',
          createdAt: '2026-09-18T12:00:00.000Z',
          updatedAt: '2026-09-18T12:00:00.000Z',
        },
      ]),
    })
  );

  await page.route(`${API}/admin/pages`, async (route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      body: request.method() === 'POST' ? request.postDataJSON() : undefined,
    });

    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages }),
      });
    }

    const body = request.postDataJSON() as Omit<StorePage, 'id' | 'createdAt' | 'updatedAt'>;
    const created: StorePage = {
      ...body,
      id: `page-${pages.length + 1}`,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z',
    };
    pages.push(created);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });

  return { calls, pages };
}

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  if (testInfo.title.includes('unauthenticated')) return;
  await signInAsStaff(
    page,
    { id: 'pages-admin', email: 'pages-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
});

test('unauthenticated users are redirected away from Pages', async ({ page }) => {
  await page.goto('/admin/online-store/pages');

  await expect(page).toHaveURL(/\/auth\/signin/);
  expect(page.url()).toContain('callbackUrl');
});

test('list failures use the standard alert and retry treatment', async ({ page }) => {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Page Test Organization',
          slug: 'page-test',
          status: 'ACTIVE',
          createdAt: '2026-09-18T12:00:00.000Z',
          updatedAt: '2026-09-18T12:00:00.000Z',
        },
      ]),
    })
  );
  await page.route(`${API}/admin/pages`, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unable to load pages.' }),
    })
  );

  await page.goto('/admin/online-store/pages');

  const alert = page.getByRole('alert').filter({ hasText: 'Unable to load pages.' });
  await expect(alert).toContainText('Unable to load pages.');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByTestId('pages-empty-state')).toHaveCount(0);
});

test('Pages submenu opens a centered empty state and creation action', async ({ page }) => {
  await mockPagesApi(page, []);
  await page.goto('/admin/online-store');

  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Pages' })).toBeVisible();
  await sidebar.getByRole('link', { name: 'Pages' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store\/pages$/);
  await expect(sidebar.getByRole('link', { name: 'Pages' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  const emptyState = page.getByTestId('pages-empty-state');
  await expect(emptyState).toContainText('No pages have been created');
  await expect(emptyState.getByRole('link', { name: 'Create Page' })).toBeVisible();
  await expect(page.getByTestId('pages-header')).not.toContainText('Create Page');
});

test('populated list renders a table and top-right Create Page action', async ({ page }) => {
  await mockPagesApi(page, [
    {
      id: 'page-about',
      title: 'About us',
      content: '<p>About our organization</p>',
      isVisible: true,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z',
    },
  ]);
  await page.goto('/admin/online-store/pages');

  const table = page.getByRole('table', { name: 'Online store pages' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('About us');
  await expect(table).toContainText('Visible');
  await expect(
    page.getByTestId('pages-header').getByRole('link', { name: 'Create Page' })
  ).toBeVisible();
  await expect(page.getByTestId('pages-empty-state')).toHaveCount(0);
});

test('empty-state action opens the editor and creates a visible page', async ({ page }) => {
  const api = await mockPagesApi(page, []);
  await page.goto('/admin/online-store/pages');
  await page.getByTestId('pages-empty-state').getByRole('link', { name: 'Create Page' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store\/pages\/new$/);
  await page.getByLabel('Title').fill('Refund policy');
  await page.getByLabel('Page content').fill('Refunds are available within 30 days.');
  await page.getByRole('checkbox', { name: 'Visible on the online store' }).check();
  await page.getByRole('button', { name: 'Create Page' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store\/pages$/);
  await expect(page.getByRole('table', { name: 'Online store pages' })).toContainText(
    'Refund policy'
  );
  expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual(
    expect.objectContaining({
      title: 'Refund policy',
      isVisible: true,
    })
  );
  expect(String(api.calls.find((call) => call.method === 'POST')?.body?.content)).toContain(
    'Refunds are available within 30 days.'
  );
});

test('top-right action opens the editor when pages already exist', async ({ page }) => {
  await mockPagesApi(page, [
    {
      id: 'page-contact',
      title: 'Contact',
      content: '<p>Contact us</p>',
      isVisible: false,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z',
    },
  ]);
  await page.goto('/admin/online-store/pages');
  await page.getByTestId('pages-header').getByRole('link', { name: 'Create Page' }).click();
  await expect(page).toHaveURL(/\/admin\/online-store\/pages\/new$/);
  await expect(page.getByRole('heading', { name: 'Create page' })).toBeVisible();
});
