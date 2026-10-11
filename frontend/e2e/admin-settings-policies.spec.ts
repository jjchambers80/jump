import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

// Settings › Policies (spec 052): written policies list, edit dialog with
// starter text, footer switch, and the storefront footer link. Backend mocked.

const API = 'http://localhost:3002';
const ORG_ID = 'org-pol';
const TYPES = [
  ['REFUND', 'Return and refund policy'],
  ['PRIVACY', 'Privacy policy'],
  ['TERMS', 'Terms of service'],
  ['SHIPPING', 'Shipping policy'],
  ['CONTACT', 'Contact information'],
  ['LEGAL_NOTICE', 'Legal notice'],
  ['ACCESSIBILITY', 'Accessibility statement'],
] as const;

async function mockApi(page: Page) {
  const saved: Record<string, { title: string; content: string }> = {};
  let showInFooter = true;
  const list = () => ({
    showInFooter,
    policies: TYPES.map(([type, title]) => ({
      type,
      title: saved[type]?.title ?? title,
      slug: saved[type] ? 'refund-policy' : null,
      status: saved[type] ? 'PUBLISHED' : 'NOT_SET',
      updatedAt: null,
    })),
  });
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Policy Store', slug: 'pol', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }]))
  );
  await page.route(`${API}/admin/settings/policies`, async (route) => {
    if (route.request().method() === 'PATCH') showInFooter = route.request().postDataJSON().showInFooter;
    return route.fulfill(json(list()));
  });
  await page.route(`${API}/admin/settings/policies/*`, async (route) => {
    const type = route.request().url().split('/').pop()!;
    if (route.request().method() === 'PUT') saved[type] = route.request().postDataJSON();
    const title = TYPES.find(([t]) => t === type)![1];
    return route.fulfill(
      json(
        saved[type]
          ? { type, ...saved[type], slug: 'refund-policy', status: 'PUBLISHED', starter: false, updatedAt: null }
          : { type, title, content: '<p>Starter refund text.</p>', slug: null, status: 'NOT_SET', starter: true, updatedAt: null }
      )
    );
  });
  return { saved, footer: () => showInFooter };
}

test.describe('as ADMIN', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'pol-admin', email: 'pol-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('lists the written policies and publishes starter text from the dialog', async ({ page }) => {
    const api = await mockApi(page);
    await page.goto('/admin/settings/policies');

    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Policies' })).toHaveAttribute('aria-current', 'page');
    const card = page.getByTestId('written-policies-card');
    await expect(card).toContainText('By default, policies appear in the footer of your online store and checkout');
    for (const [type, title] of TYPES) {
      await expect(page.getByTestId(`policy-row-${type}`)).toContainText(title);
      await expect(page.getByTestId(`policy-row-${type}`)).toContainText('No policy set');
    }
    await expect(page.getByText('Recommended policies are not legal advice.')).toBeVisible();

    await page.getByTestId('policy-row-REFUND').click();
    const dialog = page.getByRole('dialog', { name: 'Return and refund policy' });
    await expect(dialog.getByTestId('policy-starter-note')).toBeVisible();
    await expect(dialog.getByLabel('Title')).toHaveValue('Return and refund policy');
    await expect(dialog.getByText('Starter refund text.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Publish' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('policy-row-REFUND')).toContainText('Published');
    expect(api.saved.REFUND.content).toContain('Starter refund text.');
    await expect(page.getByTestId('policy-row-REFUND')).toBeFocused();
  });

  test('Cancel closes the dialog without saving', async ({ page }) => {
    const api = await mockApi(page);
    await page.goto('/admin/settings/policies');
    await page.getByTestId('policy-row-PRIVACY').click();
    const dialog = page.getByRole('dialog', { name: 'Privacy policy' });
    await expect(dialog.getByLabel('Title')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.saved.PRIVACY).toBeUndefined();
  });

  test('the ⋯ menu turns the footer and checkout links off', async ({ page }) => {
    const api = await mockApi(page);
    await page.goto('/admin/settings/policies');
    await page.getByRole('button', { name: 'Policy options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show policies in footer and checkout' }).click();
    await expect(page.getByTestId('written-policies-card')).toContainText('Policies are not linked in the footer');
    expect(api.footer()).toBe(false);
  });
});

test('published policies are linked in the storefront footer', async ({ page }) => {
  const org = { id: 'org-pol', name: 'Policy Store', logoUrl: null, coverUrl: null, brandColor: '#b91c1c', themeMode: 'SYSTEM' };
  await page.route(`${API}/organizations/org-pol/public`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organization: org, locked: false, events: [] }) })
  );
  await page.route(`${API}/organizations/org-pol/public/menus`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        main: [],
        footer: [],
        policies: [{ type: 'REFUND', title: 'Return and refund policy', href: '/organizations/org-pol/pages/refund-policy' }],
      }),
    })
  );
  await page.goto('/organizations/org-pol');
  await expect(page.getByRole('heading', { name: 'Policy Store', level: 1 })).toBeVisible({ timeout: 30_000 });
  const links = page.getByTestId('storefront-footer').getByRole('list', { name: 'Store policies' });
  await expect(links.getByRole('link', { name: 'Return and refund policy' })).toHaveAttribute('href', '/organizations/org-pol/pages/refund-policy');
});
