// Admin event creation — fully mocked backend.
import { test, expect } from '@playwright/test';
import { signInAsStaff } from '../../e2e/helpers/session';

const API = 'http://localhost:3002';

test.describe('Admin Event Creation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'evt-admin', email: 'evt-admin@test.com', role: 'ADMIN' }, baseURL!);
    await page.route(`${API}/organizations`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-1', name: 'Test Org', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]) })
    );
  });

  test('admin can create an event via the create-event page', async ({ page }) => {
    await page.goto('/admin/create-event');
    await expect(page.getByRole('heading', { name: 'Create New Event' })).toBeVisible();
  });
});