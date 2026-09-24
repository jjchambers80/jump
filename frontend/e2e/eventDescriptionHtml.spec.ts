// Playwright e2e test: event description HTML rendering and WYSIWYG editor
//
// Prerequisites: running frontend dev server (npm run dev:frontend) and
// backend (npm run dev:backend). The test uses signInAsStaff which reads
// AUTH_SECRET from frontend/.env.local.
//
// Run: npx playwright test e2e/eventDescriptionHtml.spec.ts --project=chromium
//
// Scope:
// - Storefront event page: verifies the description is rendered through
//   ContentHtml so <p>/<strong> appear as DOM elements, not literal text.
// - Admin edit page: verifies the Tiptap editor (RichTextEditorField) is
//   shown when using the signInAsStaff helper.

import { test, expect, type Page } from '@playwright/test';
import { signInAsStaff, type StaffUser } from './helpers/session';

// ---------- Fixtures ----------

const sampleEventId = 'e2e-test-event-html-001';

/** HTML description with known <p> and <strong> that must render as elements. */
const htmlDescription = '<p>This event features <strong>live music</strong> and <strong>guest speakers</strong>.</p><p>Doors open at 7pm.</p>';

/** Minimal event payload matching the public GET /events/:id shape. */
function makeEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: sampleEventId,
    name: 'HTML Description Test Event',
    description: htmlDescription,
    logoUrl: null,
    date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 200,
    category: 'Test',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    taxRate: 0.08,
    taxInclusivePricing: false,
    organizationId: 'e2e-org-html',
    organizationName: 'Test Org',
    organizationLogoUrl: null,
    organizationBrandColor: null,
    organizationThemeMode: null,
    organizationSignInLinks: false,
    venue: {
      id: 'e2e-venue-html',
      name: 'Test Venue',
      address: '123 Test St, Test City, TS',
      timezone: 'America/New_York',
      isPublic: true,
    },
    priceTiers: [
      {
        id: 'tier-html-001',
        name: 'General Admission',
        description: null,
        price: 25,
        quantityTotal: 100,
        quantitySold: 10,
        quantityReserved: 2,
        quantityAvailable: 88,
        displayOrder: 1,
        minPerOrder: 1,
        maxPerOrder: 10,
        isActive: true,
        isRefundable: true,
      },
    ],
    addOns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Minimal admin event payload matching GET /organizations/:orgId/events shape. */
function makeAdminEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: sampleEventId,
    name: 'Edit Test Event',
    slug: 'edit-test-event',
    description: htmlDescription,
    logoUrl: null,
    date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 200,
    category: 'Test',
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    rsvpLimit: null,
    rsvpMaxPartySize: 1,
    venue: {
      id: 'e2e-venue-html',
      name: 'Test Venue',
      address: '123 Test St, Test City, TS',
      timezone: 'America/New_York',
    },
    tax: { rate: 0.08, source: 'MANUAL', region: 'NY' },
    taxInclusivePricing: false,
    priceTiers: [
      {
        id: 'tier-html-001',
        name: 'General Admission',
        description: null,
        price: 25,
        quantityTotal: 100,
        quantitySold: 0,
        quantityAvailable: 100,
        quantityReserved: 0,
        displayOrder: 1,
        minPerOrder: 1,
        maxPerOrder: 10,
        isActive: true,
        saleStartDate: null,
        saleEndDate: null,
        visibility: 'PUBLIC',
        isRefundable: true,
        isOnSale: true,
        saleStatus: 'ON_SALE',
      },
    ],
    ...overrides,
  };
}

const orgId = 'e2e-org-html';

const staffUser: StaffUser = {
  id: 'e2e-staff-html',
  email: 'e2e-admin-html@example.com',
  role: 'ADMIN',
  name: 'Test Admin',
};

// The frontend sends API requests to NEXT_PUBLIC_API_URL (default localhost:3002).
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

async function mockStorefrontApi(page: Page) {
  await page.route(API + '/events/' + sampleEventId, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeEventPayload()),
    });
  });

  await page.route(API + '/legal/versions', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ versions: [] }),
    });
  });
}

async function mockAdminApi(page: Page) {
  await page.route(API + '/organizations/' + orgId + '/events*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [makeAdminEventPayload()] }),
    });
  });

  await page.route(API + '/organizations/' + orgId + '/venues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'e2e-venue-html', name: 'Test Venue', address: '123 Test St, Test City, TS', timezone: 'America/New_York' },
      ]),
    });
  });

  await page.route(API + '/organizations/' + orgId + '/tier-presets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tierPresets: [] }),
    });
  });
}

// ---------- Tests ----------

test.describe('Event description HTML rendering', () => {
  test('storefront event page renders description HTML as elements, not literal text', async ({ page }) => {
    test.setTimeout(60000);
    await mockStorefrontApi(page);

    await page.goto('/events/' + sampleEventId);

    // The server component (EventDetailPage) first fetches /events/:id/meta
    // from the backend during SSR. If no backend is running this will timeout
    // after 2 seconds, then the client component mounts and the browser-side
    // fetch (mocked above) supplies the data.
    const infoButton = page.getByRole('button', { name: 'Event Information' });
    await expect(infoButton).toBeVisible({ timeout: 30000 });

    // Click the Event Information button to open the description dialog
    await infoButton.click();

    // The description dialog should now be visible
    const dialogHeading = page.getByRole('heading', { name: 'Event Information' });
    await expect(dialogHeading).toBeVisible({ timeout: 5000 });

    // The page mounts both the mobile drawer and the desktop dialog and hides
    // one with CSS, so scope every check to the visible copy.
    const prose = page.locator('.jump-prose:visible');
    await expect(prose).toHaveCount(1);

    // <p> and <strong> render as DOM elements, not literal "&lt;p&gt;" text
    await expect(prose.getByText('This event features')).toBeVisible();
    await expect(prose.locator('strong').first()).toContainText('live music');
    await expect(prose.locator('p')).toHaveCount(2);
    await expect(prose.getByText('Doors open at 7pm')).toBeVisible();
    await expect(prose).not.toContainText('<p>');
  });

  test('storefront event page shows description as HTML in mobile drawer', async ({ page }) => {
    test.setTimeout(60000);
    await mockStorefrontApi(page);

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/events/' + sampleEventId);

    const infoButton = page.getByRole('button', { name: 'Event Information' });
    await expect(infoButton).toBeVisible({ timeout: 30000 });
    await infoButton.click();

    // On mobile, the dialog is a slide-up drawer — the heading is still visible
    const dialogHeading = page.getByRole('heading', { name: 'Event Information' });
    await expect(dialogHeading).toBeVisible({ timeout: 5000 });

    // Only the drawer is visible at this width; the desktop dialog is hidden
    const prose = page.locator('.jump-prose:visible');
    await expect(prose).toHaveCount(1);
    await expect(prose.locator('strong').first()).toContainText('live music');
    await expect(prose.locator('p')).toHaveCount(2);
  });
});

test.describe('Admin event edit page — editor', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsStaff(page, staffUser, 'http://localhost:3001');
  });

  test('admin edit page shows the RichTextEditorField (Tiptap editor) for description', async ({ page }) => {
    test.setTimeout(60000);
    await mockAdminApi(page);

    // Navigate to the admin edit event page
    await page.goto('/admin/events/' + sampleEventId + '/edit?orgId=' + orgId);

    // Wait for the page to load
    await expect(page.getByRole('heading', { name: /edit event/i })).toBeVisible({ timeout: 30000 });

    // The RichTextEditorField dynamically imports the Tiptap editor (ssr: false).
    // After hydration, Tiptap mounts a .ProseMirror element inside the editor container.
    const editor = page.locator('.ProseMirror');
    await expect(editor.first()).toBeVisible({ timeout: 30000 });

    // The editor should contain the loaded description HTML content
    await expect(editor.first()).toContainText('live music');
    await expect(editor.first()).toContainText('guest speakers');
    await expect(editor.first()).toContainText('Doors open at 7pm');
  });
});
