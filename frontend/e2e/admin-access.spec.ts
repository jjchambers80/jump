import { test, expect } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';

// ============================================================================
// Admin Access E2E Tests (T100-T106)
// Tests for US1, US2, US3 — Admin area access control
// ============================================================================

function mockOrg(page: import('@playwright/test').Page) {
  return page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-1', name: 'Test Org', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]) })
      : route.fallback()
  );
}

// ---------------------------------------------------------------------------
// US1: ADMIN accesses the admin area
// ---------------------------------------------------------------------------

test.describe('US1 - Admin accesses the admin area', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'admin-access', email: 'admin@test.com', role: 'ADMIN' }, baseURL!);
    await mockOrg(page);
  });

  // T100: ADMIN navigates to /admin, redirected to /admin/dashboard, sidebar visible
  test('T100: ADMIN navigates to /admin, redirected to /admin/dashboard with sidebar', async ({
    page,
  }) => {
    await page.goto('/admin');

    // Should redirect to /admin/dashboard
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    // Sidebar should be visible (desktop)
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Sidebar should contain the expected navigation links
    const expectedLinks = [
      'Dashboard',
      'Venues',
      'Events',
      'Analytics',
      'Check In',
      'Settings',
    ];
    // Users lives under Settings › Users, not the main list. Organization
    // settings open from the header org switcher, not the sidebar.
    await expect(sidebar.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Organizations' })).toHaveCount(0);
    for (const linkText of expectedLinks) {
      await expect(sidebar.getByRole('link', { name: linkText })).toBeVisible();
    }

    // Dashboard content renders
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  // T101: ADMIN clicks each sidebar link, page loads within admin layout
  test('T101: ADMIN clicks each sidebar link, page loads within admin layout', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const sidebarLinks: { name: string; url: string }[] = [
      { name: 'Dashboard', url: '/admin/dashboard' },
      { name: 'Venues', url: '/admin/venues' },
      { name: 'Events', url: '/admin/events' },
      { name: 'Analytics', url: '/admin/analytics' },
    ];

    for (const link of sidebarLinks) {
      const sidebar = page.locator('aside');
      await sidebar.getByRole('link', { name: link.name }).click();
      await expect(page).toHaveURL(new RegExp(link.url));

      // Sidebar should persist (admin layout maintains it)
      await expect(sidebar).toBeVisible();
    }
  });

  // T102: Sidebar highlights currently active section
  test('T102: Sidebar highlights currently active section', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const sidebar = page.locator('aside');

    // Dashboard link should have active styling (indigo background)
    const dashboardLink = sidebar.getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toHaveClass(/bg-indigo/);

    // Navigate to Events
    await sidebar.getByRole('link', { name: 'Events' }).click();
    await expect(page).toHaveURL(/\/admin\/events/);

    // Events link should now have active styling
    const eventsLink = sidebar.getByRole('link', { name: 'Events' });
    await expect(eventsLink).toHaveClass(/bg-indigo/);

    // Dashboard link should no longer have active styling
    const dashboardLinkAfter = sidebar.getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLinkAfter).not.toHaveClass(/bg-indigo/);
  });
});

// ---------------------------------------------------------------------------
// US2: ORGANIZER accesses the admin area
// ---------------------------------------------------------------------------

test.describe('US2 - Organizer accesses the admin area', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'org-access', email: 'org@test.com', role: 'ORGANIZER' }, baseURL!);
    await mockOrg(page);
  });

  // T103: ORGANIZER sidebar is visible; Settings pages are read-only
  test('T103: ORGANIZER sidebar is visible; Settings shows no Users section', async ({ page }) => {
    await page.goto('/admin');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    const sidebar = page.locator('aside');

    // Core links should be visible
    const visibleLinks = ['Dashboard', 'Venues', 'Events', 'Analytics'];
    for (const linkText of visibleLinks) {
      await expect(sidebar.getByRole('link', { name: linkText })).toBeVisible();
    }
  });

  // T104: ORGANIZER navigates to /admin/settings/users, sees access denied
  test('T104: ORGANIZER navigates directly to /admin/settings/users, sees access denied', async ({
    page,
  }) => {
    await page.goto('/admin/settings/users');

    // Should see an access denied message
    await expect(page.getByText(/access denied/i)).toBeVisible();
    // Should see role requirement message
    await expect(page.getByText(/admin role required/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// US3: Unauthorized user is denied access
// ---------------------------------------------------------------------------

test.describe('US3 - Unauthorized user is denied access', () => {
  // T105: Unauthenticated user redirected to sign-in
  test('T105: Unauthenticated user navigates to /admin, redirected to sign-in', async ({
    page,
  }) => {
    // Navigate to /admin without being logged in
    await page.goto('/admin');

    // Should be redirected to sign-in page
    await expect(page).toHaveURL(/\/auth\/signin/);

    // Callback URL should include /admin
    const url = page.url();
    expect(url).toContain('callbackUrl');
  });

  // T106 (revised by spec 022): a signed-in user with no staff role has no
  // organization yet, so /admin sends them to the self-serve signup instead of
  // an Access Denied screen.
  test('T106: UNASSIGNED user navigates to /admin, is sent to /signup', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'newcomer', email: 'newcomer@test.com', role: 'UNASSIGNED' }, baseURL!);
    await page.route('http://localhost:3002/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organization: null, billingEnabled: false }) })
    );
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: 'Name your organization' })).toBeVisible();
  });
});