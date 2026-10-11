// Event setup wizard entry points and the Done screen (spec 050-I): "Start
// from a past event" on step 1, "Continue setup" on the events list, and Done.
// Every API call is mocked, with a catch-all 404.
// Assertions are scoped to <main> or the dialog: the preview repeats names.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-entry';
const SOURCE_ID = 'evt-last-year';
const COPY_ID = 'evt-copy';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// The source venue is in Chicago, not the default zone: the new date must be read there.
const BARN = { id: 'v-barn', name: 'Red Barn', address: '9 Farm Rd', timezone: 'America/Chicago', city: 'Austin', state: 'TX' };

function adminEvent(patch: Record<string, unknown> = {}) {
  return {
    id: COPY_ID, slug: 'harvest-fair-2031', name: 'Harvest Fair 2031', description: null, logoUrl: null,
    date: '2031-05-01T15:00:00.000Z', endDate: null, capacity: 200, category: null, status: 'DRAFT',
    admissionMode: 'TICKETED', setupStep: 'date', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, taxRate: 0, organizationId: ORG_ID, organizationName: 'Entry Org',
    venue: { id: BARN.id, name: BARN.name, address: BARN.address, timezone: BARN.timezone }, priceTiers: [],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', rsvpGoingCount: 0,
    ...patch,
  };
}

const SOURCE = adminEvent({ id: SOURCE_ID, slug: 'harvest-fair', name: 'Harvest Fair', date: '2026-05-02T15:00:00.000Z', status: 'PUBLISHED', setupStep: null, setupCompletedAt: '2026-01-01T00:00:00Z' });
const OTHER = adminEvent({ id: 'evt-gala', slug: 'gala', name: 'Winter Gala', date: '2026-01-10T01:00:00.000Z', status: 'PUBLISHED', setupStep: null, setupCompletedAt: '2026-01-01T00:00:00Z' });

const STORE = 'https://shop.harvest.example';

async function mockApi(page: Page, copy = adminEvent(), forms: { id: string }[] = []) {
  const calls: { duplicate: Request[]; list: URL[] } = { duplicate: [], list: [] };
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Entry Org', slug: 'entry-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([BARN])));
  await page.route(`${API}/organizations/${ORG_ID}/events?*`, (route) => {
    const url = new URL(route.request().url());
    calls.list.push(url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const all = url.searchParams.get('sort') === 'date_desc' ? [SOURCE, OTHER] : [copy, SOURCE];
    const events = all.filter((e) => e.name.toLowerCase().includes(q));
    route.fulfill(json({ events, pagination: { page: 1, limit: 25, total: events.length, totalPages: 1 } }));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/summary*`, (route) =>
    route.fulfill(json({ counts: { all: 2, DRAFT: 1, PUBLISHED: 1, CANCELLED: 0 }, published: { count: 1, capacity: 200 }, drafts: { count: 1 }, registered: { tickets: 0, rsvps: 0 }, inventory: { available: 0, tiers: 0 }, categories: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${SOURCE_ID}/duplicate`, (route) => {
    calls.duplicate.push(route.request());
    route.fulfill(json(copy, 201));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${COPY_ID}`, (route) => route.fulfill(json({ ...copy, ...route.request().postDataJSON() })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${COPY_ID}/overview`, (route) => route.fulfill(json({ event: copy, publicUrl: `${STORE}/events/${copy.slug}`, applications: { forms } })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${COPY_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event: copy, organization: { id: ORG_ID, name: 'Entry Org' }, forms: [] }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${COPY_ID}/preview-link`, (route) =>
    route.fulfill(json({ url: 'http://localhost/api/events/preview?token=signed', expiresAt: '2031-01-01T00:00:00Z' }))
  );
  return calls;
}

const COLD = { timeout: 30000 };
const STAFF = { id: 'entry-admin', email: 'entry-admin@test.com', role: 'ADMIN' as const };

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

// Compile every route this spec visits once, before any test times a step change.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage({ baseURL: BASE_URL });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page);
  for (const path of ['/admin/events/new', `/admin/events/${COPY_ID}/setup?step=date`, `/admin/events?orgId=${ORG_ID}`]) {
    await page.goto(path, { timeout: 120000 });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 120000 });
  }
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

/** Review (050-N) marks the event finished in this tab before it opens Done. */
const finishedInThisTab = (page: Page) =>
  page.addInitScript((id) => window.sessionStorage.setItem(`jump:event-setup-done:${id}`, '1'), COPY_ID);
const FINISHED = { setupStep: 'review', setupCompletedAt: '2026-10-10T00:00:00Z' };

async function openPastEventDialog(page: Page) {
  await page.goto('/admin/events/new');
  await expect(heading(page, 'Name your event')).toBeVisible(COLD);
  await main(page).getByRole('button', { name: 'Start from a past event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start from a past event' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('start from a past event copies it into setup at the date step', async ({ page }) => {
    const calls = await mockApi(page);
    const dialog = await openPastEventDialog(page);

    // Escape closes and returns focus to the opener.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Start from a past event' })).toBeFocused();
    await main(page).getByRole('button', { name: 'Start from a past event' }).click();

    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await expect(dialog.getByRole('status')).toHaveText('2 events');
    await dialog.getByRole('button', { name: 'Copy and continue' }).click();
    await expect(dialog.getByText('Choose the event to copy')).toBeVisible();
    // Focus goes to the first invalid field: the event list.
    await expect(dialog.getByRole('radio').first()).toBeFocused();
    expect(calls.duplicate).toHaveLength(0);

    await dialog.getByLabel('Search your events').fill('harv');
    await expect(dialog.getByRole('radio')).toHaveCount(1);
    await expect(dialog.getByRole('status')).toHaveText('1 event');
    expect(calls.list.at(-1)?.searchParams.get('q')).toBe('harv');
    await dialog.getByRole('radio', { name: /Harvest Fair/ }).check();
    await expect(dialog.getByLabel('New event name')).toHaveValue('Harvest Fair');
    await dialog.getByLabel('New event name').fill('Harvest Fair 2031');
    await dialog.getByRole('button', { name: 'Copy and continue' }).click();
    await expect(dialog.getByLabel('Starts')).toBeFocused();
    await dialog.getByLabel('Starts').fill('2031-05-01T10:00');
    await expect(dialog.getByText(/At Red Barn: CDT/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy and continue' }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/events/${COPY_ID}/setup\\?step=date$`), COLD);
    await expect(heading(page, 'When is it?')).toBeFocused(COLD);
    expect(calls.duplicate).toHaveLength(1);
    // 10:00 at the Chicago venue, not the viewer's or the default zone.
    expect(calls.duplicate[0].postDataJSON()).toEqual({ setup: true, name: 'Harvest Fair 2031', date: '2031-05-01T15:00:00.000Z' });
  });

  test('continue setup on the events list resumes at the saved step', async ({ page }) => {
    await mockApi(page, adminEvent({ setupStep: 'tickets' }));
    await page.goto(`/admin/events?orgId=${ORG_ID}`);
    const draft = main(page).locator('article', { has: page.getByRole('heading', { name: 'Harvest Fair 2031' }) });
    const link = draft.getByRole('link', { name: 'Continue setup: Harvest Fair 2031' });
    await expect(link).toBeVisible(COLD);
    await expect(draft.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    // A set-up event shows no Continue setup.
    await expect(main(page).getByRole('link', { name: /Continue setup: Harvest Fair$/ })).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${COPY_ID}/setup\\?step=tickets$`), COLD);
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
  });

  test('done: a published event offers the page, the share link and Go to event', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockApi(page, adminEvent({ status: 'PUBLISHED', ...FINISHED }));
    await finishedInThisTab(page);
    await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
    await expect(heading(page, 'Your event is live')).toBeFocused(COLD);
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    // The storefront host from the server, never the admin origin.
    await expect(main(page).getByRole('link', { name: /View the event page/ })).toHaveAttribute('href', `${STORE}/events/harvest-fair-2031`);
    await expect(main(page).getByRole('link', { name: /Set up door check-in/ })).toHaveAttribute('href', `/admin/events/${COPY_ID}/check-in`);
    await expect(main(page).getByRole('link', { name: 'Go to event' })).toHaveAttribute('href', `/admin/events/${COPY_ID}`);
    await main(page).getByRole('button', { name: 'Copy the share link' }).click();
    await expect(main(page).getByRole('status')).toHaveText('Link copied to the clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${STORE}/events/harvest-fair-2031`);
  });

  test('done: a clipboard failure shows the link in an error', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await mockApi(page, adminEvent({ status: 'PUBLISHED', ...FINISHED }));
    await finishedInThisTab(page);
    await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
    await expect(heading(page, 'Your event is live')).toBeFocused(COLD);
    await main(page).getByRole('button', { name: 'Copy the share link' }).click();
    await expect(main(page).getByRole('alert')).toHaveText(`Couldn't copy the link. Copy it from here: ${STORE}/events/harvest-fair-2031`);
  });

  test('done: a draft previews through the signed link and has no share link', async ({ page }) => {
    await mockApi(page, adminEvent(FINISHED), [{ id: 'form-1' }]);
    await finishedInThisTab(page);
    await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
    await expect(heading(page, 'Saved as draft')).toBeFocused(COLD);
    await expect(main(page).getByRole('link', { name: /Review applications/ })).toHaveAttribute('href', `/admin/events/${COPY_ID}/applications`);
    await expect(main(page).getByRole('link', { name: /Preview the event page/ })).toHaveAttribute('href', /preview\?token=signed$/);
    await expect(main(page).getByRole('button', { name: 'Copy the share link' })).toHaveCount(0);
  });

  test('done is not reachable before setup finishes', async ({ page }) => {
    await mockApi(page, adminEvent({ setupStep: 'date' }));
    await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
    await expect(page).toHaveURL(/step=date$/, COLD);
    await expect(heading(page, 'When is it?')).toBeVisible();
  });

  test('done in edit mode goes to the Details page', async ({ page }) => {
    // Set up earlier, not finished in this tab: edit mode.
    await mockApi(page, adminEvent({ status: 'PUBLISHED', ...FINISHED }));
    await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
    await expect(page).toHaveURL(new RegExp(`/admin/events/${COPY_ID}$`), COLD);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`past-event dialog and Done pass axe with no horizontal scroll (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page, adminEvent({ status: 'PUBLISHED', ...FINISHED }));
      await finishedInThisTab(page);
      const dialog = await openPastEventDialog(page);
      await expect(dialog.getByRole('radio')).toHaveCount(2);
      expect(await serious(page)).toEqual([]);
      const box = await dialog.getByRole('button', { name: 'Copy and continue' }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Escape');

      await page.goto(`/admin/events/${COPY_ID}/setup?step=done`);
      await expect(heading(page, 'Your event is live')).toBeFocused(COLD);
      expect(await serious(page)).toEqual([]);
      const overflow = await page.evaluate(() =>
        [document.documentElement, document.querySelector('main')].filter((el) => el && el.scrollWidth > el.clientWidth).length
      );
      expect(overflow).toBe(0);
    });
  }
});
