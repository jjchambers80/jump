import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 048: Settings › Activity log lists the active organization's audit
// trail as sentences, filters through the API, and expands a field diff.
// Backend mocked.

const API = 'http://localhost:3002';
const ORG_ID = 'org-activity';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ROW = {
  id: 'a1',
  createdAt: '2026-10-09T14:00:00.000Z',
  actor: { type: 'USER', userId: 'u1', label: 'Ada Admin', role: 'ADMIN', viaPlatformAdmin: false, clientName: null },
  action: 'event.updated',
  operation: 'UPDATE',
  feature: 'Events',
  entityType: 'Event',
  entityId: 'evt1',
  entityLabel: 'Summer Fest',
  changes: { name: ['Spring Fest', 'Summer Fest'], storefrontPasswordHash: [null, '[changed]'] },
  meta: null,
  source: 'admin',
  requestId: 'r1',
  method: 'PATCH',
  route: '/organizations/:orgId/events/:eventId',
  location: 'Raleigh, NC, US',
  device: 'macOS · Chrome',
};
const SYSTEM_ROW = {
  ...ROW,
  id: 'a2',
  actor: { type: 'SYSTEM', userId: null, label: 'Stripe', role: null, viaPlatformAdmin: false, clientName: null },
  action: 'order.updated',
  feature: 'Orders',
  entityType: 'Order',
  entityLabel: null,
  changes: { status: ['PENDING', 'COMPLETED'] },
  location: null,
  device: null,
};

async function mockApi(page: Page) {
  const queries: string[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE' }])),
  );
  await page.route(`${API}/admin/audit-log?**`, (route) => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    const rows = url.searchParams.get('feature') === 'Orders' ? [SYSTEM_ROW] : [ROW, SYSTEM_ROW];
    return route.fulfill(json({
      total: rows.length,
      offset: 0,
      limit: 50,
      rows,
      facets: { actors: [{ userId: 'u1', label: 'Ada Admin', type: 'USER' }, { userId: null, label: 'Stripe', type: 'SYSTEM' }], features: ['Events', 'Orders'] },
      retentionDays: 730,
    }));
  });
  return { queries };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'u1', email: 'ada@test.com', role: 'ADMIN' }, baseURL!);
});

test('lists activity as sentences and expands a field diff', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/settings/activity');

  await expect(page.getByRole('heading', { name: 'Activity log', level: 2 })).toBeVisible();
  const first = page.getByRole('listitem').filter({ hasText: 'Summer Fest' });
  await expect(first).toContainText('Ada Admin updated event Summer Fest');
  await expect(first).toContainText('Raleigh, NC, US');
  await expect(page.getByRole('listitem').filter({ hasText: 'Stripe' })).toContainText('System');

  await first.getByRole('button', { name: /2 changes/ }).click();
  const diff = first.getByRole('table');
  await expect(diff.getByRole('row', { name: /Name/ })).toContainText('Spring Fest');
  await expect(diff.getByRole('row', { name: /Storefront password hash/ })).toContainText('hidden');
});

test('filters by area through the API', async ({ page }) => {
  const { queries } = await mockApi(page);
  await page.goto('/admin/settings/activity');
  await expect(page.getByText('Summer Fest').first()).toBeVisible();

  await page.getByLabel('Area').selectOption('Orders');
  await expect(page.getByText('Summer Fest')).toHaveCount(0);
  expect(queries.some((q) => q.includes('feature=Orders'))).toBe(true);
});
