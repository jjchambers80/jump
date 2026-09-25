import { expect, test } from '@playwright/test';

// Layout invariants for /organizations/[orgId]: one cover element, a labelled
// events section, a responsive grid, equal-height cards and no overflow.
// The page is client-rendered from GET /organizations/:id/public, which is
// mocked here, so the spec needs no backend.

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 834, height: 1112 };
const DESKTOP = { width: 1440, height: 900 };

const COVER =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#6b21a8"/></svg>');

function event(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    name,
    date: '2026-10-17T23:00:00.000Z',
    venue: { id: 'v1', name: 'Boxcar Bar + Arcade', address: '330 W Davie St', timezone: 'America/New_York' },
    category: 'Tournament',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    priceRange: { min: 15, max: 45 },
    availableTickets: 62,
    ...overrides,
  };
}

const ORG_ID = 'org-layout';

async function mockOrg(
  page: import('@playwright/test').Page,
  events: unknown[],
  coverUrl: string | null = COVER
) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: {
          id: ORG_ID,
          name: 'Raleigh Retro Gamers',
          logoUrl: null,
          coverUrl,
          brandColor: '#6b21a8',
          themeMode: 'LIGHT',
        },
        events,
      }),
    })
  );
}

const FIVE = [
  event('ev-1', 'Summer Arcade Invitational'),
  event('ev-2', 'Cartridge Swap & Retro Flea Market', {
    admissionMode: 'RSVP',
    priceRange: null,
    availableTickets: 300,
  }),
  event('ev-3', 'Pinball League Night #7', { priceRange: { min: 10, max: 10 }, availableTickets: 7 }),
  // Sold out: still gets a CTA slot so the grid row stays aligned.
  event('ev-4', 'CRT LAN Party Lock-In', { availableTickets: 0 }),
  event('ev-5', 'Speedrun Showcase'),
];

/** Distinct x positions of the cards = how many grid columns are rendered. */
async function columnCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const xs = [...document.querySelectorAll('[data-testid^="event-card-ev-"]')].map((el) =>
      Math.round(el.getBoundingClientRect().x)
    );
    return new Set(xs).size;
  });
}

test('events grid goes one, two, then three columns', async ({ page }) => {
  await mockOrg(page, FIVE);

  await page.setViewportSize(MOBILE);
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('event-card-ev-1')).toBeVisible();
  expect(await columnCount(page)).toBe(1);

  await page.setViewportSize(TABLET);
  expect(await columnCount(page)).toBe(2);

  await page.setViewportSize(DESKTOP);
  expect(await columnCount(page)).toBe(3);
});

test('cards in the same grid row share a bottom edge', async ({ page }) => {
  await mockOrg(page, FIVE);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('event-card-ev-1')).toBeVisible();

  // ev-1..ev-3 form the first row at three columns; ev-4 is sold out and has no
  // purchase CTA, so it is the one that used to end short.
  const bottoms = await page.evaluate(() =>
    ['ev-1', 'ev-2', 'ev-3'].map((id) => {
      const el = document.querySelector(`[data-testid="event-card-${id}"]`)!;
      return Math.round(el.getBoundingClientRect().bottom);
    })
  );
  expect(new Set(bottoms).size).toBe(1);

  const soldOutRow = await page.evaluate(() =>
    ['ev-4', 'ev-5'].map((id) => {
      const el = document.querySelector(`[data-testid="event-card-${id}"]`)!;
      return Math.round(el.getBoundingClientRect().bottom);
    })
  );
  expect(new Set(soldOutRow).size).toBe(1);
  await expect(page.getByTestId('event-card-ev-4')).toContainText('Sold Out');
});

test('heading order runs h1 then h2 then h3 with no skipped level', async ({ page }) => {
  await mockOrg(page, FIVE);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByRole('heading', { name: 'Upcoming events', level: 2 })).toBeVisible();

  const levels = await page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3')].map((h) => Number(h.tagName[1]))
  );
  expect(levels[0]).toBe(1);
  // Never jump more than one level deeper than the previous heading.
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }
});

test('the cover is a single element and never overflows', async ({ page }) => {
  await mockOrg(page, FIVE);

  for (const viewport of [MOBILE, TABLET, DESKTOP]) {
    await page.setViewportSize(viewport);
    await page.goto(`/organizations/${ORG_ID}`);
    await expect(page.getByRole('img', { name: 'Raleigh Retro Gamers cover' })).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth === document.documentElement.clientWidth
      )
    ).toBe(true);
  }
});

test('no cover still renders the events section', async ({ page }) => {
  await mockOrg(page, FIVE, null);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/organizations/${ORG_ID}`);

  await expect(page.getByRole('img', { name: 'Raleigh Retro Gamers cover' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Upcoming events', level: 2 })).toBeVisible();
  await expect(page.getByTestId('event-card-ev-1')).toBeVisible();
});

test('an organization with no events gets an empty state, not an empty grid', async ({ page }) => {
  await mockOrg(page, []);
  await page.setViewportSize(MOBILE);
  await page.goto(`/organizations/${ORG_ID}`);

  await expect(page.getByRole('heading', { name: 'No upcoming events' })).toBeVisible();
  await expect(page.getByText('Check back later for new events from Raleigh Retro Gamers.')).toBeVisible();
});
