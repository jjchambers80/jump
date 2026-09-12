import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = 'http://localhost:3002';

const org = {
  id: 'org-brand-1',
  name: 'Brand Test Org',
  status: 'ACTIVE',
  logoUrl: null,
  coverUrl: null,
  brandColor: null as string | null,
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 1 },
};

const publicEvent = {
  id: 'event-brand-1',
  name: 'Branded Night',
  date: '2027-07-15T19:00:00.000Z',
  venue: { id: 'venue-brand-1', name: 'Brand Hall', address: '1 Brand Way' },
  category: 'music',
  status: 'PUBLISHED',
  priceRange: { min: 25, max: 75 },
  availableTickets: 42,
};

async function mockAdminSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'brand-admin', email: 'brand-admin@test.com', role: 'ADMIN' },
        accessToken: 'brand-test-token',
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  );
}

/** Mocks the org list, PATCH, and the public org/venue/event endpoints, sharing one brandColor. */
async function mockOrgApi(page: Page) {
  let current = { ...org };
  const patches: Record<string, unknown>[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([current]) })
  );

  await page.route(`${API}/organizations/${org.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(body);
    current = { ...current, ...body } as typeof current;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });

  await page.route(`${API}/organizations/${org.id}/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: { id: current.id, name: current.name, logoUrl: null, coverUrl: null, brandColor: current.brandColor },
        events: [publicEvent],
      }),
    })
  );

  await page.route(`${API}/venues/venue-brand-1`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        venue: {
          id: 'venue-brand-1',
          name: 'Brand Hall',
          address: '1 Brand Way',
          timezone: 'America/New_York',
          logoUrl: null,
          brandColor: current.brandColor,
        },
        events: [publicEvent],
      }),
    })
  );

  return {
    patches,
    setColor: (hex: string | null) => {
      current = { ...current, brandColor: hex };
    },
  };
}

function hexToRgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
}

test.beforeEach(async ({ page }) => {
  await mockAdminSession(page);
});

test('picks a preset, sees a passing badge, and saves the normalized hex', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('brand-color-picker')).toBeVisible();

  const verdict = page.getByTestId('contrast-verdict');
  await expect(verdict).toHaveText('Passes WCAG AA');

  await page.getByTestId('brand-preset-emerald').click();
  await expect(page.getByTestId('brand-preset-emerald')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('brand-color-hex')).toHaveValue('#047857');
  await expect(verdict).toHaveAttribute('data-passes', 'true');
  await expect(page.getByTestId('contrast-check-row')).toHaveCount(3);
  await expect(page.getByTestId('brand-color-warning')).toHaveCount(0);

  await page.getByTestId('brand-color-save').click();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ brandColor: '#047857' });
});

test('flags a failing custom hex but still allows saving it', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  const hexInput = page.getByTestId('brand-color-hex');
  await hexInput.fill('#FFFF00');

  const verdict = page.getByTestId('contrast-verdict');
  await expect(verdict).toHaveText('Fails WCAG AA');
  await expect(hexInput).toHaveValue('#ffff00');
  await expect(page.getByTestId('brand-color-warning')).toContainText('may not meet ADA requirements');
  await expect(page.getByTestId('contrast-check-row').nth(1)).toContainText('✗');

  const save = page.getByTestId('brand-color-save');
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ brandColor: '#ffff00' });
});

test('rejects invalid text without sending a request', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('brand-color-hex').fill('not-a-color');
  await expect(page.getByTestId('brand-color-hex-error')).toContainText('Enter a hex color');
  await expect(page.getByTestId('brand-color-save')).toBeDisabled();
  expect(api.patches).toHaveLength(0);
});

test('explains why contrast matters via a keyboard-accessible tooltip', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  const trigger = page.getByRole('button', { name: 'Why contrast matters' });
  await trigger.focus();
  await expect(page.getByRole('tooltip')).toContainText('4.5:1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
});

test('public organization, venue, and event cards inherit the saved brand color', async ({ page }) => {
  const api = await mockOrgApi(page);
  api.setColor('#047857');

  await page.goto(`/organizations/${org.id}`);
  const card = page.getByTestId(`event-card-${publicEvent.id}`);
  await expect(card).toBeVisible();
  const cta = card.getByText('View Details & Purchase');
  await expect(cta).toHaveCSS('background-color', hexToRgb('#047857'));
  await expect(card.getByText('$25.00')).toHaveCSS('color', hexToRgb('#047857'));

  await page.goto('/venues/venue-brand-1');
  const venueCta = page.getByTestId(`event-card-${publicEvent.id}`).getByText('View Details & Purchase');
  await expect(venueCta).toHaveCSS('background-color', hexToRgb('#047857'));
});

test('falls back to the platform blue when no brand color is set', async ({ page }) => {
  await mockOrgApi(page);

  await page.goto(`/organizations/${org.id}`);
  const cta = page.getByTestId(`event-card-${publicEvent.id}`).getByText('View Details & Purchase');
  await expect(cta).toHaveCSS('background-color', hexToRgb('#2563eb'));
});

for (const theme of ['light', 'dark'] as const) {
  test(`branded organization page has no axe contrast violations in ${theme} mode`, async ({ page }) => {
    const api = await mockOrgApi(page);
    api.setColor('#1d4ed8');

    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/organizations/${org.id}`);
    await page.evaluate((t) => localStorage.setItem('theme', t), theme);
    await page.reload();
    await expect(page.getByTestId(`event-card-${publicEvent.id}`)).toBeVisible();
    if (theme === 'dark') {
      await expect(page.locator('html')).toHaveClass(/dark/);
    }

    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(
      results.violations,
      `Branded org page has contrast violations in ${theme} mode:\n${JSON.stringify(results.violations, null, 2)}`
    ).toHaveLength(0);
  });
}
