import { expect, test, type Route } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022 phase 3: SYSTEM_ADMIN Organizations page shows the signup funnel
// and each organization's survey summary / plan; the dashboard setup guide
// gains the check-in card.

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

const orgs = [
  {
    ...base,
    id: 'org-a',
    name: 'Raleigh Retro Gamers',
    plan: 'STARTER',
    subscriptionStatus: 'trialing',
    onboarding: { source: 'admin', goals: ['sell_online', 'vendor_applications'], eventTypes: ['convention_expo'], eventsPerYear: 'two_to_five', attendance: '500_2000', movingFrom: 'eventeny', surveySkipped: false },
  },
  {
    ...base,
    id: 'org-b',
    name: 'Durham Pinball Society',
    plan: 'FREE',
    subscriptionStatus: null,
    onboarding: { source: 'public', goals: [], eventTypes: [], eventsPerYear: null, attendance: null, movingFrom: null, surveySkipped: true },
  },
  { ...base, id: 'org-c', name: 'Legacy Org', plan: 'FREE', subscriptionStatus: null, onboarding: null },
];

test('SYSTEM_ADMIN sees the funnel, survey chips and plan pills', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'sys', email: 'sys@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/organizations') return json(route, orgs);
    if (path === '/organizations/onboarding/funnel') return json(route, { windows: { 7: { started: 3, completed: 2, subscribed: 1 }, 30: { started: 9, completed: 6, subscribed: 2 } }, pending: 1 });
    return json(route, []);
  });
  await page.goto('/admin/organizations');

  const funnel = page.getByTestId('onboarding-funnel');
  await expect(funnel).toContainText('1 pending now');
  await expect(page.getByTestId('funnel-7')).toContainText('Last 7 days');
  await expect(page.getByTestId('funnel-7')).toContainText('3');
  await expect(page.getByTestId('funnel-30')).toContainText('9');

  const rows = page.getByTestId('org-survey');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Sell tickets online');
  await expect(rows.first()).toContainText('Manage vendor & sponsor applications');
  await expect(rows.first()).toContainText('Conventions & expos');
  await expect(rows.first()).toContainText('2–5 / yr');
  await expect(rows.first()).toContainText('500–2,000 attendees');
  await expect(rows.first()).toContainText('from Eventeny');
  await expect(page.getByText('Survey skipped')).toBeVisible();
  await expect(page.getByTestId('org-plan')).toHaveCount(1);
  await expect(page.getByTestId('org-plan')).toHaveText('Starter · trial');
});

test('ADMIN sees no funnel card', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'adm', email: 'adm@test.com', role: 'ADMIN' }, baseURL!);
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/organizations') return json(route, [{ ...base, id: 'org-c', name: 'Legacy Org' }]);
    if (path === '/organizations/onboarding/funnel') return json(route, { error: 'ForbiddenError' }, 403);
    return json(route, []);
  });
  await page.goto('/admin/organizations');
  await expect(page.getByRole('heading', { name: 'Legacy Org' })).toBeVisible();
  await expect(page.getByTestId('onboarding-funnel')).toHaveCount(0);
  await expect(page.getByTestId('org-survey')).toHaveCount(0);
});

test('setup guide shows the check-in card for door sellers', async ({ page, baseURL }) => {
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
  await page.goto('/admin/dashboard');
  const card = page.getByTestId('setup-card-checkin');
  await expect(card).toContainText('Check tickets in at the door');
  await expect(card.getByRole('link', { name: 'Open scanner' })).toHaveAttribute('href', '/admin/orders/scan');
});
