import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-pages';

interface StorePage {
  id: string;
  title: string;
  slug: string;
  content: string;
  isVisible: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

function storePage(overrides: Partial<StorePage> & Pick<StorePage, 'id' | 'title'>): StorePage {
  return {
    slug: overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    content: '<p>Body</p>',
    isVisible: true,
    seoTitle: null,
    seoDescription: null,
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

async function mockPagesApi(page: Page, initial: StorePage[]) {
  const pages = [...initial];
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];

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
      url: request.url(),
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
    const created: StorePage = storePage({
      ...body,
      slug: body.slug || body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      id: `page-${pages.length + 1}`,
    });
    pages.push(created);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });

  // GET / PUT /admin/pages/:id
  await page.route(`${API}/admin/pages/*`, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const existing = pages.find((item) => item.id === id);
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'PUT' ? request.postDataJSON() : undefined,
    });
    if (!existing) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Page not found' }),
      });
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as Partial<StorePage>;
      Object.assign(existing, body, {
        slug: body.slug || existing.slug,
        updatedAt: '2026-09-19T12:00:00.000Z',
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(existing),
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
    storePage({ id: 'page-about', title: 'About us', content: '<p>About our organization</p>' }),
  ]);
  await page.goto('/admin/online-store/pages');

  const table = page.getByRole('table', { name: 'Online store pages' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('About us');
  await expect(table).toContainText('Visible');
  await expect(table.getByRole('link', { name: 'Edit About us' })).toHaveAttribute(
    'href',
    '/admin/online-store/pages/page-about'
  );
  await expect(table.getByRole('link', { name: 'About us', exact: true })).toHaveAttribute(
    'href',
    '/admin/online-store/pages/page-about'
  );
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
  await page.getByLabel('Title', { exact: true }).fill('Refund policy');
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
      slug: '',
      seoTitle: null,
      seoDescription: null,
    })
  );
  expect(String(api.calls.find((call) => call.method === 'POST')?.body?.content)).toContain(
    'Refunds are available within 30 days.'
  );
});

test('top-right action opens the editor when pages already exist', async ({ page }) => {
  await mockPagesApi(page, [
    storePage({ id: 'page-contact', title: 'Contact', content: '<p>Contact us</p>', isVisible: false }),
  ]);
  await page.goto('/admin/online-store/pages');
  await page.getByTestId('pages-header').getByRole('link', { name: 'Create Page' }).click();
  await expect(page).toHaveURL(/\/admin\/online-store\/pages\/new$/);
  await expect(page.getByRole('heading', { name: 'Create page' })).toBeVisible();
});

test('search engine listing previews the derived handle and counts characters', async ({
  page,
}) => {
  const api = await mockPagesApi(page, []);
  await page.goto('/admin/online-store/pages/new');

  const listing = page.getByTestId('search-engine-listing');
  await expect(listing.getByRole('heading', { name: 'Search engine listing' })).toBeVisible();
  await expect(listing).toContainText('0 of 70 characters used');
  await expect(listing).toContainText('0 of 160 characters used');

  await page.getByLabel('Title', { exact: true }).fill('Refund & Returns Policy');
  await expect(page.getByTestId('seo-url')).toHaveText(
    /\/organizations\/org-pages\/pages\/refund-returns-policy$/
  );
  await expect(page.getByTestId('seo-preview')).toContainText('Refund & Returns Policy');

  await listing.getByLabel('Page title').fill('Refunds at Page Test');
  await listing.getByLabel('Meta description').fill('How refunds and returns work.');
  await listing.getByLabel('URL handle').fill('Our Refunds!');
  await listing.getByLabel('URL handle').blur();
  await expect(listing.getByLabel('URL handle')).toHaveValue('our-refunds');
  await expect(page.getByTestId('seo-url')).toHaveText(
    /\/organizations\/org-pages\/pages\/our-refunds$/
  );
  await expect(listing).toContainText('20 of 70 characters used');
  await expect(listing).toContainText('29 of 160 characters used');
  await expect(page.getByTestId('seo-preview')).toContainText('Refunds at Page Test');
  await expect(page.getByTestId('seo-preview')).toContainText('How refunds and returns work.');

  await page.getByLabel('Page content').fill('Refunds are available within 30 days.');
  await page.getByRole('button', { name: 'Create Page' }).click();
  await expect(page).toHaveURL(/\/admin\/online-store\/pages$/);
  expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual(
    expect.objectContaining({
      slug: 'our-refunds',
      seoTitle: 'Refunds at Page Test',
      seoDescription: 'How refunds and returns work.',
    })
  );
});

test('editing a page loads its fields and saves a partial update', async ({ page }) => {
  const api = await mockPagesApi(page, [
    storePage({
      id: 'page-about',
      title: 'About us',
      slug: 'about',
      content: '<p>About <strong>our</strong> organization</p>',
      isVisible: false,
      seoTitle: 'About Page Test',
      seoDescription: 'Who we are.',
    }),
  ]);
  await page.goto('/admin/online-store/pages');
  await page.getByRole('link', { name: 'Edit About us' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store\/pages\/page-about$/);
  await expect(page.getByRole('heading', { name: 'About us', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('About us');
  await expect(page.getByLabel('Page content')).toContainText('About our organization');
  await expect(page.getByLabel('Page content').locator('strong')).toHaveText('our');
  await expect(page.getByRole('checkbox', { name: 'Visible on the online store' })).not.toBeChecked();
  const listing = page.getByTestId('search-engine-listing');
  await expect(listing.getByLabel('Page title')).toHaveValue('About Page Test');
  await expect(listing.getByLabel('Meta description')).toHaveValue('Who we are.');
  await expect(listing.getByLabel('URL handle')).toHaveValue('about');
  await expect(listing).toContainText('15 of 70 characters used');

  await page.getByLabel('Title', { exact: true }).fill('About our league');
  await listing.getByLabel('Meta description').fill('');
  await page.getByRole('checkbox', { name: 'Visible on the online store' }).check();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/admin\/online-store\/pages$/);
  await expect(page.getByRole('table', { name: 'Online store pages' })).toContainText(
    'About our league'
  );
  const put = api.calls.find((call) => call.method === 'PUT');
  expect(put?.url).toContain('/admin/pages/page-about');
  expect(put?.body).toEqual(
    expect.objectContaining({
      title: 'About our league',
      isVisible: true,
      slug: 'about',
      seoTitle: 'About Page Test',
      seoDescription: null,
    })
  );
  expect(String(put?.body?.content)).toContain('<strong>our</strong>');
});

test('editing a page that does not exist shows the standard alert', async ({ page }) => {
  await mockPagesApi(page, []);
  await page.goto('/admin/online-store/pages/page-missing');

  await expect(page.getByRole('alert').filter({ hasText: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});
