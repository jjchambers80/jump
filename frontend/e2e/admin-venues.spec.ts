import { expect, test, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL;

test.beforeEach(async ({ page }) => {
  test.skip(!adminEmail, 'Set E2E_ADMIN_EMAIL to an existing ADMIN user for venue admin coverage.');
  await page.goto('/auth/signin');
  await page.getByLabel('Email address').fill(adminEmail!);
  await page.getByRole('button', { name: /Dev Sign-In/ }).click();
  await page.waitForURL(/\/admin\/dashboard/);
});

async function mockVenueApi(page: Page) {
  let venues = [
    {
      id: 'venue-public',
      organizationId: 'org-1',
      name: 'Public Hall',
      address: '1 Public Way',
      timezone: 'America/New_York',
      isPublic: true,
      logoUrl: null,
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-01T00:00:00.000Z',
      _count: { events: 2 },
    },
    {
      id: 'venue-private',
      organizationId: 'org-1',
      name: 'Private Hall',
      address: '2 Private Way',
      timezone: 'America/New_York',
      isPublic: false,
      logoUrl: null,
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-01T00:00:00.000Z',
      _count: { events: 0 },
    },
  ];

  await page.route('http://localhost:3002/organizations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-1', name: 'Test Org', status: 'ACTIVE' }]) })
  );
  await page.route('http://localhost:3002/organizations/org-1/venues', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(venues) });
      return;
    }
    const created = { ...venues[0], id: 'venue-created', ...(route.request().postDataJSON() as object) };
    venues = [created, ...venues];
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
  });
  await page.route(/http:\/\/localhost:3002\/organizations\/org-1\/venues\/[^/]+$/, async (route) => {
    const venueId = route.request().url().split('/').pop()!;
    if (route.request().method() === 'PATCH') {
      venues = venues.map((venue) =>
        venue.id === venueId ? { ...venue, ...(route.request().postDataJSON() as object) } : venue
      );
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(venues.find((venue) => venue.id === venueId)) });
      return;
    }
    if (route.request().method() === 'DELETE') {
      venues = venues.filter((venue) => venue.id !== venueId);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.continue();
  });
  await page.route('http://localhost:3002/organizations/org-1/venues/*/logo', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logoUrl: '/uploads/logos/test.png' }) })
  );
}

test('previews and uploads a logo while creating a venue', async ({ page }) => {
  await mockVenueApi(page);
  await page.goto('/admin/venues');
  await page.getByRole('button', { name: 'Add Venue' }).click();
  await page.getByPlaceholder('Venue name').fill('Created Hall');
  await page.getByPlaceholder('Full venue address').fill('3 Created Way');
  await page.getByTestId('venue-logo-input').setInputFiles({
    name: 'venue.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgo=', 'base64'),
  });
  await expect(page.getByTestId('venue-logo-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Created Hall')).toBeVisible();
});

test('shows public links only for public venues and edits metadata', async ({ page }) => {
  await mockVenueApi(page);
  await page.goto('/admin/venues');
  await expect(page.getByRole('link', { name: 'View public page' })).toHaveCount(1);
  await page.getByText('Private Hall').locator('xpath=ancestor::div[contains(@class,"rounded-lg")]').getByRole('button', { name: 'Edit' }).click();
  await page.getByPlaceholder('Venue name').fill('Renamed Private Hall');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Renamed Private Hall')).toBeVisible();
});

test('treats a successful empty-body delete as success', async ({ page }) => {
  await mockVenueApi(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/admin/venues');
  await page.getByText('Private Hall').locator('xpath=ancestor::div[contains(@class,"rounded-lg")]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Private Hall')).toHaveCount(0);
});
