// Cancelling a paid event (spec 054-C): the dialog shows what cancelling
// touches, offers refund-everyone (only with orders.refund) or handle-it-
// yourself, previews the buyer email, and only cancels once the event name
// is typed. A cancelled event's Overview shows the refund progress and every
// failed refund with Retry and Mark handled. Mocked API, axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-cancel';
const EVENT_ID = 'evt-cancel';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
const venue = { id: 'venue-1', name: 'Convention Center', address: '1 Main St', timezone: 'America/New_York' };

const baseEvent = {
  id: EVENT_ID, slug: 'pixel-fair', name: 'Pixel Fair', description: null, logoUrl: null, date: future, capacity: 100, category: null,
  status: 'PUBLISHED', salesClosed: false, admissionMode: 'TICKETED', rsvpLimit: null, rsvpMaxPartySize: 1, rsvpRemaining: null,
  tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false, venue,
  priceTiers: [
    { id: 't-ga', name: 'GA', price: 20, quantityTotal: 100, quantitySold: 3, quantityReserved: 0, quantityAvailable: 97, description: null, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC', isRefundable: false, saleStatus: 'ON_SALE' },
  ],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};
const overviewOf = (event: Record<string, unknown>) => ({
  event,
  money: { gross: 66, orgReceives: 60, refunded: 0, net: 66, tickets: { orders: 3, gross: 66 }, applications: { orders: 0, gross: 0 } },
  tickets: { issued: 3, checkedIn: 0, voided: 0 },
  rsvp: null,
  addOns: { addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } },
  applications: { forms: [] },
  map: null,
});
const PREVIEW = { status: 'PUBLISHED', admissionMode: 'TICKETED', orders: 3, tickets: 4, collected: 66, openCheckouts: 1, vendorsPaid: 0, rsvps: 0 };
const failedItem = { id: 'item-broke', orderId: 'ord-3', orderRef: 'ORD-3', buyer: 'Pat Lee', email: 'pat@example.com', amount: 22, error: 'Insufficient funds in Stripe account', attempts: 3 };
const cancellation = (over: Record<string, unknown> = {}) => ({
  id: 'canc-1', mode: 'REFUND_ALL', message: null, createdAt: '2026-10-13T20:00:00Z', completedAt: '2026-10-13T20:05:00Z',
  total: 3, counts: { pending: 0, refunded: 2, skipped: 0, failed: 1 }, refundedTotal: 44, failed: [failedItem], ...over,
});

async function mockApi(page: Page, { granted = ['*'], status = 'PUBLISHED' }: { granted?: string[]; status?: string } = {}) {
  const calls: { cancel: Request[]; email: Request[]; retry: Request[]; handled: Request[] } = { cancel: [], email: [], retry: [], handled: [] };
  const state = { status, item: 'FAILED' as 'FAILED' | 'PENDING' | 'SKIPPED' };
  const base = `${API}/organizations/${ORG_ID}/events/${EVENT_ID}`;
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Cancel Org', status: 'ACTIVE' }])));
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted, hiddenPaths: [] })));
  await page.route(`${base}/overview`, (route) => route.fulfill(json(overviewOf({ ...baseEvent, status: state.status }))));
  await page.route(`${base}/cancellation-preview`, (route) => route.fulfill(json(PREVIEW)));
  await page.route(`${base}/cancellation-preview/email`, (route) => {
    calls.email.push(route.request());
    return route.fulfill(json({ subject: 'Event Cancelled — Pixel Fair (ORD-SAMPLE)', html: '<p>Refunded $52.50 to the card you paid with.</p>' }));
  });
  await page.route(`${base}/cancel`, (route) => {
    calls.cancel.push(route.request());
    state.status = 'CANCELLED';
    return route.fulfill(json({ ...baseEvent, status: 'CANCELLED' }));
  });
  await page.route(`${base}/cancellation`, (route) =>
    route.fulfill(json({
      cancellation:
        state.item === 'FAILED'
          ? cancellation()
          : state.item === 'PENDING'
            ? cancellation({ completedAt: null, counts: { pending: 1, refunded: 2, skipped: 0, failed: 0 }, failed: [] })
            : cancellation({ counts: { pending: 0, refunded: 2, skipped: 1, failed: 0 }, failed: [] }),
    }))
  );
  await page.route(`${base}/cancellation/items/item-broke/retry`, (route) => {
    calls.retry.push(route.request());
    state.item = 'PENDING';
    return route.fulfill(json({ cancellation: cancellation({ completedAt: null, counts: { pending: 1, refunded: 2, skipped: 0, failed: 0 }, failed: [] }) }));
  });
  await page.route(`${base}/cancellation/items/item-broke/handled`, (route) => {
    calls.handled.push(route.request());
    state.item = 'SKIPPED';
    return route.fulfill(json({ cancellation: cancellation({ counts: { pending: 0, refunded: 2, skipped: 1, failed: 0 }, failed: [] }) }));
  });
  return calls;
}

const serious = async (page: Page, scope: string) =>
  (await new AxeBuilder({ page }).include(scope).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));
const openDialog = async (page: Page) => {
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pixel Fair' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'More actions for Pixel Fair' }).click();
  await page.getByRole('menuitem', { name: /Cancel event/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Pixel Fair?' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test.use({ contextOptions: { reducedMotion: 'reduce' } });
test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'cancel-admin', email: 'cancel-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('the dialog counts what is sold, previews the email, and cancels with refunds once the name is typed', async ({ page }) => {
  const calls = await mockApi(page);
  const dialog = await openDialog(page);
  const summary = dialog.getByTestId('cancel-event-summary');
  await expect(summary).toContainText('3 paid orders · 4 tickets · $66.00 collected');
  await expect(summary).toContainText('1 open checkout will be closed');
  await expect(dialog.getByRole('radio', { name: /Refund every order now/ })).toBeChecked();
  expect(await serious(page, '[role="dialog"]')).toEqual([]);

  await dialog.getByLabel(/Note to buyers/).fill('The venue flooded.');
  await dialog.getByRole('button', { name: 'Preview the buyer email' }).click();
  await expect(dialog.getByText('Subject: Event Cancelled — Pixel Fair (ORD-SAMPLE)')).toBeVisible();
  await expect(dialog.frameLocator('iframe[title="Buyer email preview"]').getByText('Refunded $52.50')).toBeVisible();
  expect(calls.email[0].postDataJSON()).toEqual({ mode: 'REFUND_ALL', message: 'The venue flooded.' });

  const confirm = dialog.getByRole('button', { name: 'Cancel and refund everyone' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type Pixel Fair to confirm').fill('pixel fair');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  expect(calls.cancel).toHaveLength(1);
  expect(calls.cancel[0].postDataJSON()).toEqual({ mode: 'REFUND_ALL', message: 'The venue flooded.' });
  await expect(page.getByRole('status').filter({ hasText: 'Event cancelled. Refunds have started.' })).toBeVisible();
});

test('without the refund permission only "handle refunds myself" is offered; Keep event changes nothing', async ({ page }) => {
  const calls = await mockApi(page, { granted: ['events', 'events.cancel', 'dashboard'] });
  const dialog = await openDialog(page);
  await expect(dialog.getByRole('radio', { name: /Refund every order now/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /handle refunds myself/ })).toBeChecked();
  await expect(dialog.getByText("You don't have permission to refund orders.", { exact: false })).toBeVisible();
  await dialog.getByLabel('Type Pixel Fair to confirm').fill('Pixel Fair');
  await expect(dialog.getByRole('button', { name: 'Cancel event' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Keep event' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.cancel).toHaveLength(0);
});

test('a cancelled event shows its refunds; a failed one can be retried or marked handled', async ({ page }) => {
  const calls = await mockApi(page, { status: 'CANCELLED' });
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  const panel = page.getByTestId('cancellation-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('Refunded 2 of 3 orders · $44.00');
  await expect(panel.getByRole('progressbar', { name: 'Refunds' })).toHaveAttribute('aria-valuetext', '3 of 3 handled');
  const row = panel.getByTestId('cancellation-failed-item-broke');
  await expect(row).toContainText('ORD-3');
  await expect(row).toContainText('Insufficient funds in Stripe account');
  expect(await serious(page, '[data-testid="cancellation-panel"]')).toEqual([]);

  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(panel).toContainText('1 waiting');
  await expect(panel.getByRole('heading', { name: 'Refunding orders' })).toBeVisible();
  expect(calls.retry).toHaveLength(1);
});

test('Mark handled settles a failed refund', async ({ page }) => {
  const calls = await mockApi(page, { status: 'CANCELLED' });
  await page.goto(`/admin/events/${EVENT_ID}?orgId=${ORG_ID}`);
  const panel = page.getByTestId('cancellation-panel');
  await panel.getByTestId('cancellation-failed-item-broke').getByRole('button', { name: 'Mark handled' }).click();
  await expect(panel.getByTestId('cancellation-failed-item-broke')).toHaveCount(0);
  await expect(panel).toContainText('1 not refunded');
  expect(calls.handled).toHaveLength(1);
});
