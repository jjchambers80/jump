// Contacts › Lists members (spec 055-C): select contacts and add them to a
// manual list (or every match, or a new list), remove them on the list's page,
// and the Lists card on a contact. Backend mocked.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG = { id: 'org-members', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers', status: 'ACTIVE' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const contact = (id: string, firstName: string, lastName: string) => ({
  id,
  firstName,
  lastName,
  email: `${firstName.toLowerCase()}@example.com`,
  sources: ['tickets'],
  formSources: [],
  transactionCount: 1,
  totalSpent: 40,
  lastActivityAt: '2026-10-09T12:00:00.000Z',
});
const ADA = contact('c-ada', 'Ada', 'Lovelace');
const GRACE = contact('c-grace', 'Grace', 'Hopper');

const manualList = (id: string, name: string, contactCount: number) => ({
  id,
  name,
  type: 'MANUAL',
  builtIn: false,
  filters: null,
  contactCount,
  createdBy: { id: 'u1', name: 'Jamie Staff' },
  createdAt: '2026-10-01T12:00:00.000Z',
  lastActivityAt: '2026-10-10T12:00:00.000Z',
  filterWarnings: [],
});
const CREW = manualList('list-crew', 'Stage crew', 2);
const VIPS = manualList('list-vips', 'VIPs', 0);

const DETAIL = {
  ...ADA,
  phone: null,
  location: null,
  note: null,
  emailSubscribed: false,
  emailSubscribedAt: null,
  emailSubscribedSource: null,
  emailUnsubscribedAt: null,
  accountCreatedAt: null,
  lastSignInAt: null,
  accountUrl: null,
  tags: [],
  createdAt: '2025-01-01T12:00:00.000Z',
  ticketOrderCount: 1,
  applicationCount: 0,
  totalRefunded: 0,
  prevId: null,
  nextId: null,
  orders: [],
  applications: [],
  rsvps: [],
  upcomingTickets: [],
};

async function mockApi(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'members-admin', email: 'members-admin@test.com', role: 'ADMIN' }, baseURL);
  const state = { memberships: [{ id: 'list-crew', name: 'Stage crew' }] };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData() as string) : undefined;
    calls.push({ method, path, body });
    if (path === '/organizations') return route.fulfill(json([ORG]));
    if (path === '/admin/permissions') return route.fulfill(json({}, 404));
    if (path === '/admin/contact-lists' && method === 'GET') return route.fulfill(json({ lists: [CREW, VIPS] }));
    if (path === '/admin/contact-lists' && method === 'POST') {
      return route.fulfill(json({ ...manualList('list-new', body.name, 0) }, 201));
    }
    const members = path.match(/^\/admin\/contact-lists\/([^/]+)\/members$/);
    if (members && method === 'POST') {
      const added = body.contactIds ? body.contactIds.length : 45;
      return route.fulfill(json({ added, alreadyOn: 0 }));
    }
    if (members && method === 'DELETE') {
      state.memberships = state.memberships.filter((m) => m.id !== members[1]);
      return route.fulfill(json({ removed: body.contactIds.length }));
    }
    const one = path.match(/^\/admin\/contact-lists\/([^/]+)$/);
    if (one) return route.fulfill(json([CREW, VIPS].find((list) => list.id === one[1]) ?? {}));
    if (path === '/admin/customers') {
      return route.fulfill(json({ data: [ADA, GRACE], pagination: { page: 1, limit: 20, total: 45, totalPages: 3 } }));
    }
    if (path === `/admin/customers/${ADA.id}/lists`) return route.fulfill(json({ lists: state.memberships }));
    if (path === `/admin/customers/${ADA.id}/timeline`) return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === `/admin/customers/${ADA.id}`) return route.fulfill(json(DETAIL));
    return route.fulfill(json({}));
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('selects contacts and adds them to a manual list', async ({ page, baseURL }) => {
  const calls = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts');

  await page.getByRole('checkbox', { name: 'Select Ada Lovelace' }).check();
  await page.getByRole('checkbox', { name: 'Select Grace Hopper' }).check();
  const bar = page.getByRole('region', { name: 'Selected contacts' });
  await expect(bar).toContainText('2 selected');
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);

  await bar.getByRole('button', { name: 'Add to list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add 2 contacts to a list' });
  await expect(dialog.getByLabel('List')).toHaveValue('list-crew');
  await dialog.getByLabel('List').selectOption('list-vips');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Add to list' }).click();

  await expect(page.getByTestId('toast')).toHaveText('Added 2 contacts to VIPs');
  await expect(bar).toHaveCount(0);
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/contact-lists/list-vips/members')?.body).toEqual({
    contactIds: ['c-ada', 'c-grace'],
  });
});

test('selects every match and adds them to a new list', async ({ page, baseURL }) => {
  const calls = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts?source=tickets');

  await page.getByRole('checkbox', { name: 'Select every contact on this page' }).check();
  const bar = page.getByRole('region', { name: 'Selected contacts' });
  await bar.getByRole('button', { name: 'Select all 45 matching' }).click();
  await expect(bar).toContainText('All 45 matching contacts selected');

  await bar.getByRole('button', { name: 'Add to list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add 45 contacts to a list' });
  await dialog.getByLabel('List').selectOption('__new');
  await expect(dialog.getByLabel('New list name')).toBeFocused();
  await dialog.getByLabel('New list name').fill('Ticket buyers');
  await dialog.getByRole('button', { name: 'Add to list' }).click();

  await expect(page.getByTestId('toast')).toHaveText('Added 45 contacts to Ticket buyers');
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/contact-lists')?.body).toEqual({ name: 'Ticket buyers', type: 'MANUAL' });
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/contact-lists/list-new/members')?.body).toEqual({
    query: { source: 'tickets', scope: 'all' },
  });
});

test("a list's Add contacts preselects it; its page removes people", async ({ page, baseURL }) => {
  const calls = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts/lists/list-vips');
  await page.getByRole('link', { name: 'Add contacts' }).click();
  await expect(page).toHaveURL(/\/admin\/contacts\?addTo=list-vips$/);

  await page.getByRole('checkbox', { name: 'Select Grace Hopper' }).check();
  await page.getByRole('region', { name: 'Selected contacts' }).getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByRole('dialog', { name: 'Add 1 contact to a list' }).getByLabel('List')).toHaveValue('list-vips');
  await page.keyboard.press('Escape');

  await page.goto('/admin/contacts/lists/list-crew');
  await page.getByRole('checkbox', { name: 'Select Ada Lovelace' }).check();
  const bar = page.getByRole('region', { name: 'Selected contacts' });
  // Removing works on picked rows only.
  await expect(bar.getByRole('button', { name: /Select all/ })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Removed 1 contact from the list');
  expect(calls.find((c) => c.method === 'DELETE' && c.path === '/admin/contact-lists/list-crew/members')?.body).toEqual({
    contactIds: ['c-ada'],
  });
});

test('the Lists card on a contact shows, removes and adds', async ({ page, baseURL }) => {
  const calls = await mockApi(page, baseURL!);
  await page.goto(`/admin/contacts/${ADA.id}`);

  const card = page.getByRole('list', { name: 'Lists Ada Lovelace is on' });
  await expect(card.getByRole('link', { name: 'Stage crew' })).toHaveAttribute('href', '/admin/contacts/lists/list-crew');
  await card.getByRole('button', { name: 'Remove Ada Lovelace from Stage crew' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Removed from Stage crew');
  await expect(page.getByText('Not on any manual list.')).toBeVisible();
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/admin/contact-lists/list-crew/members')).toBe(true);

  await page.getByRole('button', { name: 'Add to list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add 1 contact to a list' });
  await dialog.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Added 1 contact to Stage crew');
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/contact-lists/list-crew/members')?.body).toEqual({
    contactIds: ['c-ada'],
  });
});

test('phone: cards carry their own checkbox and the selection bar fits', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, baseURL!);
  await page.goto('/admin/contacts');
  await page.getByRole('checkbox', { name: 'Select Ada Lovelace' }).check();
  await expect(page.getByRole('region', { name: 'Selected contacts' })).toContainText('1 selected');
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
