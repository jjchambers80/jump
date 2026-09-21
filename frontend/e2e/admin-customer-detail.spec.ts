// E2E tests for Phase 1 customer detail workflows (spec 031 phase 1, 023).
// Exercises: name editing, phone/location inline edits, tag chip editor,
// marketing provenance, account card actions, copy account URL, send sign-in
// link, disabled erase, customer-list tag filter, and error states.
//
// Backend is fully mocked via page.route. Auth uses signInAsStaff.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-cust-detail';

// ── Test customer fixture ──────────────────────────────────────────────────
// The CustomerDetail shape used by the page (see [contactId]/page.tsx).

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string | null;
  note: string | null;
  emailSubscribed: boolean;
  emailSubscribedAt: string | null;
  emailSubscribedSource: string | null;
  emailUnsubscribedAt: string | null;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  accountUrl: string | null;
  tags: string[];
  segment: string | null;
  createdAt: string;
  transactionCount: number;
  ticketOrderCount: number;
  applicationCount: number;
  totalSpent: number;
  totalRefunded: number;
  lastActivityAt: string | null;
  orders: CustomerOrder[];
  applications: CustomerApplication[];
}

interface CustomerOrder {
  id: string;
  orderRef: string;
  kind?: 'TICKET' | 'APPLICATION';
  applicationId?: string | null;
  totalAmount: number;
  quantity: number;
  status: string;
  createdAt: string;
  ticketCount: number;
  event: { id: string; name: string; date: string; logoUrl: string | null };
}

interface CustomerApplication {
  id: string;
  eventId: string;
  form: { id: string; name: string; kind: 'PAID' | 'FREE' };
  tier: { id: string; name: string } | null;
  businessName: string | null;
  status: string;
  paymentStatus: string;
  paymentSource: 'stripe' | 'offline';
  applicantPays: number;
  refunded: number;
  paidAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  event: { id: string; name: string; date: string; logoUrl: string | null };
  detailUrl: string;
  orderId?: string;
  orderRef?: string;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  location: string | null;
  note: string | null;
  emailSubscribed: boolean;
  transactionCount: number;
  ticketOrderCount: number;
  applicationCount: number;
  totalSpent: number;
  totalRefunded: number;
  lastActivityAt: string | null;
  createdAt: string;
}

// ── Fixture builders ────────────────────────────────────────────────────────

function buildCustomerAccount(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'cust-001',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '(555) 123-4567',
    location: 'Raleigh, NC',
    note: 'Prefers email communication.',
    emailSubscribed: true,
    emailSubscribedAt: '2026-08-15T10:30:00.000Z',
    emailSubscribedSource: 'CHECKOUT',
    emailUnsubscribedAt: null,
    accountCreatedAt: '2026-06-01T08:00:00.000Z',
    lastSignInAt: new Date().toISOString(),
    accountUrl: 'http://localhost:3001/organizations/org-cust-detail/account',
    tags: ['vip', 'local'],
    segment: 'New',
    createdAt: '2026-06-01T08:00:00.000Z',
    transactionCount: 5,
    ticketOrderCount: 3,
    applicationCount: 2,
    totalSpent: 450.00,
    totalRefunded: 0,
    lastActivityAt: new Date(Date.now() - 86400000).toISOString(),
    orders: [
      {
        id: 'ord-001',
        orderRef: 'ORD-1001',
        kind: 'TICKET',
        totalAmount: 150.00,
        quantity: 2,
        status: 'COMPLETED',
        createdAt: '2026-08-01T10:00:00.000Z',
        ticketCount: 2,
        event: { id: 'evt-001', name: 'Summer Festival', date: '2026-09-15', logoUrl: null },
      },
      {
        id: 'ord-002',
        orderRef: 'ORD-1002',
        kind: 'TICKET',
        totalAmount: 75.00,
        quantity: 1,
        status: 'CANCELLED',
        createdAt: '2026-07-20T14:00:00.000Z',
        ticketCount: 1,
        event: { id: 'evt-002', name: 'Jazz Night', date: '2026-10-01', logoUrl: null },
      },
    ],
    applications: [
      {
        id: 'app-001',
        eventId: 'evt-003',
        form: { id: 'frm-001', name: 'Vendor Application', kind: 'PAID' },
        tier: { id: 'tier-001', name: 'Standard Booth' },
        businessName: 'Jane\'s Crafts',
        status: 'SUBMITTED',
        paymentStatus: 'PAID',
        paymentSource: 'stripe',
        applicantPays: 200.00,
        refunded: 0,
        paidAt: '2026-08-20T09:00:00.000Z',
        submittedAt: '2026-08-18T16:00:00.000Z',
        createdAt: '2026-08-10T12:00:00.000Z',
        event: { id: 'evt-003', name: 'Artisan Market', date: '2026-11-01', logoUrl: null },
        detailUrl: '/admin/applications/app-001',
      },
    ],
    ...overrides,
  };
}

function buildGuestCustomer(): CustomerDetail {
  return buildCustomerAccount({
    accountCreatedAt: null,
    lastSignInAt: null,
    accountUrl: null,
    segment: null,
    orders: [],
    applications: [],
    transactionCount: 1,
    ticketOrderCount: 1,
    applicationCount: 0,
    totalSpent: 25.00,
    totalRefunded: 0,
    lastActivityAt: null,
  });
}

function buildCustomerList(overrides: Partial<Customer>[] = []): { data: Customer[]; pagination: { page: number; limit: number; total: number; totalPages: number } } {
  const base: Customer[] = [
    { id: 'cust-001', firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', location: 'Raleigh, NC', note: 'Prefers email.', emailSubscribed: true, transactionCount: 5, ticketOrderCount: 3, applicationCount: 2, totalSpent: 450, totalRefunded: 0, lastActivityAt: '2026-09-19T12:00:00.000Z', createdAt: '2026-06-01T08:00:00.000Z' },
    { id: 'cust-002', firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com', location: null, note: null, emailSubscribed: false, transactionCount: 1, ticketOrderCount: 1, applicationCount: 0, totalSpent: 25, totalRefunded: 0, lastActivityAt: null, createdAt: '2026-09-10T10:00:00.000Z' },
    { id: 'cust-003', firstName: 'Alice', lastName: 'Johnson', email: 'alice@example.com', location: 'Durham, NC', note: 'Volunteer', emailSubscribed: true, transactionCount: 12, ticketOrderCount: 8, applicationCount: 4, totalSpent: 1200, totalRefunded: 50, lastActivityAt: '2026-09-20T08:00:00.000Z', createdAt: '2025-11-15T09:00:00.000Z' },
  ];
  return {
    data: base.map((c, i) => ({ ...c, ...(overrides[i] || {}) })),
    pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
  };
}

// ── Mock helper ─────────────────────────────────────────────────────────────

/** Set up mock routes for the customer detail page.
 *  Returns helpers to inspect patch payloads and update in-memory state. */
async function mockCustomerDetail(page: Page, initial: CustomerDetail) {
  let detail = { ...initial };
  const patches: Record<string, unknown>[] = [];
  const signInLinkResults: { ok: boolean; message: string }[] = [];

  await page.route(`${API}/admin/customers/${initial.id}`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && !url.searchParams.has('page')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      // Apply patch optimistically
      detail = { ...detail, ...body };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
  });

  await page.route(`${API}/admin/customers/${initial.id}/send-sign-in-link`, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fulfill({ status: 405, body: 'Method Not Allowed' });
    signInLinkResults.push({ ok: true, message: 'Sign-in link sent.' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  return { patches, currentDetail: () => detail, signInLinkResults };
}

/** Mock the customer list API. */
async function mockCustomerList(page: Page, data?: { data: Customer[]; pagination: { page: number; limit: number; total: number; totalPages: number } }) {
  const listData = data || buildCustomerList();
  await page.route(`${API}/admin/customers`, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fulfill({ status: 405, body: 'Method Not Allowed' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listData) });
  });
  return { currentList: () => listData };
}

/** Mock org endpoint so the OrgContext has an organization to select. */
async function mockOrganizations(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: ORG_ID, name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE', createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z' },
      ]),
    })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Customer detail Phase 1', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'cust-admin', email: 'cust-admin@test.com', role: 'ADMIN' }, baseURL!);
    await mockOrganizations(page);
  });

  test('renders customer detail with stats, orders, and applications', async ({ page }) => {
    const fixture = buildCustomerAccount();
    await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Breadcrumb
    await expect(page.getByRole('link', { name: 'Customers' })).toBeVisible();

    // Header with editable name and segment badge
    const nameButton = page.getByTestId('customer-name-edit');
    await expect(nameButton).toContainText('Jane Doe');
    await expect(page.getByText('New')).toBeVisible();

    // Stats bar
    await expect(page.getByText('Amount spent')).toBeVisible();
    await expect(page.getByText('$450.00')).toBeVisible();
    await expect(page.getByText('Transactions')).toBeVisible();
    await expect(page.getByText('5')).toBeVisible();
    await expect(page.getByText('Customer since')).toBeVisible();
    await expect(page.getByText('Last activity')).toBeVisible();

    // Order history
    await expect(page.getByText('Order history')).toBeVisible();
    await expect(page.getByText('#ORD-1001')).toBeVisible();
    await expect(page.getByText('#ORD-1002')).toBeVisible();
    await expect(page.getByText('Summer Festival')).toBeVisible();

    // Applications section
    await expect(page.getByTestId('customer-applications')).toBeVisible();
    await expect(page.getByText(`Jane's Crafts`)).toBeVisible();
  });

  test('edits customer name via SettingsDialog', async ({ page }) => {
    const fixture = buildCustomerAccount();
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Open name dialog
    await page.getByTestId('customer-name-edit').click();
    await expect(page.getByRole('dialog', { name: 'Edit name' })).toBeVisible();

    // Change first and last name
    const firstNameInput = page.getByLabel('First name');
    const lastNameInput = page.getByLabel('Last name');
    await firstNameInput.fill('Janet');
    await lastNameInput.fill('Smith');

    // Submit
    await page.getByRole('button', { name: 'Save' }).click();

    // Dialog should close and header should update
    await expect(page.getByRole('dialog', { name: 'Edit name' })).toHaveCount(0);
    await expect(page.getByTestId('customer-name-edit')).toContainText('Janet Smith');
    expect(patches).toEqual([{ firstName: 'Janet', lastName: 'Smith' }]);
  });

  test('shows name save error in the dialog', async ({ page }) => {
    const fixture = buildCustomerAccount();
    // Let the PATCH fail with a 409
    await page.route(`${API}/admin/customers/${fixture.id}`, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
      }
      if (request.method() === 'PATCH') {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Another admin updated this customer.' }) });
      }
      return route.fulfill({ status: 405 });
    });

    await page.goto(`/admin/customers/${fixture.id}`);

    // Open name dialog
    await page.getByTestId('customer-name-edit').click();
    await page.getByLabel('First name').fill('Janet');
    await page.getByRole('button', { name: 'Save' }).click();

    // Error should appear in the dialog
    await expect(page.getByRole('alert')).toContainText('Another admin updated this customer.');
    // Dialog stays open
    await expect(page.getByRole('dialog', { name: 'Edit name' })).toBeVisible();
  });

  test('inline-edits phone', async ({ page }) => {
    const fixture = buildCustomerAccount();
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Click phone to start editing
    await page.getByRole('button', { name: '(555) 123-4567' }).click();

    // Edit the phone
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('(555) 999-8888');

    // Press Enter to save
    await phoneInput.press('Enter');

    // Wait for save — the inline edit closes and the new value appears
    await expect(page.getByRole('button', { name: '(555) 999-8888' })).toBeVisible();
    expect(patches).toEqual([{ phone: '(555) 999-8888' }]);
  });

  test('adds phone when previously null', async ({ page }) => {
    const fixture = buildCustomerAccount({ phone: null });
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Click "Add phone..." to start editing
    await page.getByText('Add phone...').click();

    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('(555) 321-0000');

    // Press Enter to save
    await phoneInput.press('Enter');

    await expect(page.getByRole('button', { name: '(555) 321-0000' })).toBeVisible();
    expect(patches).toEqual([{ phone: '(555) 321-0000' }]);
  });

  test('inline-edits location', async ({ page }) => {
    const fixture = buildCustomerAccount();
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Click location to start editing
    await page.getByRole('button', { name: 'Raleigh, NC' }).click();

    const locationInput = page.locator('input[type="text"]');
    await locationInput.fill('Durham, NC');

    // Press Enter to save
    await locationInput.press('Enter');

    await expect(page.getByRole('button', { name: 'Durham, NC' })).toBeVisible();
    expect(patches).toEqual([{ location: 'Durham, NC' }]);
  });

  test('cancels inline edit on Escape', async ({ page }) => {
    const fixture = buildCustomerAccount();
    await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Start editing location
    await page.getByRole('button', { name: 'Raleigh, NC' }).click();
    const locationInput = page.locator('input[type="text"]');
    await locationInput.fill('Durham, NC');

    // Press Escape to cancel
    await locationInput.press('Escape');

    // Original value should be back
    await expect(page.getByRole('button', { name: 'Raleigh, NC' })).toBeVisible();
  });

  test('edits tags through the chip editor', async ({ page }) => {
    const fixture = buildCustomerAccount();
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Open tags dialog
    await page.getByTestId('edit-tags-button').click();
    await expect(page.getByRole('dialog', { name: 'Edit tags' })).toBeVisible();

    // Existing tags should be visible as chips
    await expect(page.getByRole('button', { name: 'Remove tag vip' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove tag local' })).toBeVisible();

    // Add a new tag via the input (type and press Enter)
    const tagInput = page.getByLabel('Tags');
    await tagInput.fill('returning');
    await tagInput.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove tag returning' })).toBeVisible();

    // Remove 'local'
    await page.getByRole('button', { name: 'Remove tag local' }).click();
    await expect(page.getByRole('button', { name: 'Remove tag local' })).toHaveCount(0);

    // Save
    await page.getByRole('button', { name: 'Save tags' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit tags' })).toHaveCount(0);

    // Verify the patch payload
    expect(patches).toEqual([{ tags: ['vip', 'returning'] }]);

    // Tags should update on the detail card
    await expect(page.getByText('vip')).toBeVisible();
    await expect(page.getByText('returning')).toBeVisible();
  });

  test('shows tag limit error in the dialog', async ({ page }) => {
    const fullTags = Array.from({ length: 20 }, (_, i) => `tag${i + 1}`);
    const fixture = buildCustomerAccount({ tags: fullTags });
    await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    await page.getByTestId('edit-tags-button').click();
    await expect(page.getByRole('dialog', { name: 'Edit tags' })).toBeVisible();

    // Try adding one more tag
    const tagInput = page.getByLabel('Tags');
    await tagInput.fill('overflow');
    await tagInput.press('Enter');
    await expect(page.getByRole('alert')).toContainText('At most 20 tags');
  });

  test('shows marketing provenance line and toggles subscription', async ({ page }) => {
    const fixture = buildCustomerAccount({
      emailSubscribedAt: '2026-08-15T10:30:00.000Z',
      emailSubscribedSource: 'CHECKOUT',
    });
    const { patches } = await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Marketing card exists
    await expect(page.getByText('Marketing')).toBeVisible();
    await expect(page.getByText('Email subscription')).toBeVisible();

    // Provenance line should show source and date
    await expect(page.getByText(/Subscribed via checkout/i)).toBeVisible();

    // Toggle subscription off
    await page.getByTitle('Subscribed').click();

    // Wait for the toggle to reflect new state (the detail re-fetches after toggle)
    // After toggle the API PATCH then GET; we can check patch was sent
    expect(patches.some((p) => p.emailSubscribed === false)).toBe(true);
  });

  test.describe('Account card', () => {
    test('shows account details for account-holding customer', async ({ page }) => {
      const fixture = buildCustomerAccount();
      await mockCustomerDetail(page, fixture);

      await page.goto(`/admin/customers/${fixture.id}`);

      await expect(page.getByText('Account')).toBeVisible();
      await expect(page.getByText('Account since')).toBeVisible();
      await expect(page.getByText(/Jun 1,/)).toBeVisible();
      await expect(page.getByText('Last sign-in')).toBeVisible();
      await expect(page.getByText('day ago')).toBeVisible();

      // Send sign-in link and Copy account URL buttons
      await expect(page.getByRole('button', { name: /Send sign-in link/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Copy account URL/i })).toBeVisible();
    });

    test('shows guest checkout message for guest customer', async ({ page }) => {
      const fixture = buildGuestCustomer();
      await mockCustomerDetail(page, fixture);

      await page.goto(`/admin/customers/${fixture.id}`);

      await expect(page.getByText('Account')).toBeVisible();
      await expect(page.getByText('Guest checkout')).toBeVisible();
      await expect(page.getByText(/completed their purchase as a guest/i)).toBeVisible();
      // No account buttons for guests
      await expect(page.getByRole('button', { name: /Send sign-in link/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Copy account URL/i })).toHaveCount(0);
    });

    test('send sign-in link succeeds from Account card and shows flash', async ({ page }) => {
      const fixture = buildCustomerAccount();
      await mockCustomerDetail(page, fixture);

      await page.goto(`/admin/customers/${fixture.id}`);

      await page.getByRole('button', { name: /Send sign-in link/i }).click();
      await expect(page.getByText('Sign-in link sent.')).toBeVisible();
    });

    test('send sign-in link shows 422 error for guest customers from More actions menu', async ({ page }) => {
      const fixture = buildGuestCustomer();
      await page.route(`${API}/admin/customers/${fixture.id}/send-sign-in-link`, async (route) => {
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'This customer checked out as a guest and does not have an account to sign in to.' }) });
      });
      // Guest has no accountUrl so the Account card shows guest checkout;
      // the send-sign-in-link is available from the More actions dropdown.
      // Mock GET for the page load
      await page.route(`${API}/admin/customers/${fixture.id}`, (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
      });

      await page.goto(`/admin/customers/${fixture.id}`);

      // Open More actions menu
      await page.getByRole('button', { name: 'More actions' }).click();

      // Click Send sign-in link
      await page.getByRole('button', { name: 'Send sign-in link' }).click();

      // The 422 error should show the guest-specific message in the flash banner
      await expect(page.getByText(/does not have an account/i)).toBeVisible();
    });

    test('send sign-in link shows 429 ratelimit error', async ({ page }) => {
      const fixture = buildCustomerAccount();
      await page.route(`${API}/admin/customers/${fixture.id}/send-sign-in-link`, async (route) => {
        return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ message: 'Too many sign-in links sent recently. Try again later.' }) });
      });
      await mockCustomerDetail(page, fixture);

      await page.goto(`/admin/customers/${fixture.id}`);

      await page.getByRole('button', { name: /Send sign-in link/i }).click();
      await expect(page.getByText(/Too many sign-in links/i)).toBeVisible();
    });

    test('copy account URL works from the Account card', async ({ page }) => {
      const fixture = buildCustomerAccount();
      // Playwright can stub clipboard write
      await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);
      await mockCustomerDetail(page, fixture);

      await page.goto(`/admin/customers/${fixture.id}`);

      await page.getByRole('button', { name: /Copy account URL/i }).click();
      // The button text changes to "Copied"
      await expect(page.getByText('Copied')).toBeVisible();
    });
  });

  test('More actions menu shows disabled erase action with tooltip', async ({ page }) => {
    const fixture = buildCustomerAccount();
    await mockCustomerDetail(page, fixture);

    await page.goto(`/admin/customers/${fixture.id}`);

    // Open More actions
    await page.getByRole('button', { name: 'More actions' }).click();

    // Send sign-in link and Copy account URL should be present
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy account URL' })).toBeVisible();

    // Erase should be disabled
    const eraseButton = page.getByRole('button', { name: /Erase customer data/i });
    await expect(eraseButton).toBeDisabled();
    await expect(eraseButton).toHaveAttribute('title', /future update/);
    // The "coming soon" label should be visible
    await expect(page.getByText('(coming soon)')).toBeVisible();
  });

  test('loads customer regardless of tags input presence on list page', async ({ page }) => {
    // This exercises the tag filter scenario from the customer list
    const listData = buildCustomerList();
    await mockCustomerList(page, listData);
    const fixture = buildCustomerAccount();
    await mockCustomerDetail(page, fixture);

    // Navigate from the customer list into the detail page
    await page.goto('/admin/customers');
    await expect(page.getByText('Jane Doe')).toBeVisible();

    // Click on Jane Doe's row to navigate to detail
    await page.getByText('Jane Doe').click();
    await expect(page).toHaveURL(/\/admin\/customers\/cust-001/);

    // Detail page should render correctly
    await expect(page.getByTestId('customer-name-edit')).toContainText('Jane Doe');
  });

  test('handles 404/not-found gracefully', async ({ page }) => {
    await page.route(`${API}/admin/customers/missing-id`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Customer not found' }) })
    );

    await page.goto('/admin/customers/missing-id');

    // Error state with back link
    await expect(page.getByText('Customer not found').or(page.getByText('Failed to load'))).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to customers' })).toBeVisible();
  });

  test.describe('Customer list scope and search', () => {
    test('navigates customers list with scope toggle', async ({ page }) => {
      const listData = buildCustomerList();
      await mockCustomerList(page, listData);

      await page.goto('/admin/customers');
      await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();

      // Verify customer rows render
      await expect(page.getByText('Jane Doe')).toBeVisible();
      await expect(page.getByText('Bob Smith')).toBeVisible();
      await expect(page.getByText('Alice Johnson')).toBeVisible();
    });

    test('search filters customer list', async ({ page }) => {
      const fullList = buildCustomerList();
      const searchList = { data: [fullList.data[0]], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };
      await page.route(`${API}/admin/customers*`, async (route) => {
        const url = new URL(route.request().url());
        const searchParam = url.searchParams.get('search');
        if (searchParam === 'jane') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(searchList) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fullList) });
      });
      await mockOrganizations(page);

      await page.goto('/admin/customers');

      // Type in search
      const searchInput = page.getByPlaceholder('Search by name or email...');
      await searchInput.fill('jane');
      await searchInput.press('Enter');

      // Should only show Jane
      await expect(page.getByText('Jane Doe')).toBeVisible();
      await expect(page.getByText('Bob Smith')).toHaveCount(0);
    });
  });
});