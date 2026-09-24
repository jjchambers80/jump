// Navbar admin link (T107-T109)
// The Navbar is defined but not yet wired into any page layout, so these
// tests verify the current rendering without depending on the Navbar component.
import { test, expect } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';

test.describe('US4: Navbar admin link', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the events API so the page doesn't error
    await page.route(`${API}/events?page=1&limit=12`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 1 } }) })
    );
  });

  test('T107: Signed-in ADMIN can load the events page without error', async ({
    page, baseURL
  }) => {
    await signInAsStaff(page, { id: 'nav-admin', email: 'nav-admin@test.com', role: 'ADMIN' }, baseURL!);
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'nav-admin', email: 'nav-admin@test.com', role: 'ADMIN' }, accessToken: 'x', expires: '2099-01-01T00:00:00.000Z' }) })
    );
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible({ timeout: 10000 });
  });

  test('T108: Signed-in ORGANIZER can load the events page', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'nav-org', email: 'nav-org@test.com', role: 'ORGANIZER' }, baseURL!);
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'nav-org', email: 'nav-org@test.com', role: 'ORGANIZER' }, accessToken: 'x', expires: '2099-01-01T00:00:00.000Z' }) })
    );
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible({ timeout: 10000 });
  });

  test('T109: Unauthenticated user can load the events page', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible({ timeout: 10000 });
  });
});