import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022 phase 2: the subscribe step in /signup, Settings › Plan, and the
// dashboard subscription banner. Stripe's embedded Checkout itself is not
// exercised (no publishable key in tests); the pages around it are.

const API = 'http://localhost:3002';

const offer = { trialDays: 30, priceId: 'price_starter', unitAmount: 3900, currency: 'usd', interval: 'month', intervalCount: 1, productName: 'Jump Starter' };

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const org = {
  id: 'org-bill-1',
  name: 'Raleigh Retro Gamers',
  slug: 'raleigh-retro-gamers',
  status: 'ACTIVE',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 1 },
};

test.describe('signup subscribe step', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'newcomer', email: 'newcomer@test.com', role: 'UNASSIGNED' }, baseURL!);
  });

  async function mock(page: Page, opts: { billing: boolean }) {
    let pending: { id: string; name: string; slug: string; createdAt: string; step: string; onboarding: Record<string, unknown> } = { id: 'org-new-1', name: 'New Org', slug: 'new-org', createdAt: '2027-01-01T00:00:00.000Z', step: 'subscribe', onboarding: { version: 1 } };
    const calls: string[] = [];
    await page.route(`${API}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      calls.push(`${method} ${path}`);
      if (path === '/signup/org-new-1' && method === 'GET') return json(route, pending);
      if (path === '/signup/org-new-1/subscribe' && method === 'POST') {
        if (!opts.billing) return json(route, { error: 'ConflictError', message: 'Subscriptions are not available yet' }, 409);
        return json(route, { clientSecret: 'cs_test_secret', sessionId: 'cs_test', offer });
      }
      if (path === '/signup/org-new-1/subscribe/skip') {
        pending = { ...pending, step: 'survey', onboarding: { ...pending.onboarding, subscribeSkippedAt: 'now' } };
        return json(route, pending);
      }
      if (path === '/signup/org-new-1/subscribe/confirm') {
        const { sessionId } = route.request().postDataJSON();
        const subscribed = sessionId === 'cs_done';
        if (subscribed) pending = { ...pending, step: 'survey', onboarding: { ...pending.onboarding, subscribedAt: 'now' } };
        return json(route, { subscribed, organization: pending });
      }
      return json(route, []);
    });
    return { calls };
  }

  test('shows the trial ledger and the checkout slot; Skip moves to the survey', async ({ page }) => {
    const { calls } = await mock(page, { billing: true });
    await page.goto('/signup/org-new-1/subscribe');
    await expect(page.getByRole('heading', { name: /Get 30 days/ })).toBeVisible();
    await expect(page.getByText('30 days free')).toBeVisible();
    await expect(page.getByText('$39/mo + tax')).toBeVisible();
    await expect(page.getByText('Cancel anytime')).toBeVisible();
    // Stripe.js is not configured in tests: the checkout slot reports it instead of mounting
    await expect(page.getByTestId('embedded-checkout-error')).toContainText(/publishable key/);
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page).toHaveURL(/\/signup\/org-new-1\/survey/);
    expect(calls).toContain('POST /signup/org-new-1/subscribe/skip');
  });

  test('with billing off the step is skipped over', async ({ page }) => {
    await mock(page, { billing: false });
    await page.goto('/signup/org-new-1/subscribe');
    await expect(page).toHaveURL(/\/signup\/org-new-1\/survey/);
  });

  test('the Stripe return URL confirms the session and continues', async ({ page }) => {
    const { calls } = await mock(page, { billing: true });
    await page.goto('/signup/org-new-1/subscribe/return?session_id=cs_done');
    await expect(page).toHaveURL(/\/signup\/org-new-1\/survey/);
    expect(calls).toContain('POST /signup/org-new-1/subscribe/confirm');
  });

  test('an incomplete session returns to the subscribe step', async ({ page }) => {
    await mock(page, { billing: true });
    await page.goto('/signup/org-new-1/subscribe/return?session_id=cs_open');
    await expect(page).toHaveURL(/\/signup\/org-new-1\/subscribe$/);
  });
});

test.describe('Settings › Plan and dashboard banner', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'bill-admin', email: 'bill-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  async function mock(page: Page, plan: Record<string, unknown>) {
    const calls: string[] = [];
    await page.route(`${API}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      calls.push(`${method} ${path}`);
      if (path === '/organizations') return json(route, [org]);
      if (path === '/admin/settings/plan' && method === 'GET') return json(route, { canEdit: true, ...plan });
      if (path === '/admin/settings/plan/checkout') return json(route, { clientSecret: 'cs_test_secret', sessionId: 'cs_test', offer });
      if (path === '/admin/settings/plan/confirm') return json(route, { subscribed: true, canEdit: true, ...plan, plan: 'STARTER', subscriptionStatus: 'trialing', hasSubscription: true, canManage: true, trialEndsAt: '2027-02-01T12:00:00.000Z' });
      if (path === '/admin/settings/plan/portal') return json(route, { url: 'https://billing.stripe.com/session/test' });
      if (path === '/admin/setup-guide') return json(route, { dismissedAt: '2027-01-01T00:00:00.000Z', tasks: [], onboarding: null });
      if (path === '/admin/dashboard/stats') return json(route, { totalCapacity: 0, ticketsSold: 0, remainingCapacity: 0, ticketsRedeemed: 0, salesRate: 0, paymentSuccessRate: 100 });
      if (path === '/admin/events') return json(route, { events: [] });
      return json(route, []);
    });
    return { calls };
  }

  const free = { enabled: true, plan: 'FREE', subscriptionStatus: null, trialEndsAt: null, currentPeriodEndsAt: null, hasSubscription: false, canManage: false, offer };
  const trialing = { enabled: true, plan: 'STARTER', subscriptionStatus: 'trialing', trialEndsAt: '2027-02-01T12:00:00.000Z', currentPeriodEndsAt: '2027-02-01T12:00:00.000Z', hasSubscription: true, canManage: true, offer };

  test('FREE plan offers the trial; starting it opens the checkout card', async ({ page }) => {
    const { calls } = await mock(page, free);
    await page.goto('/admin/settings/plan');
    const card = page.getByTestId('plan-card');
    await expect(card.getByRole('heading', { name: 'Free' })).toBeVisible();
    await expect(page.getByTestId('plan-manage')).toHaveCount(0);
    await page.getByTestId('plan-start-trial').click();
    await expect(page.getByTestId('plan-checkout')).toBeVisible();
    await expect(page.getByTestId('plan-checkout')).toContainText('30 days free, then $39/mo + tax');
    expect(calls).toContain('POST /admin/settings/plan/checkout');
  });

  test('STARTER trial shows status, trial end and Manage billing', async ({ page }) => {
    const { calls } = await mock(page, trialing);
    await page.goto('/admin/settings/plan');
    const card = page.getByTestId('plan-card');
    await expect(card.getByRole('heading', { name: 'Jump Starter' })).toBeVisible();
    await expect(page.getByTestId('plan-status')).toHaveText('Free trial');
    await expect(card).toContainText('Trial ends');
    await expect(card).toContainText('Feb 1, 2027');
    await expect(page.getByTestId('plan-start-trial')).toHaveCount(0);
    await page.getByTestId('plan-manage').click();
    await expect.poll(() => calls.includes('POST /admin/settings/plan/portal')).toBe(true);
  });

  test('returning from Checkout confirms and reports the trial', async ({ page }) => {
    const { calls } = await mock(page, free);
    await page.goto('/admin/settings/plan?session_id=cs_done');
    await expect(page.getByRole('status')).toContainText('Your trial has started.');
    await expect(page.getByTestId('plan-status')).toHaveText('Free trial');
    await expect(page).toHaveURL(/\/admin\/settings\/plan$/);
    expect(calls).toContain('POST /admin/settings/plan/confirm');
  });

  test('billing off: no trial button, explanatory note', async ({ page }) => {
    await mock(page, { ...free, enabled: false, offer: null });
    await page.goto('/admin/settings/plan');
    await expect(page.getByTestId('plan-start-trial')).toHaveCount(0);
    await expect(page.getByText('Paid plans are not available yet.')).toBeVisible();
  });

  test('dashboard banner appears for past_due and links to the plan page', async ({ page }) => {
    await mock(page, { ...trialing, subscriptionStatus: 'past_due' });
    await page.goto('/admin/dashboard');
    const banner = page.getByTestId('plan-banner');
    await expect(banner).toContainText('Subscription payment failed');
    await expect(banner.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', '/admin/settings/plan');
  });

  test('no banner while trialing', async ({ page }) => {
    await mock(page, trialing);
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByTestId('plan-banner')).toHaveCount(0);
  });
});
