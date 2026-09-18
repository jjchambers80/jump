import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Spec 022 phase 1: the /signup onboarding flow (name → survey → done) and
// the org switcher's "Create organization" opening it in a new tab.

const API = 'http://localhost:3002';

interface Pending {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  step: 'subscribe' | 'survey' | 'done';
  onboarding: Record<string, unknown> | null;
}

function json(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** In-memory backend for the signup routes. */
/** After completion the real jwt callback re-reads the promoted role; the mocked session must too. */
async function promoteSession(page: Page, user: { id: string; email: string }) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { ...user, role: 'ADMIN' }, accessToken: 'promoted', expires: '2099-01-01T00:00:00.000Z' }),
    })
  );
}

async function mockSignupApi(page: Page, opts: { pending?: Pending | null } = {}) {
  let pending: Pending | null = opts.pending ?? null;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const organizations: unknown[] = [];

  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, body });

    if (path === '/signup/current' && method === 'GET') return json(route, { organization: pending, billingEnabled: false });
    if (path === '/signup' && method === 'POST') {
      pending = {
        id: 'org-new-1',
        name: (body as { name: string }).name,
        slug: 'raleigh-retro-gamers',
        createdAt: '2027-01-01T00:00:00.000Z',
        step: 'survey',
        onboarding: { version: 1, source: (body as { source: string }).source },
      };
      return json(route, pending, 201);
    }
    const m = path.match(/^\/signup\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const [, id, rest] = m;
      if (!pending || pending.id !== id) return json(route, { error: 'NotFoundError', message: 'Organization not found' }, 404);
      if (!rest && method === 'GET') return json(route, pending);
      if (rest === 'survey' && method === 'PATCH') {
        pending = { ...pending, onboarding: { ...(pending.onboarding ?? {}), ...(body as object) } };
        return json(route, pending);
      }
      if (rest === 'survey/skip') {
        pending = { ...pending, step: 'done', onboarding: { ...(pending.onboarding ?? {}), surveySkippedAt: 'now' } };
        return json(route, pending);
      }
      if (rest === 'complete') {
        const org = {
          id: pending.id,
          name: pending.name,
          slug: pending.slug,
          status: 'ACTIVE',
          createdAt: pending.createdAt,
          updatedAt: pending.createdAt,
          onboardingCompletedAt: '2027-01-01T00:00:01.000Z',
          _count: { venues: 0, users: 1 },
        };
        organizations.push(org);
        pending = null;
        await promoteSession(page, { id: 'newcomer', email: 'newcomer@test.com' });
        return json(route, org);
      }
    }
    if (path === '/organizations' && method === 'GET') return json(route, organizations);
    if (path === '/admin/setup-guide') {
      return json(route, {
        dismissedAt: null,
        tasks: [
          { id: 'event', done: false, href: '/admin/create-event', shown: true },
          { id: 'design', done: false, href: '/admin/online-store', shown: true },
          { id: 'payments', done: false, href: '/admin/settings/payments', state: 'platform', shown: true },
          { id: 'business', done: false, href: '/admin/settings', shown: true },
          { id: 'domain', done: false, href: '/admin/settings/domains', shown: true },
          { id: 'applications', done: false, href: '/admin/participants/applications', shown: true },
        ],
        onboarding: { goals: ['vendor_applications'] },
      });
    }
    if (path === '/admin/dashboard/stats') return json(route, { totalCapacity: 0, ticketsSold: 0, remainingCapacity: 0, ticketsRedeemed: 0, salesRate: 0, paymentSuccessRate: 100 });
    if (path === '/admin/events') return json(route, { events: [] });
    return json(route, []);
  });

  return { calls, current: () => pending };
}

test.describe('signup flow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'newcomer', email: 'newcomer@test.com', role: 'UNASSIGNED' }, baseURL!);
  });

  test('name → survey → done lands on the new organization dashboard with the setup guide', async ({ page }) => {
    const api = await mockSignupApi(page);

    await page.goto('/signup?from_admin=1');
    await expect(page.getByRole('heading', { name: 'Name your organization' })).toBeVisible();
    await page.getByLabel('Organization name').fill('Raleigh Retro Gamers');
    await expect(page.getByTestId('signup-handle')).toContainText('raleigh-retro-gamers');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Survey step 1: goals (multi-select)
    await expect(page).toHaveURL(/\/signup\/org-new-1\/survey/);
    await expect(page.getByRole('heading', { name: 'What can we help you do?' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Sell tickets online' }).click();
    await page.getByRole('checkbox', { name: 'Manage vendor & sponsor applications' }).click();
    await expect(page.getByRole('checkbox', { name: 'Sell tickets online' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2: event types
    await expect(page.getByRole('heading', { name: 'What kind of events do you run?' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Conventions & expos' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3: events per year (single) — back arrow returns to step 2
    await expect(page.getByRole('heading', { name: 'How many events do you run a year?' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'What kind of events do you run?' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Conventions & expos' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('checkbox', { name: '2–5' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 4: attendance is the last step (no "move platform" goal → no step 5)
    await expect(page.getByRole('heading', { name: 'How many people come to a typical event?' })).toBeVisible();
    await expect(page.getByText('Step 4 of 4')).toBeVisible();
    await page.getByRole('checkbox', { name: '500–2,000' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();

    // Done → dashboard for the new org, setup guide visible
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId('setup-guide')).toBeVisible();
    await expect(page.getByTestId('setup-card-event')).toContainText('Create your first event');
    await expect(page.getByTestId('setup-card-applications')).toBeVisible();
    await expect(page.getByTestId('org-switcher-trigger')).toContainText('Raleigh Retro Gamers');

    const saved = api.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/survey')).map((c) => c.body);
    expect(saved).toEqual([
      { goals: ['sell_online', 'vendor_applications'] },
      { eventTypes: ['convention_expo'] },
      { eventTypes: ['convention_expo'] },
      { eventsPerYear: 'two_to_five' },
      { attendance: '500_2000' },
    ]);
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/signup/org-new-1/complete')).toBe(true);
    expect(api.calls.find((c) => c.path === '/signup')?.body).toEqual({ name: 'Raleigh Retro Gamers', source: 'admin' });
  });

  test('Skip on the first survey screen goes straight to done', async ({ page }) => {
    const api = await mockSignupApi(page);
    await page.goto('/signup');
    await page.getByLabel('Organization name').fill('Skip Co');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'What can we help you do?' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    expect(api.calls.some((c) => c.path === '/signup/org-new-1/survey/skip')).toBe(true);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  test('the "move from another platform" goal adds the moving-from step', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/signup');
    await page.getByLabel('Organization name').fill('Mover');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('checkbox', { name: 'Move from another platform' }).click();
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Where are you moving from?' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Eventeny' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test('a pending signup resumes at its step', async ({ page }) => {
    await mockSignupApi(page, {
      pending: {
        id: 'org-new-1',
        name: 'Half Done',
        slug: 'half-done',
        createdAt: '2027-01-01T00:00:00.000Z',
        step: 'survey',
        onboarding: { version: 1, goals: ['sell_at_door'] },
      },
    });
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/signup\/org-new-1\/survey/);
    await expect(page.getByRole('checkbox', { name: 'Sell tickets at the door' })).toHaveAttribute('aria-checked', 'true');
  });

  test('signed-out visitors are sent to sign-in and back to /signup', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fsignup/);
    await expect(page.getByRole('link', { name: 'Create your organization' })).toBeVisible();
    await context.close();
  });
});

test.describe('org switcher', () => {
  test('Create organization opens /signup in a new tab; the switcher picks the new org up', async ({ page, baseURL, context }) => {
    await signInAsStaff(page, { id: 'store-admin', email: 'store-admin@test.com', role: 'ADMIN' }, baseURL!);
    // The popup is a new page in the same context: it needs the session mock too
    await context.route('**/api/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'store-admin', email: 'store-admin@test.com', role: 'ADMIN' }, accessToken: 'x', expires: '2099-01-01T00:00:00.000Z' }),
      })
    );
    const existing = {
      id: 'org-existing',
      name: 'Durham Pinball Society',
      slug: 'durham-pinball-society',
      status: 'ACTIVE',
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-01T00:00:00.000Z',
      _count: { venues: 1, users: 2 },
    };
    const created = { ...existing, id: 'org-new-1', name: 'Raleigh Retro Gamers', slug: 'raleigh-retro-gamers' };
    let orgs = [existing];
    await context.route(`${API}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === '/organizations' && method === 'GET') return json(route, orgs);
      if (path === '/signup/current') return json(route, { organization: null, billingEnabled: false });
      if (path === '/signup' && method === 'POST') return json(route, { ...created, step: 'survey', onboarding: null }, 201);
      if (path.endsWith('/survey/skip')) return json(route, { ...created, step: 'done', onboarding: { surveySkippedAt: 'now' } });
      if (path.endsWith('/complete')) {
        orgs = [existing, created];
        return json(route, created);
      }
      if (path === '/admin/setup-guide') return json(route, { dismissedAt: '2027-01-01T00:00:00.000Z', tasks: [], onboarding: null });
      if (path === '/admin/events') return json(route, { events: [] });
      return json(route, []);
    });

    await page.goto('/admin/dashboard');
    await page.getByTestId('org-switcher-trigger').click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('org-switcher-create').click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/signup\?from_admin=1$/);

    // Finish the signup in the popup
    await popup.getByLabel('Organization name').fill('Raleigh Retro Gamers');
    await popup.getByRole('button', { name: 'Continue' }).click();
    await popup.getByRole('button', { name: 'Skip' }).click();
    await expect(popup).toHaveURL(/\/admin\/dashboard/);
    await expect(popup.getByTestId('org-switcher-trigger')).toContainText('Raleigh Retro Gamers');

    // The original tab refetched and selected the new organization
    await expect(page.getByTestId('org-switcher-trigger')).toContainText('Raleigh Retro Gamers');
    await page.getByTestId('org-switcher-trigger').click();
    await expect(page.getByRole('button', { name: /Durham Pinball Society/ })).toBeVisible();
  });
});
