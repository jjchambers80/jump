// Event lifecycle actions in the ⋯ menu (spec 050-D): Close sales… (directly
// above Cancel), Reopen sales, Unpublish… and Delete draft…. Each opens a
// confirm dialog that traps focus and returns it; an unpublish refusal lists
// its reasons in text. Mocked API, signInAsStaff, 390×844, axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-close-sales';
const EVENT_ID = 'evt-close-sales';
const DRAFT_ID = 'evt-close-draft';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
const venue = { id: 'venue-1', name: 'Convention Center', address: '1 Main St', timezone: 'America/New_York' };

const baseEvent = {
  id: EVENT_ID,
  slug: 'close-fair',
  name: 'Close Fair',
  description: null,
  logoUrl: null,
  date: future,
  capacity: 100,
  category: null,
  status: 'PUBLISHED',
  salesClosed: false,
  admissionMode: 'TICKETED',
  rsvpLimit: null,
  rsvpMaxPartySize: 1,
  rsvpRemaining: null,
  tax: { rate: 0, source: null, region: null },
  taxInclusivePricing: false,
  venue,
  priceTiers: [
    { id: 't-ga', name: 'GA', price: 20, quantityTotal: 100, quantitySold: 3, quantityReserved: 0, quantityAvailable: 97, description: null, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC', isRefundable: false, saleStatus: 'ON_SALE' },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const overviewOf = (event: Record<string, unknown>) => ({
  event,
  money: { gross: 60, orgReceives: 55, refunded: 0, net: 60, tickets: { orders: 3, gross: 60 }, applications: { orders: 0, gross: 0 } },
  tickets: { issued: 3, checkedIn: 0, voided: 0 },
  rsvp: null,
  addOns: { addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } },
  applications: { forms: [] },
  map: null,
});

async function mockApi(page: Page) {
  const state = { salesClosed: false };
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Close Org', status: 'ACTIVE' }])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json(overviewOf({ ...baseEvent, salesClosed: state.salesClosed })))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${DRAFT_ID}/overview`, (route) =>
    route.fulfill(json(overviewOf({ ...baseEvent, id: DRAFT_ID, name: 'Draft Fair', status: 'DRAFT' })))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/close-sales`, (route) => {
    state.salesClosed = true;
    return route.fulfill(json({ ...baseEvent, salesClosed: true }));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/unpublish`, (route) =>
    route.fulfill(
      json(
        { error: 'ConflictError', message: 'Cannot unpublish this event: it has 3 orders.', code: 'UNPUBLISH_BLOCKED', details: { reasons: ['3 orders'] } },
        409
      )
    )
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${DRAFT_ID}`, (route) =>
    route.request().method() === 'DELETE' ? route.fulfill(json({ deleted: true, id: DRAFT_ID })) : route.fallback()
  );
  // The events list the delete lands on
  await page.route(`${API}/organizations/${ORG_ID}/events/summary*`, (route) =>
    route.fulfill(json({
        counts: { all: 1, DRAFT: 0, PUBLISHED: 1, CANCELLED: 0 },
        published: { count: 1, capacity: 100 },
        drafts: { count: 0 },
        registered: { tickets: 3, rsvps: 0 },
        inventory: { available: 97, tiers: 1 },
        categories: [],
      }))
  );
  await page.route(`${API}/organizations/${ORG_ID}/events?*`, (route) =>
    route.fulfill(json({ events: [{ ...baseEvent, salesClosed: true }], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } }))
  );
}

// Scoped to the UI this card adds: the rest of the Details page has its own spec.
const seriousViolations = async (page: Page, scope: string) =>
  (await new AxeBuilder({ page }).include(scope).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

const menuTrigger = (page: Page, name: string) => page.getByRole('button', { name: `More actions for ${name}` });

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'close-admin', email: 'close-admin@test.com', role: 'ADMIN' }, baseURL!);
  await mockApi(page);
});

test('close sales sits above Cancel, confirms in a focus-trapped dialog and shows the pill', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Close Fair' })).toBeVisible({ timeout: 30000 });

  const trigger = menuTrigger(page, 'Close Fair');
  await trigger.click();
  const items = page.getByRole('menu').getByRole('menuitem');
  const names = await items.allInnerTexts();
  const cancelAt = names.findIndex((t) => t.includes('Cancel event'));
  expect(names[cancelAt - 1]).toContain('Close sales…');
  expect(names.some((t) => t.includes('Unpublish…'))).toBe(true);
  expect(names.some((t) => t.includes('Delete draft'))).toBe(false);

  await page.getByRole('menuitem', { name: 'Close sales…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close sales' });
  await expect(dialog).toBeVisible();
  const back = dialog.getByRole('button', { name: 'Go back' });
  const confirm = dialog.getByRole('button', { name: 'Close sales' });
  await expect(back).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused(); // trapped
  expect(await seriousViolations(page, '[role="dialog"]')).toEqual([]);

  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('region', { name: 'Close Fair' }).getByText('Sales closed')).toBeVisible();
  expect(await seriousViolations(page, 'section[aria-labelledby="event-title"]')).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: 'Sales closed. The event page stays up.' })).toBeVisible();

  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Reopen sales' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close sales…' })).toHaveCount(0);
});

test('an unpublish refusal lists its reasons in text; Escape returns focus', async ({ page }) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  const trigger = menuTrigger(page, 'Close Fair');
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Unpublish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unpublish event' });
  await dialog.getByRole('button', { name: 'Unpublish' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('This event can’t be unpublished because it has:');
  await expect(alert.getByRole('listitem')).toHaveText(['3 orders']);
  await expect(dialog.getByRole('button', { name: 'Unpublish' })).toHaveCount(0);
  expect(await seriousViolations(page, '[role="dialog"]')).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('delete draft confirms and returns to the events list, which shows the sales state', async ({ page }) => {
  await page.goto(`/admin/events/${DRAFT_ID}?orgId=${ORG_ID}`);
  await menuTrigger(page, 'Draft Fair').click();
  await expect(page.getByRole('menuitem', { name: 'Close sales…' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Delete draft…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete draft' });
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Delete draft' }).click();

  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByText('Sales closed').filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
});
