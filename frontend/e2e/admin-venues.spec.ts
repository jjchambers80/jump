// Admin › Venues: list → read-only Details → editor, the same path as Events
// (spec 037). Mocked API, signInAsStaff.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-1';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = new Date(Date.now() - 20 * 86_400_000).toISOString();

const baseVenue = {
  organizationId: ORG_ID,
  city: null,
  state: null,
  postalCode: null,
  country: 'US',
  timezone: 'America/New_York',
  timezoneSource: 'DERIVED',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

async function mockVenueApi(page: Page) {
  let venues = [
    { ...baseVenue, id: 'venue-public', slug: 'public-hall', name: 'Public Hall', address: '1 Public Way', city: 'Raleigh', state: 'NC', postalCode: '27601', isPublic: true, _count: { events: 2 } },
    { ...baseVenue, id: 'venue-private', slug: 'private-hall', name: 'Private Hall', address: '2 Private Way', isPublic: false, _count: { events: 0 } },
  ];
  const eventsFor = (id: string) =>
    id === 'venue-public'
      ? [
          { id: 'evt-next', slug: 'next', name: 'Spring Expo', date: future, status: 'PUBLISHED', admissionMode: 'TICKETED', logoUrl: null },
          { id: 'evt-old', slug: 'old', name: 'Winter Swap', date: past, status: 'PUBLISHED', admissionMode: 'RSVP', logoUrl: null },
        ]
      : [];
  const patches: unknown[] = [];

  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Test Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json(venues));
    const created = { ...baseVenue, id: 'venue-created', slug: 'created', isPublic: true, _count: { events: 0 }, ...(route.request().postDataJSON() as object) };
    venues = [created as (typeof venues)[number], ...venues];
    return route.fulfill(json(created, 201));
  });
  await page.route(new RegExp(`${API}/organizations/${ORG_ID}/venues/[^/]+$`), async (route) => {
    const id = route.request().url().split('/').pop()!;
    const method = route.request().method();
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patches.push(body);
      // The backend re-derives a null zone from the address; keep the stored one.
      const { timezone, ...rest } = body;
      venues = venues.map((v) => (v.id === id ? { ...v, ...rest, ...(typeof timezone === 'string' ? { timezone } : {}) } : v));
    }
    if (method === 'DELETE') {
      venues = venues.filter((v) => v.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    const venue = venues.find((v) => v.id === id);
    return venue ? route.fulfill(json({ ...venue, events: eventsFor(id) })) : route.fulfill(json({ error: 'Venue not found' }, 404));
  });
  await page.route(`${API}/organizations/${ORG_ID}/venues/*/logo`, (route) => route.fulfill(json({ logoUrl: '/uploads/logos/test.png' })));
  return { patches };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'venue-admin', email: 'venue-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('lists venues as cards that open the details page, with search and visibility filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockVenueApi(page);
  await page.goto(`/admin/venues?orgId=${ORG_ID}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Venues' })).toBeVisible();
  await expect(page.getByText('2 total')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Public Hall public page (opens in a new tab)' })).toHaveAttribute('href', '/venues/public-hall');
  await expect(page.getByRole('link', { name: /View Private Hall public page/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit Private Hall' })).toHaveAttribute('href', `/admin/venues/venue-private/edit?orgId=${ORG_ID}`);

  await page.getByLabel('Search venues').fill('raleigh');
  await expect(page.getByRole('heading', { name: 'Private Hall' })).toHaveCount(0);
  await expect(page.getByText('1 of 2 venues')).toBeVisible();
  await expect(page).toHaveURL(/q=raleigh/);
  await page.getByRole('button', { name: 'Clear search' }).click();

  await page.getByRole('group', { name: 'Visibility' }).getByText('Private').click();
  await expect(page.getByRole('radio', { name: 'Private' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Public Hall' })).toHaveCount(0);
  await expect(page).toHaveURL(/visibility=private/);

  await page.getByRole('link', { name: 'Private Hall', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/venues/venue-private\\?orgId=${ORG_ID}$`));

  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations).toEqual([]);
});

test('details page is read-only and links each section to the editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockVenueApi(page);
  await page.goto(`/admin/venues/venue-public?orgId=${ORG_ID}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Public Hall' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit venue' })).toHaveAttribute('href', `/admin/venues/venue-public/edit?orgId=${ORG_ID}`);
  await expect(page.getByRole('link', { name: 'Edit location' })).toHaveAttribute('href', `/admin/venues/venue-public/edit?orgId=${ORG_ID}#venue-location`);
  await expect(page.getByRole('link', { name: 'Edit public page' })).toHaveAttribute('href', `/admin/venues/venue-public/edit?orgId=${ORG_ID}#venue-visibility`);

  const events = page.getByRole('region', { name: 'Events at this venue' });
  await expect(events.getByRole('link', { name: /Spring Expo/ })).toHaveAttribute('href', `/admin/events/evt-next?orgId=${ORG_ID}`);
  await expect(events.getByRole('list', { name: /Past and cancelled/ }).getByText('Winter Swap')).toBeVisible();
  // Venue wall clock with its zone (spec 033).
  await expect(events.getByText(/E[DS]T$/).first()).toBeVisible();

  // Venues with events cannot be deleted.
  await expect(page.getByRole('button', { name: 'Delete venue' })).toBeDisabled();

  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations).toEqual([]);
});

test('editor saves the venue and returns to its details page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { patches } = await mockVenueApi(page);
  await page.goto(`/admin/venues/venue-private/edit?orgId=${ORG_ID}`);

  await expect(page.getByRole('button', { name: 'Save changes' }).first()).toBeDisabled();
  await page.getByLabel(/^Name/).fill('Renamed Private Hall');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await expect(page).toHaveURL(/\/admin\/venues\/venue-private\?/);
  await expect(page.getByRole('heading', { level: 1, name: 'Renamed Private Hall' })).toBeVisible();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  // A derived zone is sent as null so the address keeps deciding it (spec 033).
  expect(patches[0]).toMatchObject({ name: 'Renamed Private Hall', timezone: null });
});

test('creates a venue with a logo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVenueApi(page);
  await page.goto(`/admin/venues/new?orgId=${ORG_ID}`);

  await page.getByLabel(/^Name/).fill('Created Hall');
  await page.getByLabel(/^Street address/).fill('3 Created Way');
  await page.locator('#venue-logo input[type=file]').setInputFiles({
    name: 'venue.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgo=', 'base64'),
  });
  await expect(page.getByRole('img', { name: 'venue logo preview' })).toBeVisible();
  // Phones save from the sticky bar.
  await page.getByRole('button', { name: 'Create venue' }).last().click();
  await expect(page).toHaveURL(/\/admin\/venues\/venue-created\?/);
  await expect(page.getByText('Venue created.')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('deletes a venue without events from its details page', async ({ page }) => {
  await mockVenueApi(page);
  await page.goto(`/admin/venues/venue-private?orgId=${ORG_ID}`);
  await page.getByRole('button', { name: 'Delete venue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete venue' });
  await expect(dialog.getByRole('button', { name: 'Keep venue' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete venue' }).click();
  await expect(page).toHaveURL(/\/admin\/venues\?/);
  await expect(page.getByText('Private Hall deleted.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private Hall' })).toHaveCount(0);
});
