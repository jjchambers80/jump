// Playwright integration test: event description HTML rendering
// Verifies that the storefront event page renders the description
// through ContentHtml so <p>/<strong> appear as DOM elements, not literal text.
// Also verifies the admin edit page shows the RichTextEditorField (Tiptap editor).

import { test, expect } from '@playwright/test';
import { signInAsStaff, type StaffUser } from '../../e2e/helpers/session';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001';
// The API client sends requests to the backend URL (NEXT_PUBLIC_API_URL).
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

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

// ---------- Tests ----------

test.describe('Event description HTML rendering', () => {
  test('storefront event page renders description HTML as elements, not literal text', async ({ page }) => {
    // Mock the public event API response (API client sends to backend URL)
    await page.route(API + '/events/' + sampleEventId, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeEventPayload()),
      });
    });

    // Mock the legal versions endpoint (the event page fetches this on mount)
    await page.route(API + '/legal/versions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: [] }),
      });
    });

    // Navigate to the event detail page
    await page.goto(`${BASE}/events/${sampleEventId}`);

    // Wait for the event to load — the "Event Information" button appears
    // when event.description is set
    const infoButton = page.getByRole('button', { name: 'Event Information' });
    await expect(infoButton).toBeVisible({ timeout: 5000 });

    // Click the Event Information button to open the description dialog
    await infoButton.click();

    // The description dialog should now be visible
    const dialogHeading = page.getByRole('heading', { name: 'Event Information' });
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Check that <p> and <strong> elements are rendered as actual DOM elements
    // (not as literal text like "&lt;p&gt;")
    const dialogContent = page.getByText('This event features');
    await expect(dialogContent).toBeVisible();

    // Verify the <strong> element is an actual <strong> in the DOM
    const strongElements = dialogContent.locator('strong');
    await expect(strongElements.first()).toBeVisible();
    await expect(strongElements.first()).toContainText('live music');

    // Verify there are two <p> elements rendered
    const paragraphs = page.locator('.jump-prose p');
    await expect(paragraphs).toHaveCount(2);

    // Verify the second paragraph text
    await expect(page.getByText('Doors open at 7pm')).toBeVisible();
  });

  test('storefront event page shows description as HTML in mobile drawer', async ({ page }) => {
    // Same API mocks
    await page.route(API + '/events/' + sampleEventId, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeEventPayload()),
      });
    });
    await page.route(API + '/legal/versions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: [] }),
      });
    });

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE}/events/${sampleEventId}`);

    const infoButton = page.getByRole('button', { name: 'Event Information' });
    await expect(infoButton).toBeVisible({ timeout: 5000 });
    await infoButton.click();

    // On mobile, the dialog is a slide-up drawer — the heading is still visible
    const dialogHeading = page.getByRole('heading', { name: 'Event Information' });
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Verify HTML renders as elements in mobile drawer
    const strongElements = page.locator('strong');
    await expect(strongElements.first()).toBeVisible();
    await expect(strongElements.first()).toContainText('live music');

    // Verify <p> elements render
    const paragraphs = page.locator('.jump-prose p');
    await expect(paragraphs).toHaveCount(2);
  });
});

test.describe('Admin event edit page — editor', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in as staff
    await signInAsStaff(page, staffUser, BASE);
  });

  test('admin edit page shows the RichTextEditorField (Tiptap editor) for description', async ({ page }) => {
    // Mock admin event list API
    await page.route(API + '/organizations/' + orgId + '/events*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [makeAdminEventPayload()] }),
      });
    });

    // Mock venues API
    await page.route(API + '/organizations/' + orgId + '/venues', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'e2e-venue-html', name: 'Test Venue', address: '123 Test St, Test City, TS', timezone: 'America/New_York' },
        ]),
      });
    });

    // Mock tier presets API
    await page.route(API + '/organizations/' + orgId + '/tier-presets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tierPresets: [] }),
      });
    });

    // Navigate to the admin edit event page
    await page.goto(`${BASE}/admin/events/${sampleEventId}/edit?orgId=${orgId}`);

    // Wait for the page to load
    await expect(page.getByRole('heading', { name: /edit event/i })).toBeVisible({ timeout: 5000 });

    // The RichTextEditorField dynamically imports the Tiptap editor (ssr: false).
    // The loading state is an animated placeholder div. After hydration, Tiptap
    // mounts a .ProseMirror element inside the editor container.
    //
    // Wait for the ProseMirror editor element to appear (Tiptap mounts it after
    // the dynamic import resolves).
    const editor = page.locator('.ProseMirror');
    await expect(editor.first()).toBeVisible({ timeout: 8000 });

    // The editor should have the placeholder text
    await expect(editor.first()).toContainText('Event description');

    // The editor should contain the loaded description HTML content
    await expect(editor.first()).toContainText('live music');
    await expect(editor.first()).toContainText('guest speakers');
    await expect(editor.first()).toContainText('Doors open at 7pm');
  });
});
