// RSVP event page (spec 034): the admission pass. The description renders
// inline, the form posts the party size and legal acceptances, and the pass
// is stamped in place on success. The API is mocked; no backend needed.

import { expect, test, type Page } from '@playwright/test';
import { LEGAL_VERSIONS, mockLegalVersions } from './helpers/legal';

const API = 'http://localhost:3002';
const EVENT_ID = 'e2e-rsvp-pass-event';

function rsvpEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    name: 'Retro Market',
    description: '<p>Seventy vendors and a <strong>free-play arcade</strong>.</p>',
    logoUrl: null,
    date: '2030-10-26T16:00:00.000Z',
    capacity: 500,
    category: 'Market',
    status: 'PUBLISHED',
    admissionMode: 'RSVP',
    rsvpLimit: 50,
    rsvpMaxPartySize: 4,
    rsvpRemaining: 6,
    taxRate: 0,
    organizationId: 'org-rsvp',
    organizationName: 'Retro Gamers',
    organizationThemeMode: 'LIGHT',
    venue: { id: 'venue-1', name: 'Town Center', address: '5959 Triangle Town Blvd', timezone: 'America/New_York' },
    priceTiers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function mockEvent(page: Page, event = rsvpEvent()) {
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(event) })
  );
  await mockLegalVersions(page, API);
}

test('RSVP pass: inline description, scarcity, party size, stamped confirmation', async ({ page }) => {
  await mockEvent(page);
  let posted: any = null;
  await page.route(`${API}/events/${EVENT_ID}/rsvps`, (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  await page.goto(`/events/${EVENT_ID}`);

  const pass = page.locator('#rsvp-pass');
  await expect(pass.getByRole('heading', { name: 'Free admission' })).toBeVisible({ timeout: 30000 });
  await expect(pass.getByTestId('rsvp-availability')).toHaveText('Only 6 spots left');
  // The description sits on the page; there is no "Event Information" dialog in RSVP mode.
  await expect(page.getByRole('heading', { name: 'About this event' })).toBeVisible();
  await expect(page.locator('.jump-prose:visible strong')).toHaveText('free-play arcade');
  await expect(page.getByRole('button', { name: 'Event Information' })).toHaveCount(0);

  await pass.getByLabel('First name').fill('Sam');
  await pass.getByLabel('Last name').fill('Rivera');
  await pass.getByLabel('Email', { exact: true }).fill('sam@example.com');
  await pass.getByRole('button', { name: 'More guests' }).click();
  await pass.getByRole('button', { name: 'More guests' }).click();
  await pass.getByRole('button', { name: 'Reserve 3 spots' }).click();

  await expect(pass.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
  await expect(pass.getByTestId('rsvp-availability')).toHaveText('Admit 3');
  await expect(pass.getByText('Sam Rivera + 2 guests')).toBeVisible();
  await expect(pass.getByRole('button', { name: 'Add to calendar' })).toBeVisible();

  expect(posted).toMatchObject({ firstName: 'Sam', lastName: 'Rivera', email: 'sam@example.com', partySize: 3, marketing: false });
  expect(posted.acceptances.map((a: { version: string }) => a.version)).toEqual([LEGAL_VERSIONS.terms, LEGAL_VERSIONS.privacy]);
});

test('RSVP pass: party size never exceeds the spots left', async ({ page }) => {
  await mockEvent(page, rsvpEvent({ rsvpRemaining: 2 }));
  await page.goto(`/events/${EVENT_ID}`);

  const pass = page.locator('#rsvp-pass');
  const more = pass.getByRole('button', { name: 'More guests' });
  await expect(more).toBeVisible({ timeout: 30000 });
  await more.click();
  await expect(pass.locator('#rsvp-party-size')).toHaveText('2');
  await expect(more).toBeDisabled();
});

test('RSVP pass: full event shows the closed pass and no form', async ({ page }) => {
  await mockEvent(page, rsvpEvent({ rsvpRemaining: 0 }));
  await page.goto(`/events/${EVENT_ID}`);

  const pass = page.locator('#rsvp-pass');
  await expect(pass.getByRole('heading', { name: 'RSVPs are full' })).toBeVisible({ timeout: 30000 });
  await expect(pass.locator('form')).toHaveCount(0);
});
