// Contacts › Lists (spec 055-B): the Lists tab, the Create a list dialog with
// its live count, a list's page and deleting a list. Backend mocked.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG = { id: 'org-lists', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers', status: 'ACTIVE' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const builtIn = (id: string, name: string, contactCount: number, filters: object) => ({
  id,
  name,
  type: 'AUTOMATIC',
  builtIn: true,
  filters,
  contactCount,
  createdBy: null,
  createdAt: null,
  lastActivityAt: null,
});

const SAVED = {
  id: 'list-crew',
  name: 'Stage crew',
  type: 'MANUAL',
  builtIn: false,
  filters: null,
  contactCount: 2,
  createdBy: { id: 'u1', name: 'Jamie Staff' },
  createdAt: '2026-10-01T12:00:00.000Z',
  lastActivityAt: '2026-10-10T12:00:00.000Z',
};

const CONTACT = {
  id: 'c-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  sources: ['tickets'],
  formSources: [],
  transactionCount: 1,
  totalSpent: 120,
  lastActivityAt: '2026-10-09T12:00:00.000Z',
};

async function mockApi(page: Page, baseURL: string, { granted }: { granted?: string[] } = {}) {
  await signInAsStaff(page, { id: 'lists-admin', email: 'lists-admin@test.com', role: granted ? 'ORGANIZER' : 'ADMIN' }, baseURL);
  const state = {
    lists: [
      builtIn('builtin:all', 'All contacts', 73, {}),
      builtIn('builtin:paying', 'Paying contacts', 41, { scope: 'customers' }),
      builtIn('builtin:subscribers', 'Email subscribers', 12, { source: 'subscribed' }),
      SAVED,
    ] as Record<string, unknown>[],
  };
  const calls: { method: string; path: string; search: string; body?: unknown }[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData() as string) : undefined;
    calls.push({ method, path, search: url.search, body });
    if (path === '/organizations') return route.fulfill(json([ORG]));
    if (path === '/admin/permissions') {
      return granted ? route.fulfill(json({ granted, hiddenPaths: [] })) : route.fulfill(json({}, 404));
    }
    if (path === '/admin/events') return route.fulfill(json({ events: [{ id: 'ev-spring', name: 'Spring Market' }] }));
    if (path === '/admin/standing-application-forms') return route.fulfill(json({ data: [] }));
    if (path === '/admin/contact-lists' && method === 'GET') return route.fulfill(json({ lists: state.lists }));
    if (path === '/admin/contact-lists/preview') {
      return route.fulfill(json({ count: body?.filters?.ticketEventId ? 18 : 73, sample: [] }));
    }
    if (path === '/admin/contact-lists' && method === 'POST') {
      const created = {
        ...body,
        id: 'list-new',
        builtIn: false,
        contactCount: 18,
        createdBy: { id: 'lists-admin', name: 'Lists Admin' },
        createdAt: '2026-10-12T12:00:00.000Z',
        lastActivityAt: '2026-10-12T12:00:00.000Z',
        filterWarnings: [],
      };
      state.lists = [...state.lists, created];
      return route.fulfill(json(created, 201));
    }
    const one = path.match(/^\/admin\/contact-lists\/([^/]+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]);
      if (method === 'DELETE') {
        state.lists = state.lists.filter((list) => list.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      const list = state.lists.find((entry) => entry.id === id);
      return list ? route.fulfill(json({ ...list, filterWarnings: [] })) : route.fulfill(json({ message: 'List not found' }, 404));
    }
    if (path === '/admin/customers') {
      return route.fulfill(json({ data: [CONTACT], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }));
    }
    return route.fulfill(json({}));
  });
  return calls;
}

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`${viewport.name}: the Lists tab shows built-in and saved lists and passes axe`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    await mockApi(page, baseURL!);
    await page.goto('/admin/contacts/lists');

    const tabs = page.getByRole('navigation', { name: 'Contacts sections' });
    await expect(tabs.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'All contacts' }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stage crew' }).locator('visible=true')).toBeVisible();

    await page.getByRole('button', { name: 'Manual', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Manual', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'All contacts' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Manual', exact: true }).click();

    await page.getByLabel('Search lists').fill('crew');
    await expect(page.getByRole('link', { name: 'Paying contacts' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Stage crew' }).locator('visible=true')).toBeVisible();

    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  });
}

test('creates an automatic list with a live count, from the keyboard', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts/lists');

  const newList = page.getByRole('button', { name: 'New list' });
  await newList.click();
  const dialog = page.getByRole('dialog', { name: 'Create a list' });
  await expect(dialog.getByRole('radio', { name: /Automatic list/ })).toBeFocused();
  await expect(dialog.getByRole('radio', { name: /Automatic list/ })).toBeChecked();

  // Arrow keys move between the two cards; Escape closes and focus returns to New list.
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('radio', { name: /Manual list/ })).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('radio', { name: /Automatic list/ })).toBeChecked();
  page.once('dialog', (confirm) => confirm.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(newList).toBeFocused();

  await newList.click();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByLabel('List name')).toBeFocused();
  await expect(dialog.getByText('73 contacts match right now')).toBeVisible();

  await dialog.getByLabel('List name').fill('Spring buyers');
  await dialog.getByLabel('Bought tickets to').selectOption('ev-spring');
  await expect(dialog.getByText('18 contacts match right now')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);

  await dialog.getByRole('button', { name: 'Create list' }).click();
  await expect(page).toHaveURL(/\/admin\/contacts\/lists\/list-new$/);
  expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/contact-lists')?.body).toEqual({
    name: 'Spring buyers',
    type: 'AUTOMATIC',
    filters: { ticketEventId: 'ev-spring' },
  });

  // The list's page: its name, plain-words filters and its contacts through ?list=
  await expect(page.getByRole('heading', { level: 1, name: 'Spring buyers' })).toBeVisible();
  await expect(page.getByText('Bought tickets to Spring Market')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeVisible();
  await expect
    .poll(() => calls.some((c) => c.path === '/admin/customers' && new URLSearchParams(c.search).get('list') === 'list-new'))
    .toBe(true);
});

test('a list page links back with its filters and deletes the list without touching contacts', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = await mockApi(page, baseURL!);
  await page.goto('/admin/contacts/lists/list-crew');

  await expect(page.getByRole('heading', { level: 1, name: 'Stage crew' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/admin/contacts/c-ada?list=list-crew');
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'More actions for Stage crew' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete “Stage crew”?' });
  await expect(confirm).toContainText('Its 2 contacts stay in Contacts');
  await confirm.getByRole('button', { name: 'Delete list' }).click();

  await expect(page).toHaveURL(/\/admin\/contacts\/lists$/);
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/admin/contact-lists/list-crew')).toBe(true);
  await expect(page.getByRole('link', { name: 'Stage crew' })).toHaveCount(0);
});

test('built-in lists open but cannot be renamed or deleted', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, baseURL!);
  await page.goto('/admin/contacts/lists/builtin%3Aall');

  await expect(page.getByRole('heading', { level: 1, name: 'All contacts' })).toBeVisible();
  await expect(page.getByText('Automatically created')).toBeVisible();
  await expect(page.getByRole('button', { name: /Rename|Edit list/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions for All contacts' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
});

test('without customers.lists there is no New list and the menus only open', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, baseURL!, { granted: ['dashboard', 'customers'] });
  await page.goto('/admin/contacts/lists');

  await expect(page.getByRole('link', { name: 'Stage crew' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New list' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions for Stage crew' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible();
});
