// Event create / edit layout: content on the left, settings in the right-hand
// aside from `xl` up, one column with a sticky save bar below it. Fields in the
// aside sit outside the <form> element and join it through the `form` attribute,
// so native `required` checks must still block a submit.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-layout';
const EVENT_ID = 'evt-layout';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const venue = { id: 'venue-1', name: 'Test Hall', address: '1 Main St', timezone: 'America/New_York' };

async function mockApi(page: Page, eventOverrides: Record<string, unknown> = {}) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const event = {
    id: EVENT_ID,
    name: 'Layout Test Event',
    description: 'A fixture for the two-column layout.',
    date: future.toISOString(),
    capacity: 200,
    category: 'Music',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    logoUrl: null,
    venue,
    tax: { rate: 0.0725, source: 'MANUAL', region: 'NC' },
    priceTiers: [
      { id: 'tier-ga', name: 'General Admission', price: 25, description: null, quantityTotal: 150, quantitySold: 0, quantityReserved: 0, displayOrder: 0, minPerOrder: null, maxPerOrder: null, isActive: true, isRefundable: true, saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC' },
    ],
    ...eventOverrides,
  };
  const posts: string[] = [];
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Layout Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/events?limit=100`, (route) => route.fulfill(json({ events: [event] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([venue])));
  await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons/presets`, (route) => route.fulfill(json({ presets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/add-ons`, (route) => route.fulfill(json({ addOns: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events`, (route) => {
    if (route.request().method() === 'POST') posts.push(route.request().url());
    return route.fulfill(json({ id: 'evt-new' }, 201));
  });
  return posts;
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'layout-admin', email: 'layout-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('desktop: settings aside sits to the right of the content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);

  const details = page.getByRole('region', { name: 'Event Details' });
  const aside = page.getByRole('complementary', { name: 'Event settings' });
  await expect(details).toBeVisible();
  await expect(page.getByLabel('Venue *')).toHaveValue(venue.id);

  const main = (await details.boundingBox())!;
  const side = (await aside.boundingBox())!;
  expect(side.x).toBeGreaterThan(main.x + main.width);
  expect(main.width).toBeGreaterThan(side.width * 1.5);
  await expect(aside.getByRole('button', { name: 'Save Changes' })).toBeVisible();

  // The save card stays pinned while the content column scrolls.
  await page.evaluate(() => document.querySelector('main')!.scrollTo(0, 99999));
  await expect(aside.getByRole('button', { name: 'Save Changes' })).toBeInViewport();
});

test('mobile: one column, sticky save bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);

  const details = page.getByRole('region', { name: 'Event Details' });
  const aside = page.getByRole('complementary', { name: 'Event settings' });
  await expect(details).toBeVisible();
  const main = (await details.boundingBox())!;
  const side = (await aside.boundingBox())!;
  expect(side.y).toBeGreaterThan(main.y);

  // The aside's save card is hidden; the bar's button is the only one exposed.
  await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeInViewport();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});

test('create: aside fields still block submit through the form attribute', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts = await mockApi(page);
  await page.goto(`/admin/events/new?orgId=${ORG_ID}`);

  await page.getByLabel('Name *').fill('Layout Test Event');
  await page.getByLabel('Venue *').selectOption(venue.id);
  await page.getByRole('button', { name: 'Create Event' }).click();

  // Date & Time and Capacity are required and empty: the browser refuses the submit.
  const dateValid = await page.getByLabel('Date & Time *').evaluate((el) => (el as HTMLInputElement).validity.valid);
  expect(dateValid).toBe(false);
  expect(posts).toHaveLength(0);
});

test('admission mode is a keyboard radio group', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events/new?orgId=${ORG_ID}`);

  const group = page.getByRole('group', { name: 'Admission mode' });
  await expect(group.getByRole('radio', { name: 'Ticketed' })).toBeChecked();
  await group.getByRole('radio', { name: 'Ticketed' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'RSVP' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Limit RSVPs' })).toBeVisible();
  await expect(page.getByLabel('Guests per RSVP')).toBeVisible();
  await expect(page.getByLabel('Capacity *')).toHaveCount(0);
});

test('tier reorder buttons meet the 24px target size (WCAG 2.5.8)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);

  for (const name of ['Move General Admission up', 'Move General Admission down']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

test('media card sits under the description and holds the event image', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);

  const details = page.getByRole('region', { name: 'Event Details' });
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByRole('button', { name: 'Upload new' })).toBeVisible();
  const d = (await details.boundingBox())!;
  const m = (await media.boundingBox())!;
  expect(m.y).toBeGreaterThanOrEqual(d.y + d.height);
  await expect(details.getByText('Event Logo')).toHaveCount(0);
});

test('media card: an uploaded image offers replace and remove', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgGAfq3m2wAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://images.test/logo.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await mockApi(page, { logoUrl: 'https://images.test/logo.png' });
  await page.goto(`/admin/events/${EVENT_ID}/edit?orgId=${ORG_ID}`);

  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByRole('img', { name: 'Layout Test Event event image' })).toBeVisible();
  await expect(media.getByRole('button', { name: 'Replace' })).toBeVisible();
  await expect(media.getByRole('button', { name: 'Remove image' })).toBeAttached();
  await expect(media.getByRole('button', { name: 'Upload new' })).toHaveCount(0);
});
