// Account › Security › Devices (spec 030 D): list, log out one, log out all
// others, current-device log out lands on sign-in, revoked API session
// signs this browser out.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const sessions = [
  { id: 'sess-me', current: true, device: { type: 'desktop', os: 'macOS', browser: 'Chrome', label: 'macOS · Chrome' }, provider: 'google', createdAt: iso(3_600_000), lastSeenAt: iso(30_000), location: { city: 'Raleigh', region: 'NC', country: 'US' } },
  { id: 'sess-phone', current: false, device: { type: 'mobile', os: 'iOS', browser: 'Mobile Safari', label: 'iOS · Mobile Safari' }, provider: 'resend', createdAt: iso(86_400_000 * 2), lastSeenAt: iso(3_600_000 * 5), location: null },
  { id: 'sess-old', current: false, device: { type: 'desktop', os: 'Windows', browser: 'Edge', label: 'Windows · Edge' }, provider: 'google', createdAt: iso(86_400_000 * 20), lastSeenAt: iso(86_400_000 * 3), location: { city: null, region: null, country: 'GB' } },
];

async function signIn(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'user-ada', email: 'ada@example.com', role: 'ADMIN', name: 'Ada Lovelace' }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'org-1', name: 'Analytical Engines', status: 'ACTIVE', createdAt: iso(0), updatedAt: iso(0) }]) })
  );
}

async function mockSessions(page: Page) {
  let current = sessions.map((s) => ({ ...s }));
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${API}/account/sessions`, (route) => route.fulfill(json({ sessions: current })));
  await page.route(`${API}/account/sessions/revoke-others`, (route) => {
    calls.push('revoke-others');
    const revoked = current.filter((s) => !s.current).length;
    current = current.filter((s) => s.current);
    return route.fulfill(json({ revoked }));
  });
  await page.route(`${API}/account/sessions/*`, (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const id = route.request().url().split('/').pop()!;
    calls.push(`revoke:${id}`);
    const target = current.find((s) => s.id === id);
    current = current.filter((s) => s.id !== id);
    return route.fulfill(json({ revoked: 1, current: Boolean(target?.current) }));
  });
  return { calls, get: () => current };
}

test.describe('Account › Security › Devices', () => {
  test('lists devices with this device first, labels, location and relative time', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockSessions(page);
    await page.goto('/admin/account/security');
    const rows = page.getByTestId('device-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('macOS · Chrome');
    await expect(rows.nth(0)).toContainText('This device');
    await expect(rows.nth(0)).toContainText('Raleigh, NC, US');
    await expect(rows.nth(0)).toContainText('just now');
    await expect(rows.nth(1)).toContainText('Location unavailable');
    await expect(rows.nth(1)).toContainText('5 hours ago');
    await expect(rows.nth(2)).toContainText('GB');
    await expect(rows.nth(2)).toContainText('3 days ago');
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });

  test('logs out one device after confirmation', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSessions(page);
    await page.goto('/admin/account/security');
    page.once('dialog', (d) => {
      expect(d.message()).toContain('iOS · Mobile Safari');
      d.accept();
    });
    await page.getByRole('button', { name: 'Log out iOS · Mobile Safari' }).click();
    await expect(page.getByTestId('device-row')).toHaveCount(2);
    expect(mock.calls).toEqual(['revoke:sess-phone']);
    await expect(page.getByRole('status').last()).toHaveText('iOS · Mobile Safari logged out.');
  });

  test('dismissing the confirmation changes nothing', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSessions(page);
    await page.goto('/admin/account/security');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Log out Windows · Edge' }).click();
    await expect(page.getByTestId('device-row')).toHaveCount(3);
    expect(mock.calls).toEqual([]);
  });

  test('logs out all other devices and keeps this one', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSessions(page);
    await page.goto('/admin/account/security');
    page.once('dialog', (d) => {
      expect(d.message()).toContain("stay signed in on this device");
      d.accept();
    });
    await page.getByRole('button', { name: 'Log out all other devices' }).click();
    await expect(page.getByTestId('device-row')).toHaveCount(1);
    await expect(page.getByTestId('device-row').first()).toContainText('This device');
    expect(mock.calls).toEqual(['revoke-others']);
    await expect(page.getByText("You're only signed in on this device.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out all other devices' })).toBeDisabled();
  });

  test('logging out this device signs out and lands on sign-in', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockSessions(page);
    await page.goto('/admin/account/security');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Log out this device' }).click();
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('a SESSION_REVOKED API response signs this browser out with a notice', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await page.route(`${API}/account`, (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'AuthenticationError', message: 'This session has been signed out', code: 'SESSION_REVOKED' }) })
    );
    await page.goto('/admin/account');
    await expect(page).toHaveURL(/\/auth\/signin\?reason=revoked/);
    await expect(page.getByText('This device was logged out')).toBeVisible();
  });
});
