import { expect, test } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 044C: Customers is the one contact list; Source narrows it by how a contact came in.
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-customer-source';
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const vendor = {
  id: 'contact-vendor',
  firstName: 'Vera',
  lastName: 'Vendor',
  email: 'vera@example.com',
  phone: null,
  location: null,
  note: null,
  emailSubscribed: true,
  tags: [],
  sources: ['subscribed'],
  formSources: [{ id: 'form-vendor', name: 'Become a vendor' }],
  transactionCount: 0,
  ticketOrderCount: 0,
  applicationCount: 0,
  totalSpent: 0,
  totalRefunded: 0,
  lastActivityAt: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  segment: 'Prospect',
};

test('Submitted a form switches to all contacts, narrows by form and shows the form chip', async ({ page, baseURL }) => {
  const listRequests: URL[] = [];
  await signInAsStaff(page, { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Source Org', status: 'ACTIVE' }]))
  );
  await page.route(`${API}/admin/standing-application-forms`, (route) =>
    route.fulfill(json({ data: [{ id: 'form-vendor', name: 'Become a vendor' }, { id: 'form-press', name: 'Press' }] }))
  );
  await page.route(`${API}/admin/customers?*`, (route) => {
    const url = new URL(route.request().url());
    listRequests.push(url);
    const rows = url.searchParams.get('source') === 'form' ? [vendor] : [];
    route.fulfill(json({ data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: rows.length ? 1 : 0 } }));
  });

  await page.goto('/admin/customers');
  await expect(page.getByTestId('customer-scope-customers')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Source').selectOption('form');
  await expect(page.getByTestId('customer-scope-all')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => listRequests.some((u) => u.searchParams.get('source') === 'form' && u.searchParams.get('scope') === 'all')).toBe(true);
  await expect(page.locator('li', { hasText: 'Form: Become a vendor' }).locator('visible=true').first()).toBeVisible();

  await expect(page).toHaveURL(/source=form/);
  await page.getByLabel('Form', { exact: true }).selectOption('form-vendor');
  await expect.poll(() => listRequests.some((u) => u.searchParams.get('formId') === 'form-vendor')).toBe(true);
  await expect(page).toHaveURL(/source=form/);
  await expect(page).toHaveURL(/formId=form-vendor/);
});
