// Spec 042: Online store › Messages inbox for contact-form messages. Backend mocked.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-messages';

const base = {
  phone: null,
  page: { id: 'pg-contact', title: 'Contact' },
  emailedAt: '2026-10-01T11:00:00.000Z',
  emailError: null,
};
const INQUIRIES = [
  { ...base, id: 'm2', name: 'Grace Hopper', email: 'grace@example.com', subject: 'Parking', message: 'Is there parking\nnear the venue?', readAt: null, createdAt: '2026-10-01T11:00:00.000Z', emailError: 'refused' },
  { ...base, id: 'm1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100', subject: 'Booths', message: 'Power at the booths?', readAt: '2026-10-01T10:30:00.000Z', createdAt: '2026-10-01T10:00:00.000Z' },
];

async function mockApi(page: Page) {
  const inquiries = INQUIRIES.map((item) => ({ ...item }));
  const calls: { method: string; url: string; body?: unknown }[] = [];
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: ORG_ID, name: 'Messages Org', slug: 'messages-org', status: 'ACTIVE', createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z' }]),
    })
  );
  await page.route(`${API}/admin/contact-inquiries?*`, (route) => {
    const url = new URL(route.request().url());
    calls.push({ method: 'GET', url: url.toString() });
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = inquiries
      .filter((item) => url.searchParams.get('status') !== 'unread' || !item.readAt)
      .filter((item) => !q || `${item.name} ${item.email} ${item.subject} ${item.message}`.toLowerCase().includes(q));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        inquiries: list,
        unreadCount: inquiries.filter((item) => !item.readAt).length,
        pagination: { page: 1, limit: 25, total: list.length, totalPages: 1 },
      }),
    });
  });
  await page.route(`${API}/admin/contact-inquiries/*`, (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const item = inquiries.find((entry) => entry.id === id)!;
    calls.push({ method: request.method(), url: request.url(), body: request.postDataJSON?.() });
    if (request.method() === 'DELETE') {
      inquiries.splice(inquiries.indexOf(item), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    const { read } = request.postDataJSON() as { read: boolean };
    item.readAt = read ? '2026-10-01T12:00:00.000Z' : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(item) });
  });
  return { calls };
}

test('reads a message, marks it read, replies by email and deletes it', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  const api = await mockApi(page);
  await page.goto('/admin/online-store/messages');

  await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible();
  await expect(page.getByTestId('messages-header')).toContainText('1 unread.');
  const list = page.getByRole('region', { name: 'Message list' });
  await expect(list.getByRole('button')).toHaveCount(4); // 2 filters + 2 messages
  await expect(page.getByTestId('message-detail')).toContainText('Select a message to read it.');

  await list.getByRole('button', { name: /Grace Hopper/ }).click();
  const detail = page.getByTestId('message-detail');
  await expect(detail.getByRole('heading', { name: 'Parking' })).toBeVisible();
  await expect(detail).toContainText('Is there parking\nnear the venue?');
  await expect(detail).toContainText('from Contact');
  await expect(detail).toContainText('could not be emailed');
  await expect(detail.getByRole('link', { name: 'Reply' })).toHaveAttribute(
    'href',
    'mailto:grace%40example.com?subject=Re%3A%20Parking'
  );
  await expect(page.getByTestId('messages-header')).toContainText('0 unread.');
  expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ read: true });

  await detail.getByRole('button', { name: 'Mark unread' }).click();
  await expect(page.getByTestId('messages-header')).toContainText('1 unread.');

  page.once('dialog', (dialog) => void dialog.accept());
  await detail.getByRole('button', { name: 'Delete' }).click();
  await expect(list.getByRole('button', { name: /Grace Hopper/ })).toHaveCount(0);
  expect(api.calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/m2'))).toBe(true);
});

test('filters unread and searches; organizers cannot delete', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'org', email: 'org@test.com', role: 'ORGANIZER' }, baseURL!);
  await mockApi(page);
  await page.goto('/admin/online-store/messages');
  const list = page.getByRole('region', { name: 'Message list' });

  await list.getByRole('button', { name: 'Unread' }).click();
  await expect(list.getByRole('button', { name: /Grace Hopper/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Ada Lovelace/ })).toHaveCount(0);

  await list.getByRole('button', { name: 'All' }).click();
  await list.getByLabel('Search messages').fill('booths');
  await list.getByLabel('Search messages').press('Enter');
  await expect(list.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Grace Hopper/ })).toHaveCount(0);

  await list.getByRole('button', { name: /Ada Lovelace/ }).click();
  await expect(page.getByTestId('message-detail').getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('on a phone the open message replaces the list', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  await mockApi(page);
  await page.goto('/admin/online-store/messages');
  const list = page.getByRole('region', { name: 'Message list' });
  await list.getByRole('button', { name: /Ada Lovelace/ }).click();
  await expect(list).toBeHidden();
  await expect(page.getByTestId('message-detail').getByRole('heading', { name: 'Booths' })).toBeVisible();
  await page.getByRole('button', { name: 'All messages' }).click();
  await expect(list).toBeVisible();
});
