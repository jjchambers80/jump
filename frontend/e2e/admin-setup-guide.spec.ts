import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022: the onboarding checklist page, its sidebar link with a progress
// ring, and the dashboard banner that points at it.

const API = 'http://localhost:3002';

const org = {
  id: 'org-guide-1',
  name: 'Raleigh Retro Gamers',
  slug: 'raleigh-retro-gamers',
  status: 'ACTIVE',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 0, users: 1 },
};

type Guide = {
  dismissedAt: string | null;
  tasks: { id: string; done: boolean; href: string; shown: boolean; state?: string }[];
  onboarding: { goals: string[] } | null;
};

const freshGuide = (): Guide => ({
  dismissedAt: null,
  tasks: [
    { id: 'event', done: false, href: '/admin/create-event', shown: true },
    { id: 'design', done: true, href: '/admin/online-store', shown: true },
    { id: 'payments', done: false, href: '/admin/settings/payments', state: 'connect', shown: true },
    { id: 'business', done: false, href: '/admin/settings', shown: true },
    { id: 'domain', done: false, href: '/admin/settings/domains', shown: true },
    { id: 'applications', done: false, href: '/admin/events', shown: false },
  ],
  onboarding: { goals: ['sell_online'] },
});

async function mockApi(page: Page, guide: Guide) {
  const patches: unknown[] = [];
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/organizations') return json([org]);
    if (path === '/admin/setup-guide' && method === 'GET') return json(guide);
    if (path === '/admin/setup-guide' && method === 'PATCH') {
      patches.push(route.request().postDataJSON());
      guide.dismissedAt = '2027-01-02T00:00:00.000Z';
      return json({ dismissedAt: guide.dismissedAt });
    }
    if (path === '/admin/dashboard/stats') return json({ totalCapacity: 0, ticketsSold: 0, remainingCapacity: 0, ticketsRedeemed: 0, salesRate: 0, paymentSuccessRate: 100 });
    if (path === '/admin/events') return json({ events: [] });
    return json([]);
  });
  return { patches };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'guide-admin', email: 'guide-admin@test.com', role: 'ADMIN' }, baseURL!);
});

test('checklist groups the shown steps, counts them and selects the first open one', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.goto('/admin/onboarding');
  const list = page.getByRole('navigation', { name: 'Onboarding steps' });
  await expect(page.getByRole('heading', { name: 'Onboarding checklist', level: 1 })).toBeVisible();

  const store = list.getByRole('region', { name: 'Set up your store' });
  await expect(store.getByLabel('1 of 4 done')).toBeVisible();
  await expect(list.getByRole('region', { name: 'Start selling' }).getByLabel('0 of 1 done')).toBeVisible();
  await expect(page.getByTestId('setup-step-applications')).toHaveCount(0);
  await expect(page.getByTestId('setup-step-design')).toHaveAttribute('data-done', 'true');

  // business is first in list order and not done
  await expect(page.getByTestId('setup-step-business')).toHaveAttribute('aria-current', 'step');
  const detail = page.getByTestId('setup-detail-business').locator('visible=true');
  await expect(detail.getByRole('heading', { name: 'Add your business details' })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Add details' })).toHaveAttribute('href', '/admin/settings');

  await page.getByTestId('setup-step-payments').click();
  const payments = page.getByTestId('setup-detail-payments').locator('visible=true');
  await expect(payments.getByRole('heading', { name: 'Connect your Stripe account' })).toBeVisible();
  await expect(payments.getByRole('link', { name: 'Connect Stripe' })).toHaveAttribute('href', '/admin/settings/payments');

  await page.getByTestId('setup-step-design').click();
  const design = page.getByTestId('setup-detail-design').locator('visible=true');
  await expect(design.getByRole('heading', { name: 'Store design chosen' })).toBeVisible();
  await expect(design.getByText('Done')).toBeVisible();
});

test('platform payments copy when Connect is off', async ({ page }) => {
  const guide = freshGuide();
  guide.tasks = guide.tasks.map((t) => (t.id === 'payments' ? { ...t, state: 'platform' } : t));
  await mockApi(page, guide);
  await page.goto('/admin/onboarding');
  await expect(page.getByTestId('setup-step-payments')).toContainText("You're ready to accept payments");
});

test('sidebar shows the checklist link with its progress ring', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.goto('/admin/dashboard');
  const link = page.getByTestId('sidebar-onboarding');
  await expect(link).toHaveAttribute('href', '/admin/onboarding');
  await expect(link.getByRole('img', { name: '1 of 5 steps done' })).toBeVisible();

  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(link).toHaveAttribute('title', 'Onboarding checklist, 1 of 5 done');
  await expect(link.getByRole('img', { name: '1 of 5 steps done' })).toBeVisible();
});

test('dashboard banner links to the checklist', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.goto('/admin/dashboard');
  const banner = page.getByTestId('setup-guide');
  await expect(banner.getByText('1 of 5 done')).toBeVisible();
  await expect(banner.getByRole('link', { name: 'Continue setup' })).toHaveAttribute('href', '/admin/onboarding');
});

test('dismissing stamps the organization and hides the sidebar link', async ({ page }) => {
  const { patches } = await mockApi(page, freshGuide());
  await page.goto('/admin/onboarding');
  await expect(page.getByTestId('sidebar-onboarding')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss checklist' }).click();
  await expect(page.getByTestId('sidebar-onboarding')).toHaveCount(0);
  expect(patches).toEqual([{ dismissed: true }]);
});

test('a dismissed guide shows no banner and no sidebar link', async ({ page }) => {
  const guide = freshGuide();
  guide.dismissedAt = '2027-01-02T00:00:00.000Z';
  await mockApi(page, guide);
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('setup-guide')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-onboarding')).toHaveCount(0);
});

test('all done hides the link and banner; the page says so', async ({ page }) => {
  const guide = freshGuide();
  guide.tasks = guide.tasks.map((t) => ({ ...t, done: true }));
  await mockApi(page, guide);
  await page.goto('/admin/onboarding');
  await expect(page.getByText("You're all set.")).toBeVisible();
  await expect(page.getByTestId('sidebar-onboarding')).toHaveCount(0);
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('setup-guide')).toHaveCount(0);
});

test('at 375px the detail opens inside the selected row without horizontal overflow', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/onboarding');
  await page.getByTestId('setup-step-domain').click();
  const detail = page.getByTestId('setup-detail-domain').locator('visible=true');
  await expect(detail.getByRole('link', { name: 'Set up domain' })).toBeVisible();
  const row = await page.getByTestId('setup-step-domain').boundingBox();
  const box = await detail.boundingBox();
  expect(row && box && box.y >= row.y + row.height - 1).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
