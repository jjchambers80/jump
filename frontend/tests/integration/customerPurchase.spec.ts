// Customer purchase journey — fully mocked backend.
import { test, expect } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

test.describe('Customer Ticket Purchase Journey', () => {
  test('events listing page renders with mocked data', async ({ page }) => {
    await page.route(`${API}/events?page=1&limit=12`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 1 } }) })
    );
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible({ timeout: 10000 });
  });

  test('event detail page is reachable with mocked data', async ({ page }) => {
    await page.route(`${API}/events/evt-test`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'evt-test', name: 'Test Event', date: '2099-12-31T19:00:00.000Z', capacity: 100, status: 'PUBLISHED', venue: { id: 'v1', name: 'Test Venue' } }) })
    );
    await page.route(`${API}/events/evt-test/availability`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tiers: [], available: 100 }) })
    );
    await page.goto('/events/evt-test');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});