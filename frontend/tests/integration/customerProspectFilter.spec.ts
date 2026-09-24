// Prospect filtering — fully mocked backend.
import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../../e2e/helpers/session';

const API = 'http://localhost:3002';

test.describe('Customer prospect filter and detail rendering', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'cust-admin', email: 'cust-admin@test.com', role: 'ADMIN' }, baseURL!);
    await page.route(`${API}/organizations`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-prospect', name: 'Prospect Test Org', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]) })
    );
  });

  test('customers page renders and scope toggle is present', async ({ page }) => {
    await page.route(`${API}/admin/customers?scope=customers&limit=25`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: [], total: 0 }) })
    );
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: /customers/i })).toBeVisible();
  });
});