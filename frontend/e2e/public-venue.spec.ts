import { expect, test } from '@playwright/test';

const logoDataUrl =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="navy"/%3E%3C/svg%3E';

const venueResponse = {
  venue: {
    id: 'venue-public-1',
    name: 'Public Test Hall',
    address: '123 Main Street',
    timezone: 'America/New_York',
    logoUrl: logoDataUrl,
  },
  events: [
    {
      id: 'event-public-1',
      name: 'Opening Night',
      date: '2027-07-15T19:00:00.000Z',
      venue: { id: 'venue-public-1', name: 'Public Test Hall', address: '123 Main Street' },
      category: 'theater',
      status: 'PUBLISHED',
      priceRange: { min: 25, max: 75 },
      availableTickets: 42,
    },
  ],
};

test('shows a public venue and navigates through the full event card', async ({ page }) => {
  await page.route('http://localhost:3002/venues/venue-public-1', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(venueResponse) })
  );

  await page.goto('/venues/venue-public-1');

  await expect(page.getByTestId('venue-name')).toHaveText('Public Test Hall');
  await expect(page.getByTestId('venue-logo')).toHaveAttribute('alt', 'Public Test Hall logo');
  await expect(page.getByTestId('event-card-name-event-public-1')).toHaveText('Opening Night');
  await expect(page.getByTestId('event-card-event-public-1')).toContainText('$25.00');
  await expect(page.getByTestId('event-card-event-public-1')).toContainText('42 tickets available');

  await page.getByTestId('event-card-event-public-1').click();
  await expect(page).toHaveURL(/\/events\/event-public-1$/);
});

test('shows the stable empty state', async ({ page }) => {
  await page.route('http://localhost:3002/venues/venue-empty', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...venueResponse, venue: { ...venueResponse.venue, id: 'venue-empty' }, events: [] }),
    })
  );

  await page.goto('/venues/venue-empty');
  await expect(page.getByTestId('venue-empty-state')).toContainText('No events scheduled');
});

test('shows a customer-friendly not-found state', async ({ page }) => {
  await page.route('http://localhost:3002/venues/venue-private', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Venue not found' }) })
  );

  await page.goto('/venues/venue-private');
  await expect(page.getByTestId('venue-not-found')).toContainText('Venue Not Found');
  await expect(page.getByRole('link', { name: 'Browse Events' })).toHaveAttribute('href', '/events');
});

test('uses an accessible fallback when a venue has no logo and never overflows', async ({ page }) => {
  await page.route('http://localhost:3002/venues/venue-no-logo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...venueResponse,
        venue: { ...venueResponse.venue, id: 'venue-no-logo', name: 'Fallback Hall', logoUrl: null },
        events: [],
      }),
    })
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/venues/venue-no-logo');

  await expect(page.getByTestId('venue-logo-fallback')).toHaveAttribute(
    'aria-label',
    'Fallback Hall logo unavailable'
  );
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasOverflow).toBe(false);
});
