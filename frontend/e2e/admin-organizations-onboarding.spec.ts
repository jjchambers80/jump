import { expect, test, type Route } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022 phase 3: the signup funnel now sits on System administration ›
// Organizations (the old /admin/organizations redirects there); the
// dashboard setup guide gains the check-in card.

const API = 'http://localhost:3002';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const base = {
  slug: 'x',
  status: 'ACTIVE',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  onboardingCompletedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 1 },
};

const page1 = {
  organizations: [
    { id: 'org-a', name: 'Raleigh Retro Gamers', slug: 'rrg', status: 'ACTIVE', createdAt: base.createdAt, onboardingCompletedAt: base.createdAt, memberCount: 2, venueCount: 1, plan: 'STARTER', subscriptionStatus: 'trialing' },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

test('SYSTEM_ADMIN: /admin/organizations redirects to the system list with the funnel', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'sys', email: 'sys@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/organizations') return json(route, [{ ...base, id: 'org-a', name: 'Raleigh Retro Gamers' }]);
    if (path === '/admin/system/organizations') return json(route, page1);
    if (path === '/organizations/onboarding/funnel') return json(route, { windows: { 7: { started: 3, completed: 2, subscribed: 1 }, 30: { started: 9, completed: 6, subscribed: 2 } }, pending: 1 });
    return json(route, []);
  });
  await page.goto('/admin/organizations');
  await expect(page).toHaveURL(/\/admin\/system\/organizations$/);

  const funnel = page.getByTestId('onboarding-funnel');
  await expect(funnel).toContainText('1 pending now');
  await funnel.getByText('Signup funnel').click();
  await expect(page.getByTestId('funnel-7')).toContainText('Last 7 days');
  await expect(page.getByTestId('funnel-7')).toContainText('3');
  await expect(page.getByTestId('funnel-30')).toContainText('9');
  await expect(page.getByTestId('system-org-list')).toContainText('Starter · trial');
});

test('ADMIN: /admin/organizations ends on the dashboard', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/organizations') return json(route, [{ ...base, id: 'org-c', name: 'Legacy Org' }]);
    return json(route, []);
  });
  await page.goto('/admin/organizations');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByTestId('onboarding-funnel')).toHaveCount(0);
});

test('onboarding checklist shows the check-in step for door sellers', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/organizations') return json(route, [{ ...base, id: 'org-c', name: 'Legacy Org' }]);
    if (path === '/admin/setup-guide')
      return json(route, {
        dismissedAt: null,
        tasks: [
          { id: 'event', done: true, href: '/admin/create-event', shown: true },
          { id: 'checkin', done: false, href: '/admin/orders/scan', shown: true },
        ],
        onboarding: { goals: ['sell_at_door'] },
      });
    if (path === '/admin/dashboard/stats') return json(route, { totalCapacity: 0, ticketsSold: 0, remainingCapacity: 0, ticketsRedeemed: 0, salesRate: 0, paymentSuccessRate: 100 });
    if (path === '/admin/events') return json(route, { events: [] });
    return json(route, []);
  });
  await page.goto('/admin/onboarding');
  await expect(page.getByTestId('setup-step-checkin')).toContainText('Check tickets in at the door');
  const detail = page.getByTestId('setup-detail-checkin').locator('visible=true');
  await expect(detail.getByRole('link', { name: 'Open scanner' })).toHaveAttribute('href', '/admin/orders/scan');
});
