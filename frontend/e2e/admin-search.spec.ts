import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-search';

const response = {
  query: 'summer',
  total: 4,
  data: [
    {
      type: 'EVENT',
      id: 'event-1',
      title: 'Summer Festival',
      subtitle: 'Jun 21, 2026 · Civic Hall',
      href: '/admin/events/event-1/edit?orgId=org-search',
      meta: { status: 'PUBLISHED' },
    },
    {
      type: 'CUSTOMER',
      id: 'contact-1',
      title: 'Summer Jones',
      subtitle: 'summer@example.com',
      href: '/admin/customers/contact-1',
      meta: { email: 'summer@example.com' },
    },
    {
      type: 'ORDER',
      id: 'order-1',
      title: 'ORD-SUMMER',
      subtitle: 'TICKET · PAID',
      href: '/admin/orders/order-1',
      meta: { kind: 'TICKET', status: 'PAID' },
    },
    {
      type: 'TICKET',
      id: 'ticket-1',
      title: 'TKT-SUMMER',
      subtitle: 'Summer Festival · VALID',
      href: '/admin/orders?view=tickets&search=summer',
      meta: { eventId: 'event-1', status: 'VALID' },
    },
  ],
};

async function mockOrganizations(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Search Test Organization',
          slug: 'search-test',
          status: 'ACTIVE',
          createdAt: '2026-09-19T12:00:00.000Z',
          updatedAt: '2026-09-19T12:00:00.000Z',
        },
      ]),
    })
  );
}

async function openAdmin(page: Page) {
  await mockOrganizations(page);
  await page.route(`${API}/admin/dashboard*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('combobox', { name: 'Search administration' })).toBeVisible();
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'search-admin', email: 'search-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
});

test('submits a query, groups results, and navigates when a result is selected', async ({ page }) => {
  const calls: string[] = [];
  await page.route(`${API}/admin/search*`, async (route) => {
    calls.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fulfillJson(route, response);
  });
  await openAdmin(page);

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('summer');
  await search.press('Enter');

  await expect(page.getByText('Searching…')).toBeVisible();
  const results = page.getByRole('listbox', { name: 'Administration search results' });
  await expect(results.getByRole('option', { name: /^Summer Festival/ })).toBeVisible();
  await expect(results.getByText('Events', { exact: true })).toBeVisible();
  await expect(results.getByText('Customers', { exact: true })).toBeVisible();
  await expect.poll(() => calls).toEqual(['summer']);
  await expect(page.getByRole('option', { name: /View all events/i })).toHaveAttribute(
    'href',
    '/admin/events'
  );
  await expect(page.getByRole('option', { name: /View all customers/i })).toHaveAttribute(
    'href',
    '/admin/customers'
  );
  await expect(page.getByRole('option', { name: /View all tickets/i })).toHaveAttribute(
    'href',
    '/admin/orders'
  );

  await page.getByRole('option', { name: /^Summer Festival/ }).click();
  await expect(page).toHaveURL(/\/admin\/events\/event-1\/edit\?orgId=org-search$/);
});

test('supports Arrow keys, Enter, and Escape', async ({ page }) => {
  await page.route(`${API}/admin/search*`, (route) => fulfillJson(route, response));
  await openAdmin(page);

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('summer');
  await expect(page.getByRole('option', { name: /^Summer Festival/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('ArrowDown');
  await search.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Summer Jones/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');

  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/admin\/events\/event-1\/edit\?orgId=org-search$/);
});

test('discards stale results when the query changes', async ({ page }) => {
  await page.route(`${API}/admin/search*`, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'su') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fulfillJson(route, {
        query,
        total: 1,
        data: [{ ...response.data[0], id: 'stale', title: 'Stale result' }],
      });
    }
    return fulfillJson(route, response);
  });
  await openAdmin(page);

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('su');
  await page.waitForTimeout(275);
  await search.fill('summer');

  await expect(page.getByRole('option', { name: /^Summer Festival/ })).toBeVisible();
  await expect(page.getByText('Stale result')).toHaveCount(0);
});

test('waits for initial organization selection before searching', async ({ page }) => {
  const searchOrgHeaders: Array<string | undefined> = [];
  await page.route(`${API}/organizations`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Search Test Organization',
          slug: 'search-test',
          status: 'ACTIVE',
          createdAt: '2026-09-19T12:00:00.000Z',
          updatedAt: '2026-09-19T12:00:00.000Z',
        },
      ]),
    });
  });
  await page.route(`${API}/admin/search*`, (route) => {
    searchOrgHeaders.push(route.request().headers()['x-jump-org']);
    return fulfillJson(route, response);
  });
  await page.goto('/admin/dashboard');

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('summer');
  await page.waitForTimeout(300);
  expect(searchOrgHeaders).toEqual([]);
  await expect(page.getByRole('option', { name: /^Summer Festival/ })).toBeVisible();
  expect(searchOrgHeaders).toEqual([ORG_ID]);
});

test('shows validation guidance and a no-results state without sending short queries', async ({ page }) => {
  let calls = 0;
  await page.route(`${API}/admin/search*`, (route) => {
    calls += 1;
    return fulfillJson(route, { query: 'zz', total: 0, data: [] });
  });
  await openAdmin(page);

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('z');
  await expect(page.getByText('Type at least 2 characters')).toBeVisible();
  await page.waitForTimeout(350);
  expect(calls).toBe(0);

  await search.fill('zz');
  await expect(page.getByText('No results for “zz”')).toBeVisible();
  await expect(page.getByText(/name, email, order number, or barcode/i)).toBeVisible();
});

test('shows a request error and retries the current query', async ({ page }) => {
  let calls = 0;
  await page.route(`${API}/admin/search*`, async (route) => {
    calls += 1;
    if (calls === 1) {
      return fulfillJson(route, { message: 'Search is temporarily unavailable.' }, 500);
    }
    return fulfillJson(route, response);
  });
  await openAdmin(page);

  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('summer');
  const alert = page.getByRole('alert').filter({ hasText: 'Search is temporarily unavailable.' });
  await expect(alert).toContainText('Search is temporarily unavailable.');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('option', { name: /^Summer Festival/ })).toBeVisible();
  expect(calls).toBe(2);
});

test('uses a collapsed search control on mobile without hiding header navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(`${API}/admin/search*`, (route) => fulfillJson(route, response));
  await mockOrganizations(page);
  await page.goto('/admin/dashboard');

  await expect(page.getByLabel('Open sidebar')).toBeVisible();
  await expect(page.getByLabel('Open administration search')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search administration' })).toBeHidden();

  await page.getByLabel('Open administration search').click();
  const mobileSearch = page.getByRole('combobox', { name: 'Search administration' });
  await expect(mobileSearch).toBeVisible();
  await expect(page.getByTestId('org-switcher-trigger')).toBeVisible();

  await mobileSearch.press('Escape');
  await expect(page.getByLabel('Open administration search')).toBeFocused();
  await expect(mobileSearch).toBeHidden();

  await page.getByLabel('Open administration search').click();
  await page.getByLabel('Close administration search').click();
  await expect(mobileSearch).toBeHidden();
});

test('navigates from a TICKET search result to Orders with tickets view and search pre-filled', async ({ page }) => {
  // Mock the tickets API endpoint that TicketRowsView calls
  await page.route(`${API}/admin/tickets*`, async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') || '';
    await fulfillJson(route, {
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });
  await mockOrganizations(page);
  await page.route(`${API}/admin/dashboard*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.route(`${API}/admin/search*`, (route) => fulfillJson(route, response));
  await page.goto('/admin/dashboard');

  // Submit a query
  const search = page.getByRole('combobox', { name: 'Search administration' });
  await search.fill('summer');
  await search.press('Enter');

  // Click the TICKET result
  await page.getByRole('option', { name: /^TKT-SUMMER/ }).click();

  // Should land on /admin/orders with the ticket view and search params
  await expect(page).toHaveURL(/\/admin\/orders\?view=tickets&search=summer/);

  // The Tickets tab should be selected
  await expect(page.getByRole('tab', { name: 'Tickets' })).toHaveAttribute('aria-selected', 'true');

  // The search input should be pre-filled
  await expect(page.getByPlaceholder(/name, email/)).toHaveValue('summer');

  // The Orders page layout should still be visible
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'View' })).toBeVisible();
});

test('navigates to Orders with view=orders from URL param and shows order list', async ({ page }) => {
  await mockOrganizations(page);
  await page.route(`${API}/admin/dashboard*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.goto('/admin/orders?view=orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true');
});
