// Add a venue while creating an event: the setup wizard's "Where is it?" step
// (spec 050) opens the venue flyout, which posts to the venues API; the new
// venue joins the select and is chosen, with no page change. (Before 050-P
// this ran on the old create form's "+ Add new venue…" option.)
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-qv';
const expect = baseExpect.configure({ timeout: 15000 });
const COLD = { timeout: 60000 };

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const existingVenue = { id: 'venue-1', name: 'Old Hall', address: '1 Old St', timezone: 'America/New_York' };

async function mockApi(page: Page, venues: Array<Record<string, unknown>>, post?: (body: Record<string, unknown>) => ReturnType<typeof json>) {
  let created: Record<string, unknown> | null = null;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Quick Venue Org', slug: 'qv', status: 'ACTIVE' }])));
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      created = body;
      if (post) return route.fulfill(post(body));
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

const main = (page: Page) => page.locator('main');

/** Step 1 → step 2 of the create wizard. */
async function openVenueStep(page: Page) {
  await page.goto('/admin/events/new');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Name your event' })).toBeVisible(COLD);
  await main(page).getByLabel('Event name').fill('Spring Fair');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Where is it?' })).toBeVisible(COLD);
}

test.beforeEach(async ({ page, baseURL }) => {
  test.setTimeout(120000);
  await signInAsStaff(page, { id: 'qv-admin', email: 'qv-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('creates a venue from the venue step and selects it', async ({ page }) => {
  const getCreated = await mockApi(page, [existingVenue]);
  await openVenueStep(page);

  const select = main(page).getByLabel('Venue', { exact: true });
  await expect(select).toHaveValue('');

  await main(page).getByRole('button', { name: 'New venue' }).click();
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
  // placeholder + existing + created
  await expect(select.locator('option')).toHaveCount(3);
  await expect(main(page).getByText(/venue's time zone: Chicago/)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/events\/new\?step=venue$/);
});

test('an empty venue list offers "Add a venue" in place of the select', async ({ page }) => {
  const getCreated = await mockApi(page, []);
  await openVenueStep(page);
  await expect(main(page).getByLabel('Venue', { exact: true })).toHaveCount(0);

  await main(page).getByRole('button', { name: 'Add a venue' }).click();
  const dialog = page.getByTestId('venue-flyout');
  await dialog.getByLabel('Name *').fill('First Hall');
  await dialog.getByLabel('Street address *').fill('1 First St');
  await dialog.getByRole('button', { name: 'Create venue' }).click();

  await expect.poll(getCreated).toMatchObject({ name: 'First Hall' });
  await expect(main(page).getByLabel('Venue', { exact: true })).toHaveValue('venue-new');
});

test('shows the API error and keeps the dialog open', async ({ page }) => {
  await mockApi(page, [existingVenue], () =>
    json({ error: 'ValidationError', message: 'Timezone must be a valid IANA timezone (e.g., America/New_York)' }, 400)
  );
  await openVenueStep(page);
  await main(page).getByRole('button', { name: 'New venue' }).click();
  const dialog = page.getByTestId('venue-flyout');
  await dialog.getByLabel('Name *').fill('Bad TZ');
  await dialog.getByLabel('Street address *').fill('1 Nowhere');
  await dialog.getByRole('button', { name: 'Create venue' }).click();

  await expect(dialog.getByRole('alert')).toContainText('valid IANA timezone');
  await expect(dialog).toBeVisible();
  await expect(main(page).getByLabel('Venue', { exact: true })).toHaveValue('');
});
