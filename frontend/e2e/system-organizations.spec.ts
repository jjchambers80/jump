// System administration › Organizations: list (search + status filter in the
// URL), detail, Open (switches X-Jump-Org) and Suspend behind the step-up.
// Backend mocked (CI has none); shapes follow OrganizationService /
// SystemAdminService on the backend.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAUTH_401 = json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401);

const ORG = {
  id: 'org-rrg',
  name: 'Raleigh Retro Gamers',
  slug: 'raleigh-retro-gamers',
  status: 'ACTIVE',
  createdAt: '2026-09-01T12:00:00.000Z',
  onboardingCompletedAt: '2026-09-01T12:30:00.000Z',
  memberCount: 2,
  venueCount: 1,
  plan: 'STARTER',
  subscriptionStatus: 'trialing',
};
const PENDING_ORG = {
  ...ORG,
  id: 'org-new',
  name: 'Half Done Events',
  slug: 'half-done',
  onboardingCompletedAt: null,
  memberCount: 1,
  plan: 'FREE',
  subscriptionStatus: null,
};
const MEMBERS = [
  { id: 'u-1', email: 'owner@rrg.test', name: 'Rae Owner', image: null, role: 'ADMIN', status: 'ACTIVE', requireTwoStep: false, twoStepEnabled: true, invitedAt: null, joinedAt: ORG.createdAt },
  { id: 'u-2', email: 'helper@rrg.test', name: null, image: null, role: 'ORGANIZER', status: 'PENDING', requireTwoStep: false, twoStepEnabled: false, invitedAt: ORG.createdAt, joinedAt: ORG.createdAt },
];

async function mockApi(page: Page) {
  const listQueries: URLSearchParams[] = [];
  const patches: { body: unknown; reauth: string | null }[] = [];
  const scopedRequests: { path: string; org: string | null }[] = [];
  let org = { ...ORG };

  // Switcher feed: another org first, so the default selection is not the one we Open.
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([
      { id: 'org-other', name: 'Other Store', slug: 'other', status: 'ACTIVE' },
      { id: ORG.id, name: ORG.name, slug: ORG.slug, status: 'ACTIVE' },
    ])),
  );
  await page.route(`${API}/organizations/onboarding/funnel`, (route) =>
    route.fulfill(json({ windows: { 7: { started: 3, completed: 2, subscribed: 1 } }, pending: 1 })),
  );
  await page.route(/localhost:3002\/admin\/system\/organizations(\?.*)?$/, (route) => {
    listQueries.push(new URL(route.request().url()).searchParams);
    return route.fulfill(json({ organizations: [org, PENDING_ORG], pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } }));
  });
  await page.route(`${API}/admin/system/organizations/${ORG.id}`, (route) => route.fulfill(json({ organization: org, members: MEMBERS })));
  await page.route(`${API}/admin/system/organizations/${ORG.id}/status`, (route) => {
    const reauth = route.request().headers()['x-jump-reauth'] ?? null;
    const body = route.request().postDataJSON();
    patches.push({ body, reauth });
    if (reauth !== 'proof-1') return route.fulfill(REAUTH_401);
    org = { ...org, status: body.status };
    return route.fulfill(json(org));
  });
  await page.route(`${API}/account/reauth/start`, (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill(json({ methods: ['email'], ...(body?.method === 'email' ? { sentTo: 'sys@test.com' } : {}) }));
  });
  await page.route(`${API}/account/reauth`, (route) =>
    route.fulfill(json({ reauthToken: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z' })),
  );
  // Org-scoped admin endpoints the dashboard loads after Open.
  await page.route(/localhost:3002\/admin\/(?!system\/)/, (route) => {
    scopedRequests.push({ path: new URL(route.request().url()).pathname, org: route.request().headers()['x-jump-org'] ?? null });
    return route.fulfill(json({}));
  });
  return { listQueries, patches, scopedRequests };
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'sys-1', email: 'sys@test.com', role: 'SYSTEM_ADMIN', name: 'Sys Admin' }, baseURL!);
});

test('search and status filter live in the URL and the request query', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/admin/system/organizations');
  await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  await expect(page.getByTestId('system-org-list').getByText('Raleigh Retro Gamers')).toBeVisible();
  await expect(page.getByTestId('system-org-list')).toContainText('Unfinished signup');

  await page.getByLabel('Search organizations').fill('retro');
  await page.getByLabel('Search organizations').press('Enter');
  await expect(page).toHaveURL(/\?q=retro$/);
  await expect.poll(() => api.listQueries.at(-1)?.get('q')).toBe('retro');

  const filters = page.getByRole('group', { name: 'Filter by status' });
  await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'Suspended' }).click();
  await expect(page).toHaveURL(/q=retro&status=suspended/);
  await expect(filters.getByRole('button', { name: 'Suspended' })).toHaveAttribute('aria-pressed', 'true');
  await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => api.listQueries.at(-1)?.get('status')).toBe('INACTIVE');
  expect(api.listQueries.at(-1)?.get('q')).toBe('retro');
});

test('a row opens the detail page with staff', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/system/organizations');
  await page.getByRole('link', { name: /Raleigh Retro Gamers/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/system/organizations/${ORG.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: ORG.name })).toBeVisible();
  await expect(page.getByTestId('org-status')).toHaveText('Active');
  const members = page.getByTestId('org-members');
  await expect(members).toContainText('Rae Owner');
  await expect(members).toContainText('helper@rrg.test');
  await expect(members).toContainText('Pending');
});

test('Open scopes the next dashboard requests to that organization', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/admin/system/organizations/${ORG.id}`);
  await expect(page.getByRole('heading', { level: 1, name: ORG.name })).toBeVisible();
  const before = api.scopedRequests.length;
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  // The dashboard's own data calls (the sidebar may refetch its guide on focus
  // before the click lands, so only dashboard endpoints are asserted).
  const dashboardCalls = () => api.scopedRequests.slice(before).filter((r) => r.path.startsWith('/admin/dashboard'));
  await expect.poll(() => dashboardCalls().length).toBeGreaterThan(0);
  expect(dashboardCalls().filter((r) => r.org !== ORG.id)).toEqual([]);
});

test('Suspend confirms, asks to confirm it is you, then shows Suspended', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/admin/system/organizations/${ORG.id}`);
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();

  const confirm = page.getByRole('dialog', { name: `Suspend ${ORG.name}?` });
  await expect(confirm).toContainText('storefront goes offline');
  await expect(confirm).toContainText('stay valid');
  await confirm.getByRole('button', { name: 'Suspend' }).click();

  const reauth = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(reauth).toBeVisible();
  await reauth.getByRole('button', { name: 'Send code' }).click();
  await reauth.getByLabel('Verification code').fill('123456');
  await reauth.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByTestId('org-status')).toHaveText('Suspended');
  await expect(page.getByRole('status').filter({ hasText: 'is suspended' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reactivate' })).toBeVisible();
  expect(api.patches).toEqual([
    { body: { status: 'INACTIVE' }, reauth: null },
    { body: { status: 'INACTIVE' }, reauth: 'proof-1' },
  ]);
});

for (const path of ['/admin/system/organizations', `/admin/system/organizations/${ORG.id}`]) {
  test(`${path} fits 375px and has no axe violations`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return main.scrollWidth - main.clientWidth + (document.documentElement.scrollWidth - window.innerWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });
}
