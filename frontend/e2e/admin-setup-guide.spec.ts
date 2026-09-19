import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022 phase 1: the dashboard setup guide.

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
    { id: 'applications', done: false, href: '/admin/participants/applications', shown: false },
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

test('renders one card per shown task, marks done tasks, links the rest', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.goto('/admin/dashboard');
  const guide = page.getByTestId('setup-guide');
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  await expect(guide.getByText('1 of 5 done')).toBeVisible();

  await expect(page.getByTestId('setup-card-applications')).toHaveCount(0);

  const design = page.getByTestId('setup-card-design');
  await expect(design).toHaveAttribute('data-done', 'true');
  await expect(design.getByLabel('Done')).toBeVisible();
  await expect(design.getByRole('link')).toHaveCount(0);

  const payments = page.getByTestId('setup-card-payments');
  await expect(payments).toContainText('Connect your Stripe account');
  await expect(payments.getByRole('link', { name: 'Connect Stripe' })).toHaveAttribute('href', '/admin/settings/payments');

  await expect(page.getByTestId('setup-card-event').getByRole('link', { name: 'Create event' })).toHaveAttribute('href', '/admin/create-event');
  await expect(page.getByTestId('setup-card-domain').getByRole('link', { name: 'Set up domain' })).toHaveAttribute('href', '/admin/settings/domains');
});

test('platform payments copy when Connect is off', async ({ page }) => {
  const guide = freshGuide();
  guide.tasks = guide.tasks.map((t) => (t.id === 'payments' ? { ...t, state: 'platform' } : t));
  await mockApi(page, guide);
  await page.goto('/admin/dashboard');
  await expect(page.getByTestId('setup-card-payments')).toContainText("You're ready to accept payments");
});

test('dismissing hides the guide and stamps the organization', async ({ page }) => {
  const { patches } = await mockApi(page, freshGuide());
  await page.goto('/admin/dashboard');
  await page.getByRole('button', { name: 'Dismiss guide' }).click();
  await expect(page.getByTestId('setup-guide')).toHaveCount(0);
  expect(patches).toEqual([{ dismissed: true }]);
});

test('a dismissed guide never renders', async ({ page }) => {
  const guide = freshGuide();
  guide.dismissedAt = '2027-01-02T00:00:00.000Z';
  await mockApi(page, guide);
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('setup-guide')).toHaveCount(0);
});

test('all done shows the completion heading', async ({ page }) => {
  const guide = freshGuide();
  guide.tasks = guide.tasks.map((t) => ({ ...t, done: true }));
  await mockApi(page, guide);
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
});

test('stacks to one column at 375px without horizontal overflow', async ({ page }) => {
  await mockApi(page, freshGuide());
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/admin/dashboard');
  const first = page.getByTestId('setup-card-event');
  const second = page.getByTestId('setup-card-design');
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  expect(a && b && b.y > a.y + a.height - 1).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
