// Event setup wizard shell and steps 1–3 (spec 050-H). Runs on the flag-on
// dev server (playwright.config.ts › PLAYWRIGHT_WIZARD_BASE_URL); every API
// call is mocked. Assertions are scoped to the form pane (<main>) or the
// preview frame: the preview repeats the event's name and date.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-setup';
const EVENT_ID = 'evt-setup';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const VENUES = [
  { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' },
  { id: 'v-barn', name: 'Red Barn', address: '9 Farm Rd', timezone: 'America/Chicago', city: 'Austin', state: 'TX' },
];

function adminEvent(patch: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: null, logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: null, category: null, status: 'DRAFT',
    admissionMode: 'TICKETED', setupStep: null, setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, taxRate: 0, organizationId: ORG_ID, organizationName: 'Setup Org',
    venue: { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York' }, priceTiers: [],
    ...patch,
  };
}

async function mockApi(page: Page, event = adminEvent()) {
  const calls: { create: Request[]; patch: Request[] } = { create: [], patch: [] };
  // Anything not mocked below answers 404, never the fixture server.
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Setup Org', slug: 'setup-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json(VENUES)));
  await page.route(`${API}/organizations/${ORG_ID}/events`, (route) => {
    calls.create.push(route.request());
    const body = route.request().postDataJSON();
    route.fulfill(json(adminEvent({ name: body.name, date: body.date }), 201));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}`, (route) => {
    calls.patch.push(route.request());
    route.fulfill(json({ ...event, ...route.request().postDataJSON() }));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event, applications: { forms: [] } }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Setup Org' }, forms: [] }))
  );
  return calls;
}

const wizardURL = () => {
  const url = process.env.PLAYWRIGHT_WIZARD_BASE_URL;
  if (!url) throw new Error('PLAYWRIGHT_WIZARD_BASE_URL is set by playwright.config.ts');
  return url;
};
test.use({ baseURL: wizardURL() });

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const preview = (page: Page) => page.frameLocator('iframe[title="Event page preview"]');

/** Keyboard only: Tab until `target` has focus. */
async function tabTo(page: Page, target: Locator, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the target');
}

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'setup-admin', email: 'setup-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('keyboard-only run of steps 1–3 creates the draft once', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/admin/events/new');
    await expect(heading(page, 'Name your event')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Step 1 of 12 — Name your event')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit' })).toBeVisible();

    const name = main(page).getByLabel('Event name');
    await tabTo(page, name);
    await page.keyboard.type('Spring Fair');
    // The preview frame shows the unsaved name.
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible({ timeout: 30000 });

    const next = page.getByRole('button', { name: 'Next' });
    await tabTo(page, next);
    await page.keyboard.press('Enter');

    await expect(heading(page, 'Where is it?')).toBeFocused();
    await expect(page.locator('[aria-live="polite"]')).toHaveText('Step 2 of 12, Where is it?');
    await expect(page).toHaveURL(/\/admin\/events\/new\?step=venue$/);
    const venue = main(page).getByLabel('Venue');
    await tabTo(page, venue);
    // Type-ahead picks the option on every platform (ArrowDown opens the list on macOS).
    await page.keyboard.type('Union');
    await expect(venue).toHaveValue('v-hall');
    await expect(main(page).getByText(/venue's time zone: (EDT|EST)/)).toBeVisible();
    await tabTo(page, next);
    await page.keyboard.press('Enter');

    await expect(heading(page, 'When is it?')).toBeFocused();
    await expect(main(page).getByText(/Time zone: (EDT|EST), New York/)).toBeVisible();
    await tabTo(page, main(page).getByLabel('Starts'));
    await page.keyboard.type('06012031');
    await page.keyboard.press('Tab');
    await page.keyboard.type('0400PM');
    await expect(main(page).getByText(/Jun 1, 2031.*4:00 PM EDT at the venue/)).toBeVisible();

    await tabTo(page, next);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/events/${EVENT_ID}/setup\\?step=description$`));
    await expect(heading(page, 'Describe it')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save & exit' })).toBeVisible();

    expect(calls.create).toHaveLength(1);
    const create = calls.create[0];
    expect(create.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.postDataJSON()).toEqual({
      setup: true, name: 'Spring Fair', venueId: 'v-hall', date: '2031-06-01T20:00:00.000Z', admissionMode: 'TICKETED',
    });
  });

  test('a failed Next focuses the error summary, which links to the field', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/events/new');
    await expect(heading(page, 'Name your event')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Next' }).click();

    const summary = main(page).getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Fix 1 thing to continue');
    const name = main(page).getByLabel('Event name');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', /setup-name-error/);
    await summary.getByRole('link', { name: 'Enter a name for your event' }).click();
    await expect(name).toBeFocused();
    // Fixing the field clears its error live; Next then moves on.
    await name.fill('Spring Fair');
    await expect(summary).toHaveCount(0);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Where is it?')).toBeFocused();
  });

  test('the date step refuses an end before the start', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/events/new?venueId=v-barn');
    await expect(heading(page, 'Name your event')).toBeVisible({ timeout: 30000 });
    await main(page).getByLabel('Event name').fill('Barn Dance');
    await page.getByRole('button', { name: 'Next' }).click();
    // ?venueId= preselected the venue.
    await expect(main(page).getByLabel('Venue')).toHaveValue('v-barn');
    await page.getByRole('button', { name: 'Next' }).click();
    await main(page).getByLabel('Starts').fill('2031-06-01T18:00');
    await main(page).getByRole('button', { name: 'Add end time' }).click();
    await expect(main(page).getByLabel('Ends (optional)')).toBeFocused();
    await main(page).getByLabel('Ends (optional)').fill('2031-06-01T17:00');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(main(page).getByRole('alert')).toBeFocused();
    await expect(main(page).getByRole('alert')).toContainText('End time must be after the start time');
  });

  test('refresh resumes from the session draft, then from setupStep', async ({ page }) => {
    await mockApi(page, adminEvent({ setupStep: 'tickets' }));
    await page.goto('/admin/events/new');
    await expect(heading(page, 'Name your event')).toBeVisible({ timeout: 30000 });
    await main(page).getByLabel('Event name').fill('Spring Fair');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Where is it?')).toBeVisible();
    await page.goto('/admin/events/new');
    await expect(heading(page, 'Where is it?')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(main(page).getByLabel('Event name')).toHaveValue('Spring Fair');

    await page.goto(`/admin/events/${EVENT_ID}/setup`);
    await expect(page).toHaveURL(/step=tickets$/, { timeout: 30000 });
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible();
  });

  test('the preview toggles between phone and desktop', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=name`);
    const pane = page.getByRole('region', { name: 'Live preview of the event page' });
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible({ timeout: 30000 });
    const frame = pane.locator('iframe');
    await expect(frame).toHaveCSS('width', '390px');
    await pane.getByRole('radio', { name: 'Desktop' }).click();
    await expect(pane.getByRole('radio', { name: 'Desktop' })).toHaveAttribute('aria-checked', 'true');
    await expect(frame).toHaveCSS('width', '1280px');
    // A saved draft autosaves the name shown in the preview.
    const calls = await mockApi(page);
    await main(page).getByLabel('Event name').fill('Summer Fair');
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Summer Fair' })).toBeVisible();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0].postDataJSON()).toEqual({ name: 'Summer Fair' });
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page);
      await page.goto('/admin/events/new');
      await expect(heading(page, 'Name your event')).toBeVisible({ timeout: 30000 });
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(preview(page).getByRole('heading', { level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(main(page).getByRole('alert')).toBeVisible();
      expect(await serious(page)).toEqual([]);
      for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no scroll at ${width}`).toBe(true);
      }
    });
  }
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('preview and step menu open in sheets that trap and return focus', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=venue`);
    await expect(heading(page, 'Where is it?')).toBeVisible({ timeout: 30000 });

    const sheet = page.getByRole('dialog', { name: 'Live preview of the event page' });
    await expect(sheet).toBeHidden();
    const eye = page.getByRole('button', { name: 'Show preview' });
    await eye.click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('radio', { name: 'Phone' })).toBeFocused();
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(eye).toBeFocused();

    const menuButton = page.getByRole('button', { name: 'Setup steps' });
    await menuButton.click();
    const menu = page.getByRole('dialog', { name: 'Setup steps' });
    const nav = menu.getByRole('navigation', { name: 'Jump to edit' });
    await expect(nav.getByRole('link', { name: 'Where is it?' })).toBeFocused();
    await expect(nav.getByRole('link', { name: /Name your event.*Completed/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await menu.getByRole('link', { name: /When is it\?/ }).click();
    await expect(heading(page, 'When is it?')).toBeFocused();
    await expect(page).toHaveURL(/step=date$/);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings and no horizontal scroll (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page);
      await page.goto(`/admin/events/${EVENT_ID}/setup?step=date`);
      await expect(heading(page, 'When is it?')).toBeVisible({ timeout: 30000 });
      if (scheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await serious(page)).toEqual([]);
      await page.getByRole('button', { name: 'Show preview' }).click();
      await expect(preview(page).getByRole('heading', { level: 1 })).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await page.keyboard.press('Escape');
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no scroll at ${width}`).toBe(true);
      }
    });
  }
});
