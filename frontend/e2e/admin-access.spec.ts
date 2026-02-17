import { test, expect } from '@playwright/test';

// ============================================================================
// Admin Access E2E Tests (T100-T106)
// Tests for US1, US2, US3 — Admin area access control
// TDD: These tests MUST be written before implementation
// ============================================================================

// ---------------------------------------------------------------------------
// US1: ADMIN accesses the admin area
// ---------------------------------------------------------------------------

test.describe('US1 - Admin accesses the admin area', () => {
  // T100: ADMIN navigates to /admin, redirected to /admin/dashboard, sidebar visible
  test('T100: ADMIN navigates to /admin, redirected to /admin/dashboard with sidebar', async ({
    page,
  }) => {
    // Log in as ADMIN (assumes test auth setup)
    await page.goto('/auth/signin');
    // TODO: Fill in ADMIN credentials once test auth flow is available
    // For now, test the structure assuming authenticated ADMIN session

    await page.goto('/admin');

    // Should redirect to /admin/dashboard
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    // Sidebar should be visible (desktop)
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Sidebar should contain all expected links
    const expectedLinks = [
      'Dashboard',
      'Organizations',
      'Venues',
      'Events',
      'Analytics',
      'Scan',
      'Users',
    ];
    for (const linkText of expectedLinks) {
      await expect(sidebar.getByRole('link', { name: linkText })).toBeVisible();
    }

    // Create Event quick action should be visible
    await expect(sidebar.getByRole('link', { name: /Create Event/i })).toBeVisible();
  });

  // T101: ADMIN clicks each sidebar link, page loads within admin layout
  test('T101: ADMIN clicks each sidebar link, page loads within admin layout', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const sidebarLinks = [
      { name: 'Dashboard', url: '/admin/dashboard' },
      { name: 'Organizations', url: '/admin/organizations' },
      { name: 'Venues', url: '/admin/venues' },
      { name: 'Events', url: '/admin/events' },
      { name: 'Analytics', url: '/admin/analytics' },
      { name: 'Scan', url: '/admin/scan' },
      { name: 'Users', url: '/admin/users' },
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
  // T103: ORGANIZER sidebar shows all links except Users
  test('T103: ORGANIZER sidebar shows all links except Users', async ({ page }) => {
    // Log in as ORGANIZER
    await page.goto('/admin');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    const sidebar = page.locator('aside');

    // These links should be visible
    const visibleLinks = ['Dashboard', 'Organizations', 'Venues', 'Events', 'Analytics', 'Scan'];
    for (const linkText of visibleLinks) {
      await expect(sidebar.getByRole('link', { name: linkText })).toBeVisible();
    }

    // Users link should NOT be visible
    await expect(sidebar.getByRole('link', { name: 'Users' })).not.toBeVisible();
  });

  // T104: ORGANIZER navigates to /admin/users, sees access denied
  test('T104: ORGANIZER navigates directly to /admin/users, sees access denied', async ({
    page,
  }) => {
    await page.goto('/admin/users');

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

  // T106: CUSTOMER sees 403 access denied
  test('T106: CUSTOMER navigates to /admin, sees access denied with back-to-events', async ({
    page,
  }) => {
    // Log in as CUSTOMER, then navigate to /admin
    await page.goto('/admin');

    // Should see access denied
    await expect(page.getByText(/Access Denied/i)).toBeVisible();
    // Should see correct role requirement message
    await expect(page.getByText(/Admin or Organizer role is required/i)).toBeVisible();
    // Should have a back to events button
    await expect(page.getByRole('button', { name: /Back to Events/i })).toBeVisible();
  });
});
