// Public RSVP form on a phone (spec 034): an RSVP event renders the inline
// form instead of tiers, the fields fit a 375px viewport, and a double-tapped
// submit fires exactly one POST. Backend mocked — CI runs this with no API.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const EVENT_ID = 'evt-rsvp';
const ORG_ID = 'org-rsvp';

const rsvpEvent = {
  id: EVENT_ID,
  name: 'Neighbourhood Open House',
  description: 'Come say hello.',
  logoUrl: null,
  date: '2026-12-12T00:00:00Z',
  capacity: 0,
  status: 'PUBLISHED',
  admissionMode: 'RSVP',
  rsvpLimit: 50,
  rsvpMaxPartySize: 4,
  rsvpRemaining: 12,
  taxRate: 0,
  organizationId: ORG_ID,
  organizationName: 'Riverside Collective',
  organizationLogoUrl: null,
  organizationBrandColor: null,
  organizationThemeMode: 'LIGHT',
  venue: { id: 'v1', name: 'Riverside Hall', address: '1 Main St', timezone: 'America/New_York', isPublic: true },
  priceTiers: [],
  addOns: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Mocks the event page's backend calls; returns the RSVP bodies it received. */
async function mockEvent(page: Page, overrides: Record<string, unknown> = {}) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json({ ...rsvpEvent, ...overrides })));
  await page.route(`${API}/legal/versions`, (route) => route.fulfill(json({ terms: '2026-01-01', privacy: '2026-01-01' })));
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (route) => route.fulfill(json({ main: [], footer: [] })));

  const submissions: unknown[] = [];
  await page.route(`${API}/events/${EVENT_ID}/rsvps`, async (route) => {
    submissions.push(route.request().postDataJSON());
    // Hold the response open long enough that a second tap would land while
    // the first is still in flight, the way it does on a slow phone.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });
  return submissions;
}

test.describe('public RSVP form on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows the RSVP form instead of tiers and keeps every control on screen', async ({ page }) => {
    await mockEvent(page);
    await page.goto(`/events/${EVENT_ID}`);

    await expect(page.getByRole('heading', { name: 'RSVP', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tickets' })).toHaveCount(0);
    await expect(page.getByText('12 spots left')).toBeVisible();

    const submit = page.locator('#rsvp-form button[type="submit"]');
    await expect(submit).toHaveText('RSVP');
    for (const control of [
      page.getByLabel('First name *'),
      page.getByLabel('Last name *'),
      page.getByLabel('Email *'),
      page.getByLabel('Party size'),
      submit,
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      // Nothing may overflow the 375px viewport horizontally.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    // Tap targets stay thumb-sized.
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('a double-tapped submit sends one RSVP and confirms once', async ({ page }) => {
    const submissions = await mockEvent(page);
    await page.goto(`/events/${EVENT_ID}`);

    await page.getByLabel('First name *').fill('Rita');
    await page.getByLabel('Last name *').fill('Guest');
    await page.getByLabel('Email *').fill('rita@example.test');
    await page.getByLabel('Party size').selectOption('2');

    const submit = page.locator('#rsvp-form button[type="submit"]');
    await submit.click();
    // The button disables itself and relabels for the round trip, so the
    // second tap is a no-op rather than a second RSVP.
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText('Sending…');
    await submit.click({ force: true });

    await expect(page.getByRole('heading', { name: "You're on the list!" })).toBeVisible();
    await expect(page.getByText('We sent a confirmation to rita@example.test')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      firstName: 'Rita',
      lastName: 'Guest',
      email: 'rita@example.test',
      partySize: 2,
      marketing: false,
    });
  });

  test('a full event offers no form at all', async ({ page }) => {
    await mockEvent(page, { rsvpRemaining: 0 });
    await page.goto(`/events/${EVENT_ID}`);

    await expect(page.getByText('RSVPs are full')).toBeVisible();
    await expect(page.locator('#rsvp-form')).toHaveCount(0);
  });
});
