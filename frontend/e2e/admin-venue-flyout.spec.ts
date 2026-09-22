// Add a venue from the event form: the "+ Add new venue…" option in the venue
// select opens the flyout, which posts to the venues API; the new venue is
// appended to the select and chosen, with no page change.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-qv';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const existingVenue = { id: 'venue-1', name: 'Old Hall', address: '1 Old St' };

async function mockApi(page: Page, venues: Array<{ id: string; name: string; address: string }>) {
  let created: Record<string, unknown> | null = null;
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Quick Venue Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      created = body;
      return route.fulfill(
        json(
          {
            id: 'venue-new',
            organizationId: ORG_ID,
            name: body.name,
            address: body.address,
            city: body.city ?? null,
            state: body.state ?? null,
            postalCode: body.postalCode ?? null,
            timezone: body.timezone ?? 'America/New_York',
            isPublic: true,
          },
          201
        )
      );
    }
    return route.fulfill(json(venues));
  });
  return () => created;
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'qv-admin', email: 'qv-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('creates a venue from the event form and selects it', async ({ page }) => {
  const getCreated = await mockApi(page, [existingVenue]);
  await page.goto('/admin/events/new');
  await expect(page.getByRole('heading', { name: 'Create Event' })).toBeVisible();

  const select = page.getByLabel('Venue *');
  await expect(select).toHaveValue('');

  await select.selectOption('__new_venue__');
  const dialog = page.getByTestId('venue-flyout');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name *').fill('  Raleigh Convention Center ');
  await dialog.getByLabel('Street address *').fill('500 S Salisbury St');
  await dialog.getByLabel('City').fill('Raleigh');
  await dialog.getByLabel('State').selectOption('NC');
  await dialog.getByLabel('Postal code').fill('27601');
  await dialog.getByLabel('URL slug').fill('Raleigh Convention Center');
  await dialog.getByLabel(/Public venue page/).uncheck();
  // Spec 033: the zone is derived from the address and shown as text. A North
  // Carolina ZIP resolves to Eastern without the organizer touching anything.
  await expect(dialog.getByTestId('venue-flyout-timezone-resolved')).toContainText('New York');
  // "Change" reveals the picker for the rare case the derivation is wrong.
  await dialog.getByRole('button', { name: 'Change' }).click();
  await dialog.getByLabel('Time zone').selectOption('America/Chicago');
  await expect(dialog.getByTestId('venue-flyout-timezone-resolved')).toContainText('Chicago');
  await dialog.getByRole('button', { name: 'Create venue' }).click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(getCreated).toMatchObject({
    name: 'Raleigh Convention Center',
    address: '500 S Salisbury St',
    city: 'Raleigh',
    state: 'NC',
    postalCode: '27601',
    slug: 'raleigh-convention-center',
    timezone: 'America/Chicago',
    isPublic: false,
  });
  await expect(select).toHaveValue('venue-new');
  // placeholder + existing + created + "add new"
  await expect(select.locator('option')).toHaveCount(4);
  await expect(page).toHaveURL(/\/admin\/events\/new$/);
});

test('empty venue list offers the flyout from the select itself', async ({ page }) => {
  const getCreated = await mockApi(page, []);
  await page.goto('/admin/events/new');
  const select = page.getByLabel('Venue *');
  await expect(select.locator('option')).toHaveCount(2);

  await select.selectOption('__new_venue__');
  const dialog = page.getByTestId('venue-flyout');
  await dialog.getByLabel('Name *').fill('First Hall');
  await dialog.getByLabel('Street address *').fill('1 First St');
  await dialog.getByRole('button', { name: 'Create venue' }).click();

  await expect.poll(getCreated).toMatchObject({ name: 'First Hall' });
  await expect(page.getByLabel('Venue *')).toHaveValue('venue-new');
});

test('shows the API error and keeps the dialog open', async ({ page }) => {
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Quick Venue Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill(json({ error: 'ValidationError', message: 'Timezone must be a valid IANA timezone (e.g., America/New_York)' }, 400));
    }
    return route.fulfill(json([existingVenue]));
  });
  await page.goto('/admin/events/new');
  await page.getByLabel('Venue *').selectOption('__new_venue__');
  const dialog = page.getByTestId('venue-flyout');
  await dialog.getByLabel('Name *').fill('Bad TZ');
  await dialog.getByLabel('Street address *').fill('1 Nowhere');
  await dialog.getByRole('button', { name: 'Create venue' }).click();

  await expect(dialog.getByRole('alert')).toContainText('valid IANA timezone');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Venue *')).toHaveValue('');
});
