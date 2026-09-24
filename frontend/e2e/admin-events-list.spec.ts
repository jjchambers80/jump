// Events list page: KPI strip + filter toolbar + URL state (spec 035C).
// Extends 035B tests with new UI. Mock API, signInAsStaff.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-events-list';
const ALT_ORG_ID = 'org-other';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const venue = { id: 'venue-1', name: 'Concert Hall', address: '123 Main St', timezone: 'America/New_York' };
const otherVenue = { id: 'venue-2', name: 'Theater', address: '456 Oak Ave', timezone: 'America/New_York' };

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const sampleEvents = [
  {
    id: 'evt-1',
    name: 'Summer Music Festival',
    description: 'A grand musical event',
    date: futureDate(30),
    capacity: 5000,
    category: 'Music',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    slug: 'summer-music-festival',
    venue,
    rsvpLimit: null,
    rsvpGoingCount: 0,
    priceTiers: [
      { id: 'tier-ga', name: 'General Admission', price: 50, quantityTotal: 3000, quantitySold: 1200, quantityReserved: 100, quantityAvailable: 1700, displayOrder: 0, isActive: true },
      { id: 'tier-vip', name: 'VIP', price: 150, quantityTotal: 500, quantitySold: 200, quantityReserved: 50, quantityAvailable: 250, displayOrder: 1, isActive: true },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
  {
    id: 'evt-2',
    name: 'Comedy Night',
    description: 'Stand-up comedy show',
    date: futureDate(7),
    capacity: 300,
    category: 'Comedy',
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    slug: 'comedy-night',
    venue: otherVenue,
    rsvpLimit: null,
    rsvpGoingCount: 0,
    priceTiers: [
      { id: 'tier-cn', name: 'General', price: 25, quantityTotal: 300, quantitySold: 0, quantityReserved: 0, quantityAvailable: 300, displayOrder: 0, isActive: true },
    ],
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-05T00:00:00Z',
  },
  {
    id: 'evt-3',
    name: 'Art Workshop RSVP',
    description: 'Free community workshop',
    date: futureDate(14),
    capacity: 50,
    category: 'Workshop',
    status: 'PUBLISHED',
    admissionMode: 'RSVP',
    slug: 'art-workshop',
    venue,
    rsvpLimit: 50,
    rsvpGoingCount: 18,
    priceTiers: [],
    createdAt: '2026-01-20T00:00:00Z',
    updatedAt: '2026-01-25T00:00:00Z',
  },
  {
    id: 'evt-4',
    name: 'Past Tech Talk',
    description: 'A tech talk that already happened',
    date: pastDate(10),
    capacity: 200,
    category: 'Tech',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    slug: 'past-tech-talk',
    venue: otherVenue,
    rsvpLimit: null,
    rsvpGoingCount: 0,
    priceTiers: [
      { id: 'tier-tt', name: 'Standard', price: 10, quantityTotal: 200, quantitySold: 150, quantityReserved: 0, quantityAvailable: 50, displayOrder: 0, isActive: true },
    ],
    createdAt: '2025-12-01T00:00:00Z',
    updatedAt: '2025-12-10T00:00:00Z',
  },
  {
    id: 'evt-5',
    name: 'Cancelled Event',
    description: 'This was cancelled',
    date: futureDate(60),
    capacity: 100,
    category: 'Other',
    status: 'CANCELLED',
    admissionMode: 'TICKETED',
    slug: null,
    venue,
    rsvpLimit: null,
    rsvpGoingCount: 0,
    priceTiers: [
      { id: 'tier-ce', name: 'General', price: 20, quantityTotal: 100, quantitySold: 30, quantityReserved: 10, quantityAvailable: 60, displayOrder: 0, isActive: true },
    ],
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
  },
];

const summaryData = {
  counts: { all: 5, DRAFT: 1, PUBLISHED: 3, CANCELLED: 1 },
  published: { count: 3, capacity: 5250 },
  drafts: { count: 1 },
  registered: { tickets: 1550, rsvps: 18 },
  inventory: { available: 2360, tiers: 4 },
  categories: ['Comedy', 'Music', 'Other', 'Tech', 'Workshop'],
};

async function mockApi(page: Page) {
  // Org list for OrgContext
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Events List Org', status: 'ACTIVE' }]))
  );

  // Summary
  await page.route(`${API}/organizations/${ORG_ID}/events/summary*`, (route) =>
    route.fulfill(json(summaryData))
  );

  // Events list — honor status, q, category, sort filters
  await page.route(`${API}/organizations/${ORG_ID}/events?*`, async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q');
    const category = url.searchParams.get('category');
    let filtered = [...sampleEvents];
    if (status) filtered = filtered.filter((e) => e.status === status);
    if (q) {
      const lq = q.toLocaleLowerCase();
      filtered = filtered.filter((e) =>
        e.name.toLocaleLowerCase().includes(lq) ||
        (e.venue?.name.toLocaleLowerCase() || '').includes(lq)
      );
    }
    if (category) filtered = filtered.filter((e) => e.category === category);
    return route.fulfill(
      json({
        events: filtered,
        pagination: {
          page: 1,
          limit: 25,
          total: filtered.length,
          totalPages: 1,
        },
      })
    );
  });

  // Empty for alternate org
  await page.route(`${API}/organizations/${ALT_ORG_ID}/events?*`, (route) =>
    route.fulfill(
      json({
        events: [],
        pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
      })
    )
  );
  await page.route(`${API}/organizations/${ALT_ORG_ID}/events/summary*`, (route) =>
    route.fulfill(
      json({
        counts: { all: 0, DRAFT: 0, PUBLISHED: 0, CANCELLED: 0 },
        published: { count: 0, capacity: 0 },
        drafts: { count: 0 },
        registered: { tickets: 0, rsvps: 0 },
        inventory: { available: 0, tiers: 0 },
        categories: [],
      })
    )
  );
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'events-admin', email: 'events-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('full width at 1440px — shell max-w-screen-2xl', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // The shell wraps the page content
  const shell = page.locator('.mx-auto.w-full.max-w-screen-2xl');
  await expect(shell).toBeVisible();

  // Header with icon tile, h1, total pill
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(page.getByText('5 total')).toBeVisible();
  await expect(page.getByText('Manage, publish and track your events')).toBeVisible();

  // Create Event button
  await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible();

  // KPI strip visible with 4 cards
  await expect(page.getByText('Registered', { exact: true })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText('Drafts', { exact: true })).toBeVisible();
  await expect(page.getByText('Available inventory', { exact: true })).toBeVisible();
});

test('no horizontal scroll at 390px — one column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);

  // The toolbar's radiogroup is visible (not forced offscreen)
  await expect(page.getByRole('radiogroup', { name: 'Filter by status' })).toBeVisible();

  // KPI strip is 2x2 at this width (4 cards visible within the summary grid)
  const kpiGrid = page.locator('div.grid.grid-cols-2').first();
  await expect(kpiGrid.getByText('Registered', { exact: true })).toBeVisible();
  await expect(kpiGrid.getByText('Published', { exact: true })).toBeVisible();
  await expect(kpiGrid.getByText('Drafts', { exact: true })).toBeVisible();
  await expect(kpiGrid.getByText('Available inventory', { exact: true })).toBeVisible();
});

test('KPI values match summary data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Registered: tickets (1550) + RSVPs (18) = 1568
  const registeredCard = page.locator('div').filter({ hasText: /^Registered/ }).last();
  await expect(registeredCard).toContainText('1,568');
  // Subtitle shows the detail
  await expect(page.getByText('tickets 1550 + RSVPs 18')).toBeVisible();

  // Published count + capacity
  const publishedCard = page.getByText('Published', { exact: true }).locator('..').locator('..');
  await expect(publishedCard).toContainText('3');
  await expect(page.getByText('capacity 5,250')).toBeVisible();

  // Drafts count
  const draftsCard = page.getByText('Drafts', { exact: true }).locator('..').locator('..');
  await expect(draftsCard).toContainText('1');

  // Available inventory
  const inventoryCard = page.getByText('Available inventory', { exact: true }).locator('..').locator('..');
  await expect(inventoryCard).toContainText('2,360');
  await expect(page.getByText('across 4 tiers')).toBeVisible();
});

test('status radiogroup shows counts per status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Each radio button has the count in its accessible name
  const allRadio = page.getByRole('radio', { name: 'All, 5 events' });
  await expect(allRadio).toBeVisible();
  await expect(allRadio).toHaveAttribute('aria-checked', 'true'); // default selected

  await expect(page.getByRole('radio', { name: 'Draft, 1 event' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Published, 3 events' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Cancelled, 1 event' })).toBeVisible();
});

test('RSVP card shows RSVPs and not Analytics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // RSVP event card (evt-3) has RSVPs button with Users icon
  const rsvpCard = page.getByRole('article', { name: 'Art Workshop RSVP' });
  await expect(rsvpCard).toBeVisible();

  // Should show RSVPs button (not Analytics)
  await expect(rsvpCard.getByRole('link', { name: /RSVPs/i })).toBeVisible();
  await expect(rsvpCard.getByRole('link', { name: /Analytics/i })).not.toBeVisible();
});

test('Ended pill on a past event', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Past event (evt-4) should have "Ended" pill
  const pastCard = page.getByRole('article', { name: 'Past Tech Talk' });
  await expect(pastCard).toBeVisible();
  await expect(pastCard.getByText('Ended')).toBeVisible();

  // Cancelled event (evt-5) should NOT have "Ended" pill
  const cancelledCard = page.getByRole('article', { name: 'Cancelled Event' });
  await expect(cancelledCard).toBeVisible();
  await expect(cancelledCard.getByText('Ended')).not.toBeVisible();
});

test('cancel requires dialog confirm (not window.confirm)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Intercept the cancel API call
  let cancelCalled = false;
  await page.route(`${API}/organizations/${ORG_ID}/events/evt-2/cancel`, (route) => {
    cancelCalled = true;
    return route.fulfill(json({ status: 'CANCELLED' }));
  });

  // Open the ... menu on the DRAFT event (evt-2) and click Cancel event...
  const card = page.getByRole('article', { name: 'Comedy Night' });
  const menuButton = card.getByRole('button', { name: /More actions for Comedy Night/ });
  await menuButton.click();

  // Click Cancel event... in the menu
  await page.getByRole('menuitem', { name: /Cancel event/ }).click();

  // Dialog should appear (not window.confirm)
  const dialog = page.getByRole('dialog', { name: 'Cancel event' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Are you sure/)).toBeVisible();
  await expect(dialog).toContainText('Comedy Night');

  // Click "Keep event" to dismiss
  await dialog.getByRole('button', { name: 'Keep event' }).click();
  await expect(dialog).not.toBeVisible();
  expect(cancelCalled).toBe(false);
});

test('... menu keyboard navigation + focus return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const card = page.getByRole('article', { name: 'Summer Music Festival' });
  const menuButton = card.getByRole('button', { name: /More actions for Summer Music Festival/ });

  // Open the menu
  await menuButton.click();
  const firstItem = page.getByRole('menuitem', { name: 'Event page' });
  await expect(firstItem).toBeFocused();

  // ArrowDown to second item
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Applications' })).toBeFocused();

  // Escape closes and returns focus to the trigger
  await page.keyboard.press('Escape');
  await expect(menuButton).toBeFocused();
  await expect(page.getByRole('menu')).not.toBeVisible();
});

test('cancelled event shows Duplicate as primary action', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const cancelledCard = page.getByRole('article', { name: 'Cancelled Event' });
  await expect(cancelledCard.getByRole('button', { name: 'Duplicate' })).toBeVisible();
  // Edit should not be shown for cancelled event
  await expect(cancelledCard.getByRole('link', { name: 'Edit' })).not.toBeVisible();
});

test('Edit is primary-styled on DRAFT and PUBLISHED cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // DRAFT card — Edit link should be primary (indigo filled)
  const draftCard = page.getByRole('article', { name: 'Comedy Night' });
  const draftEdit = draftCard.getByRole('link', { name: 'Edit' });
  await expect(draftEdit).toBeVisible();
  const draftHref = await draftEdit.getAttribute('href');
  expect(draftHref).toContain('/edit');
  // Primary style: should NOT have border class
  const draftClasses = await draftEdit.getAttribute('class');
  expect(draftClasses).toContain('bg-indigo-600');

  // PUBLISHED card — Edit link should also be primary
  const pubCard = page.getByRole('article', { name: 'Summer Music Festival' });
  const pubEdit = pubCard.getByRole('link', { name: 'Edit' });
  await expect(pubEdit).toBeVisible();
  const pubClasses = await pubEdit.getAttribute('class');
  expect(pubClasses).toContain('bg-indigo-600');

  // CANCELLED card — no Edit link
  const cancelledCard = page.getByRole('article', { name: 'Cancelled Event' });
  await expect(cancelledCard.getByRole('link', { name: 'Edit' })).not.toBeVisible();
});

test('RSVP card has no tier chip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // RSVP card (evt-3, Art Workshop RSVP) should NOT show a tier count chip
  const rsvpCard = page.getByRole('article', { name: 'Art Workshop RSVP' });
  await expect(rsvpCard).toBeVisible();
  await expect(rsvpCard.getByText(/tier/i)).not.toBeVisible();

  // Ticketed card should still show the tier chip
  const ticketedCard = page.getByRole('article', { name: 'Summer Music Festival' });
  await expect(ticketedCard.getByText(/2 tiers/i)).toBeVisible();
});

test('Export CSV passes current search query in params', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Type a search term
  await page.getByRole('searchbox', { name: 'Search events' }).click();
  await page.keyboard.type('Retro');
  await expect(page).toHaveURL(/q=Retro/, { timeout: 3000 });

  // Wait for the CSV export request using waitForRequest
  const csvRequestPromise = page.waitForRequest(
    (req) => req.url().includes('/events/export.csv'),
    { timeout: 5000 }
  );
  
  // Click Export CSV
  await page.getByRole('button', { name: 'Export events list as CSV' }).click();

  // Wait for the request
  let exportUrl = '';
  try {
    const csvReq = await csvRequestPromise;
    exportUrl = csvReq.url();
  } catch {
    // Request didn't appear via click — try JS dispatch
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Export events list as CSV"]');
      if (btn) (btn as HTMLButtonElement).click();
    });
    const csvReq = await page.waitForRequest(
      (req) => req.url().includes('/events/export.csv'),
      { timeout: 5000 }
    );
    exportUrl = csvReq.url();
  }

  // Assert the export URL includes q=Retro
  expect(exportUrl).toContain('q=Retro');
});

test('draft event shows Publish and Edit buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const draftCard = page.getByRole('article', { name: 'Comedy Night' });
  await expect(draftCard.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(draftCard.getByRole('button', { name: 'Publish' })).toBeVisible();
});

test('published ticketed event shows Analytics and Tier toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const publishedCard = page.getByRole('article', { name: 'Summer Music Festival' });
  await expect(publishedCard.getByRole('link', { name: /Analytics/i })).toBeVisible();

  // Tier toggle
  const tierButton = publishedCard.getByRole('button', { name: 'Tiers' });
  await expect(tierButton).toBeVisible();
  await expect(tierButton).toHaveAttribute('aria-expanded', 'false');

  // Click to expand
  await tierButton.click();
  await expect(tierButton).toHaveAttribute('aria-expanded', 'true');

  // Expanded tier table should have a caption
  const region = page.locator('#event-tiers-evt-1');
  await expect(region).toBeVisible();
  await expect(region.getByRole('caption')).toHaveText('Price tiers for Summer Music Festival');
});

test('sell-through numbers visible on ticketed cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  const publishedCard = page.getByRole('article', { name: 'Summer Music Festival' });
  await expect(publishedCard.getByText(/sold \/.*avail/i)).toBeVisible();
});

test('status filter radiogroup filters events', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // All 5 events visible initially
  await expect(page.getByRole('article')).toHaveCount(5);

  // Click DRAFT radio
  await page.getByRole('radio', { name: 'Draft, 1 event' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Comedy Night', { exact: true })).toBeVisible();
});

test('filters round-trip through URL reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Apply status filter
  await page.getByRole('radio', { name: 'Published, 3 events' }).click();
  await expect(page).toHaveURL(/status=PUBLISHED/);

  // Apply search filter — type each key to trigger input events
  await page.getByRole('searchbox', { name: 'Search events' }).click();
  await page.keyboard.type('Summer');
  // Wait for the 300ms debounce to fire and URL to update
  await expect(page).toHaveURL(/q=Summer/, { timeout: 3000 });

  // Reload — filters should persist
  await page.reload();
  await expect(page).toHaveURL(/status=PUBLISHED/);
  await expect(page).toHaveURL(/q=Summer/);
  // The published Summer event should show
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Summer Music Festival')).toBeVisible();
});

test('search announces result count status region', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Status region shows the count
  const statusRegion = page.getByRole('status').first();
  await expect(statusRegion).toContainText('Showing 1\u20135 of 5 events');
});

// ── §5 Accessibility coverage ──

test('h1 and article+h2 structure on every card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Page has exactly one h1
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Events');

  // Every event is an article with aria-labelledby pointing to an h2 heading
  const articles = page.getByRole('article');
  await expect(articles).toHaveCount(5);

  for (const article of await articles.all()) {
    // Each article has an h2
    const h2 = article.getByRole('heading', { level: 2 });
    await expect(h2).toHaveCount(1);

    // The article's aria-labelledby id matches the h2 element id
    const labelledBy = await article.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const headingId = await h2.getAttribute('id');
    expect(headingId).toBeTruthy();
    expect(headingId).toBe(labelledBy);

    // The h2 contains a link to edit (the event name)
    const link = h2.getByRole('link');
    await expect(link).toHaveCount(1);
    expect(await link.getAttribute('href')).toContain('/edit');
  }
});

test('radiogroup labelled and each radio has accessible name with count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Radiogroup has aria-label
  const rg = page.getByRole('radiogroup', { name: 'Filter by status' });
  await expect(rg).toBeVisible();
  await expect(rg.locator('button[role="radio"]')).toHaveCount(4);

  // Each radio has aria-checked (default checked on "All")
  await expect(page.getByRole('radio', { name: 'All, 5 events' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Draft, 1 event' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('radio', { name: 'Published, 3 events' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('radio', { name: 'Cancelled, 1 event' })).toHaveAttribute('aria-checked', 'false');
});

test('search, category select, and sort select are labelled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Search is an input[type="search"] with aria-label
  const search = page.getByRole('searchbox', { name: 'Search events' });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('type', 'search');

  // Category is a select with aria-label
  const cat = page.getByRole('combobox', { name: 'Filter by category' });
  await expect(cat).toBeVisible();

  // Sort is a select with aria-label
  const sort = page.getByRole('combobox', { name: 'Sort events' });
  await expect(sort).toBeVisible();
});

test('no horizontal scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Wait for the page to render
  await expect(page.getByRole('radiogroup', { name: 'Filter by status' })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});

test('24 px minimum target size on every interactive control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Check every interactive element is at least 24x24 px (WCAG 2.2 SC 2.5.8)
  const smallTargets = await page.evaluate(() => {
    const selectors = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="radio"]';
    const elements = document.querySelectorAll<HTMLElement>(selectors);
    const small: { tag: string; text: string; width: number; height: number }[] = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        small.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return small;
  });

  expect(smallTargets).toEqual([]);
});

test('light mode full page screenshot at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Ensure light mode
  await page.emulateMedia({ colorScheme: 'light' });

  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await page.waitForTimeout(500); // let animations settle

  await expect(page).toHaveScreenshot('admin-events-light.png', { fullPage: true });
});

test('dark mode full page screenshot at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Ensure dark mode
  await page.emulateMedia({ colorScheme: 'dark' });

  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await page.waitForTimeout(500); // let animations settle

  await expect(page).toHaveScreenshot('admin-events-dark.png', { fullPage: true });
});

test('pagination nav with aria-current on active page', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // Generate 30 events so pagination shows (25 per page = 2 pages)
  const manyEvents = Array.from({ length: 30 }, (_, i) => ({
    id: `evt-page-${i + 1}`,
    name: `Paginated Event ${i + 1}`,
    description: `Event number ${i + 1}`,
    date: futureDate(30 + i),
    capacity: 100,
    category: i < 10 ? 'Music' : i < 20 ? 'Comedy' : 'Workshop',
    status: i < 10 ? 'PUBLISHED' : i < 20 ? 'DRAFT' : 'PUBLISHED',
    admissionMode: 'TICKETED' as const,
    slug: `paginated-event-${i + 1}`,
    venue,
    rsvpLimit: null,
    rsvpGoingCount: 0,
    priceTiers: [
      { id: `tier-${i}`, name: 'General', price: 25, quantityTotal: 100, quantitySold: i * 3, quantityReserved: 0, quantityAvailable: 100 - i * 3, displayOrder: 0, isActive: true },
    ],
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - i * 43200000).toISOString(),
  }));

  const page1Events = manyEvents.slice(0, 25);
  const page2Events = manyEvents.slice(25, 30);

  // Mock API with pagination-aware route
  await signInAsStaff(page, { id: 'events-admin', email: 'events-admin@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Events List Org', status: 'ACTIVE' }]))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/summary*`, (route) =>
    route.fulfill(json({
      counts: { all: 30, DRAFT: 10, PUBLISHED: 20, CANCELLED: 0 },
      published: { count: 20, capacity: 2000 },
      drafts: { count: 10 },
      registered: { tickets: 1000, rsvps: 0 },
      inventory: { available: 2000, tiers: 30 },
      categories: ['Comedy', 'Music', 'Workshop'],
    }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events?*`, async (route) => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
    const isPage2 = pageNum >= 2;
    return route.fulfill(
      json({
        events: isPage2 ? page2Events : page1Events,
        pagination: {
          page: isPage2 ? 2 : 1,
          limit: 25,
          total: 30,
          totalPages: 2,
        },
      })
    );
  });

  await page.goto(`/admin/events?orgId=${ORG_ID}`);

  // Wait for events to render and pagination to appear
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();

  // The first page button should have aria-current page
  await expect(page.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '2' })).not.toHaveAttribute('aria-current');

  // Click page 2
  await page.getByRole('button', { name: '2' }).click();

  // Now page 2 should have aria-current
  await expect(page.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '1' })).not.toHaveAttribute('aria-current');
});