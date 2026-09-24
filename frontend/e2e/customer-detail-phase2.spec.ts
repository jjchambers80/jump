import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff, type StaffUser } from './helpers/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-customer-detail-2';
const CUSTOMER_ID = 'customer-detail-2';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const baseCustomer = {
  id: CUSTOMER_ID,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  location: null,
  note: null,
  emailSubscribed: true,
  emailSubscribedAt: null,
  emailSubscribedSource: null,
  emailUnsubscribedAt: null,
  accountCreatedAt: null,
  lastSignInAt: null,
  accountUrl: null,
  tags: [],
  createdAt: '2025-01-01T12:00:00.000Z',
  transactionCount: 1,
  ticketOrderCount: 1,
  applicationCount: 0,
  totalSpent: 42,
  totalRefunded: 0,
  rsvps: [],
  lastActivityAt: '2026-09-10T12:00:00.000Z',
  segment: 'Repeat',
  prevId: 'customer-prev',
  nextId: 'customer-next',
  orders: [],
  applications: [],
  upcomingTickets: [
    { id: 'ticket-1', ticketNumber: 1, priceTierName: 'Weekend', status: 'VALID', redeemedAt: null, event: { id: 'event-a', name: 'Autumn Expo', date: '2099-10-01T16:00:00.000Z' } },
    { id: 'ticket-2', ticketNumber: 2, priceTierName: 'Weekend', status: 'REDEEMED', redeemedAt: '2099-09-30T17:00:00.000Z', event: { id: 'event-a', name: 'Autumn Expo', date: '2099-10-01T16:00:00.000Z' } },
    { id: 'ticket-3', ticketNumber: 1, priceTierName: 'General admission', status: 'VOIDED', redeemedAt: null, event: { id: 'event-b', name: 'Winter Fair', date: '2099-12-05T18:00:00.000Z' } },
  ],
};

type CustomerFixture = Omit<typeof baseCustomer, 'prevId' | 'nextId'> & {
  prevId: string | null;
  nextId: string | null;
};

async function mockOrganizations(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: ORG_ID, name: 'Detail Org', status: 'ACTIVE' }]),
    })
  );
}

async function mockCustomerDetail(page: Page, customer: CustomerFixture) {
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}**`, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) });
    }
    return route.fulfill({ status: 405, body: 'Method Not Allowed' });
  });
}

async function mockTimeline(page: Page, timeline: unknown) {
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}/timeline**`, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timeline) });
    }
    return route.fulfill({ status: 405, body: 'Method Not Allowed' });
  });
}

async function setup(page: Page, baseURL: string, user: StaffUser, timeline: unknown, customer: CustomerFixture = baseCustomer) {
  await signInAsStaff(page, user, baseURL);
  await mockOrganizations(page);
  await mockCustomerDetail(page, customer);
  await mockTimeline(page, timeline);
}

test('renders newest-first timeline, segment, grouped upcoming tickets, and stable navigation links', async ({ page, baseURL }) => {
  await setup(page, baseURL!, { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' }, {
    items: [
      { id: 'event-new', kind: 'EVENT', type: 'ORDER_PAID', text: 'Order #JMP-9 was paid', createdAt: '2026-09-12T12:00:00.000Z' },
      { id: 'comment-1', kind: 'COMMENT', body: 'Customer requested aisle seating.', createdAt: '2026-09-11T12:00:00.000Z', author: { id: 'staff-2', name: 'Sam Staff', email: 'sam@test.com' } },
      { id: 'event-old', kind: 'EVENT', type: 'ACCOUNT_CREATED', text: 'Customer account created', createdAt: '2026-09-10T12:00:00.000Z' },
    ],
    nextCursor: null,
  });

  await page.goto(`/admin/customers/${CUSTOMER_ID}?search=ada&sort=spent&direction=desc&segment=Repeat`);

  await expect(page.getByTestId('customer-segment')).toHaveText('Repeat');
  const timeline = page.getByTestId('customer-timeline');
  await expect(timeline).toContainText('Order #JMP-9 was paid');
  await expect(timeline).toContainText('Customer requested aisle seating.');
  await expect(timeline).toContainText('Sam Staff');
  await expect(timeline.locator('[data-timeline-item]')).toHaveCount(3);
  await expect(timeline.locator('[data-timeline-item]').nth(0)).toContainText('Order #JMP-9 was paid');
  await expect(timeline.locator('[data-timeline-item]').nth(2)).toContainText('Customer account created');

  const tickets = page.getByTestId('upcoming-tickets');
  await expect(tickets.getByRole('link', { name: /Autumn Expo/ })).toHaveCount(1);
  await expect(tickets).toContainText('2 tickets');
  await expect(tickets).toContainText('1 active');
  await expect(tickets).toContainText('1 checked in');
  await expect(tickets).toContainText('1 voided');
  await expect(tickets).toContainText('Checked in Sep 30, 2099');

  await expect(page.getByRole('link', { name: 'Previous customer' })).toHaveAttribute('href', '/admin/customers/customer-prev?search=ada&sort=spent&direction=desc&segment=Repeat');
  await expect(page.getByRole('link', { name: 'Next customer' })).toHaveAttribute('href', '/admin/customers/customer-next?search=ada&sort=spent&direction=desc&segment=Repeat');
  await expect(page.locator('a[href*="search=ada"]', { hasText: 'Customers' })).toHaveAttribute('href', '/admin/customers?search=ada&sort=spent&direction=desc&segment=Repeat');
});

test('renders disabled previous and next controls at navigation boundaries', async ({ page, baseURL }) => {
  await setup(
    page,
    baseURL!,
    { id: 'admin-boundary', email: 'admin-boundary@test.com', role: 'ADMIN' },
    { items: [], nextCursor: null },
    { ...baseCustomer, prevId: null, nextId: null }
  );

  await page.goto(`/admin/customers/${CUSTOMER_ID}?segment=Repeat&sort=name&direction=asc`);

  const navigation = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(navigation.getByText('Previous', { exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(navigation.getByText('Next', { exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(navigation.getByRole('link', { name: 'Previous customer' })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Next customer' })).toHaveCount(0);
});

test('creates a plain-text comment and allows its author to delete it', async ({ page, baseURL }) => {
  const user = { id: 'author-1', email: 'author@test.com', name: 'Alex Author', role: 'ORGANIZER' as const };
  await setup(page, baseURL!, user, { items: [], nextCursor: null });

  let postedBody: unknown;
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}/comments`, async (route) => {
    postedBody = route.request().postDataJSON();
    await route.fulfill(json({ id: 'comment-new', kind: 'COMMENT', body: 'Called customer about pickup.', createdAt: '2026-09-20T12:00:00.000Z', author: { id: user.id, name: user.name, email: user.email } }, 201));
  });
  let deleted = false;
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}/comments/comment-new`, async (route) => {
    deleted = true;
    await route.fulfill({ status: 204 });
  });

  await page.goto(`/admin/customers/${CUSTOMER_ID}`);
  const submit = page.getByRole('button', { name: 'Add comment' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Add a comment').fill('Called customer about pickup.');
  await submit.click();
  await expect.poll(() => postedBody).toEqual({ body: 'Called customer about pickup.' });
  await expect(page.getByTestId('customer-timeline')).toContainText('Called customer about pickup.');
  await page.getByRole('button', { name: 'Delete comment' }).click();
  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByTestId('customer-timeline')).toContainText('No activity yet.');
});

test('shows comment errors, hides unauthorized delete, and loads the next cursor page', async ({ page, baseURL }) => {
  const user = { id: 'organizer-1', email: 'organizer@test.com', role: 'ORGANIZER' as const };
  let timelineCalls = 0;
  await setup(page, baseURL!, user, { items: [], nextCursor: null }, { ...baseCustomer, upcomingTickets: [] });
  await page.unroute(`${API}/admin/customers/${CUSTOMER_ID}/timeline**`);
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}/timeline**`, (route) => {
    timelineCalls += 1;
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === 'cursor-2') {
      return route.fulfill(json({ items: [{ id: 'event-older', kind: 'EVENT', text: 'Marketing unsubscribed', createdAt: '2026-09-01T12:00:00.000Z' }], nextCursor: null }));
    }
    return route.fulfill(json({ items: [{ id: 'comment-other', kind: 'COMMENT', body: 'Private note', createdAt: '2026-09-10T12:00:00.000Z', author: { id: 'someone-else', name: 'Other Staff', email: 'other@test.com' } }], nextCursor: 'cursor-2' }));
  });
  await page.route(`${API}/admin/customers/${CUSTOMER_ID}/comments`, (route) => route.fulfill(json({ message: 'Comment could not be saved' }, 500)));

  await page.goto(`/admin/customers/${CUSTOMER_ID}`);
  await expect(page.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);
  await page.getByLabel('Add a comment').fill('This save will fail');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByTestId('customer-timeline').getByRole('alert')).toContainText('Comment could not be saved');
  await expect(page.getByLabel('Add a comment')).toHaveValue('This save will fail');

  await page.getByRole('button', { name: 'Load older activity' }).click();
  await expect.poll(() => timelineCalls).toBe(2);
  const timeline = page.getByTestId('customer-timeline');
  await expect(timeline.locator('[data-timeline-item]')).toHaveCount(2);
  await expect(timeline.locator('[data-timeline-item]').nth(1)).toContainText('Marketing unsubscribed');
  await expect(page.getByRole('button', { name: 'Load older activity' })).toHaveCount(0);
  await expect(page.getByTestId('upcoming-tickets')).toContainText('No upcoming tickets.');
});
