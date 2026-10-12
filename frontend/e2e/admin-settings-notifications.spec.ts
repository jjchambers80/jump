import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Settings › Notifications (spec 053 card C): order emails from the
// registry open in a dialog with Edit / Preview tabs, the system blocks,
// Send me a test and Reset. Backend mocked.

const API = 'http://localhost:3002';
const ORG_ID = 'org-notif';
const KEY = 'order.confirmation';

const DEFAULT = {
  key: KEY,
  label: 'Order confirmation',
  when: 'Sent to the buyer when a ticket order is paid.',
  blocks: ['Order summary: tickets, add-ons and total', 'View tickets button and how to use the QR codes'],
  mergeFields: [
    { key: 'buyer.firstName', description: 'Buyer first name' },
    { key: 'order.ref', description: 'Order reference' },
  ],
  subject: 'Order Confirmed — {{event.name}} ({{order.ref}})',
  body: 'Hi {{buyer.firstName}},\n\nYour order {{order.ref}} has been confirmed.',
  isDefault: true,
  updatedAt: null,
};

async function mockApi(page: Page) {
  let template = { ...DEFAULT };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE', createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z' }]))
  );
  await page.route(`${API}/admin/settings/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const body = req.postData() ? req.postDataJSON() : undefined;
    calls.push({ method, path, body });
    if (path === '/admin/settings/notifications') return route.fulfill(json({ groups: [{ key: 'orders', label: 'Orders & tickets', notifications: [template] }] }));
    if (path === `/admin/settings/notifications/${KEY}` && method === 'PUT') {
      template = { ...template, ...body, isDefault: false };
      return route.fulfill(json(template));
    }
    if (path === `/admin/settings/notifications/${KEY}` && method === 'DELETE') {
      template = { ...DEFAULT };
      return route.fulfill(json(template));
    }
    if (path === `/admin/settings/notifications/${KEY}/preview`) {
      return route.fulfill(json({ subject: `Rendered: ${body.subject}`, html: `<html><body><p>${body.body}</p><a>View Tickets</a></body></html>` }));
    }
    if (path === `/admin/settings/notifications/${KEY}/test`) return route.fulfill(json({ sentTo: 'admin@notif.test' }));
    if (path === '/admin/settings/application-templates') return route.fulfill(json({ data: [], mergeFields: [] }));
    if (path === '/admin/settings/application-digest') return route.fulfill(json({ enabled: true, lastRunAt: null }));
    return route.fulfill(json({ message: `unmocked ${method} ${path}` }, 404));
  });
  return { calls };
}

test.describe('Settings › Notifications', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'notif-admin', email: 'admin@notif.test', role: 'ADMIN' }, baseURL!);
  });

  test('order confirmation: edit, preview the draft, send a test, save', async ({ page }) => {
    const { calls } = await mockApi(page);
    await page.goto('/admin/settings/notifications');

    const row = page.getByRole('button', { name: 'Edit Order confirmation email' });
    await expect(row).toContainText('Order Confirmed — {{event.name}}');
    await row.click();

    const dialog = page.getByRole('dialog', { name: 'Order confirmation' });
    await expect(dialog).toContainText('Added automatically below your message');
    await expect(dialog).toContainText('View tickets button');
    await dialog.getByLabel('Message').fill('Thanks, {{buyer.firstName}}!');

    await dialog.getByRole('tab', { name: 'Preview' }).click();
    await expect(dialog.getByTestId('notification-preview-subject')).toHaveText('Rendered: Order Confirmed — {{event.name}} ({{order.ref}})');
    await expect(dialog.frameLocator('iframe').getByText('Thanks, {{buyer.firstName}}!')).toBeVisible();
    expect(calls.find((c) => c.path.endsWith('/preview'))?.body).toEqual({ subject: DEFAULT.subject, body: 'Thanks, {{buyer.firstName}}!' });

    await dialog.getByRole('button', { name: 'Send me a test' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Test sent to admin@notif.test.');

    await dialog.getByRole('tab', { name: 'Edit' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Order confirmation email saved');
    await expect(row).toContainText('Customized');
    await expect(row).toBeFocused();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ subject: DEFAULT.subject, body: 'Thanks, {{buyer.firstName}}!' });
  });

  test('a customized email resets to the default', async ({ page }) => {
    await mockApi(page);
    await page.goto('/admin/settings/notifications');
    const row = page.getByRole('button', { name: 'Edit Order confirmation email' });
    await row.click();
    const dialog = page.getByRole('dialog', { name: 'Order confirmation' });
    await dialog.getByLabel('Subject').fill('Custom');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('Customized');

    await row.click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('dialog', { name: 'Order confirmation' }).getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByRole('status')).toContainText('Order confirmation email reset');
    await expect(row).not.toContainText('Customized');
  });

  test('the dialog has no axe violations', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/settings/notifications');
    await page.getByRole('button', { name: 'Edit Order confirmation email' }).click();
    await expect(page.getByRole('dialog', { name: 'Order confirmation' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
