import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';

type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';

const org = {
  id: 'org-theme-1',
  name: 'Theme Test Org',
  status: 'ACTIVE',
  logoUrl: null,
  coverUrl: null,
  brandColor: null as string | null,
  themeMode: 'SYSTEM' as ThemeMode,
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 1 },
};

const publicEvent = {
  id: 'event-theme-1',
  name: 'Themed Night',
  date: '2027-07-15T19:00:00.000Z',
  venue: { id: 'venue-theme-1', name: 'Theme Hall', address: '1 Theme Way' },
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
        user: { id: 'theme-admin', email: 'theme-admin@test.com', role: 'ADMIN' },
        accessToken: 'theme-test-token',
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  );
}

/** Mocks the org list, PATCH, the public org/venue/event endpoints, and the /events list, sharing one themeMode. */
async function mockOrgApi(page: Page) {
  let current = { ...org };
  let eventMode: ThemeMode | null = null;
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
        organization: {
          id: current.id,
          name: current.name,
          logoUrl: null,
          coverUrl: null,
          brandColor: current.brandColor,
          themeMode: current.themeMode,
        },
        events: [publicEvent],
      }),
    })
  );

  await page.route(`${API}/venues/venue-theme-1`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        venue: {
          id: 'venue-theme-1',
          name: 'Theme Hall',
          address: '1 Theme Way',
          timezone: 'America/New_York',
          logoUrl: null,
          brandColor: current.brandColor,
          themeMode: current.themeMode,
        },
        events: [publicEvent],
      }),
    })
  );

  await page.route(`${API}/events/${publicEvent.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: publicEvent.id,
        name: publicEvent.name,
        description: 'A themed evening.',
        date: publicEvent.date,
        doorTime: null,
        category: publicEvent.category,
        status: 'PUBLISHED',
        logoUrl: null,
        coverUrl: null,
        capacity: 100,
        taxRate: 0,
        createdAt: '2027-01-01T00:00:00.000Z',
        updatedAt: '2027-01-01T00:00:00.000Z',
        organizationId: current.id,
        organizationName: current.name,
        organizationBrandColor: current.brandColor,
        organizationThemeMode: eventMode ?? current.themeMode,
        venue: {
          id: 'venue-theme-1',
          name: 'Theme Hall',
          address: '1 Theme Way',
          timezone: 'America/New_York',
        },
        priceTiers: [],
      }),
    })
  );

  await page.route(`${API}/events?*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [publicEvent], pagination: { page: 1, limit: 12, total: 1, totalPages: 1 } }),
    })
  );

  return {
    patches,
    setMode: (mode: ThemeMode) => {
      current = { ...current, themeMode: mode };
    },
    /** Override the mode reported by the public event endpoint only (simulates a different org). */
    setEventMode: (mode: ThemeMode) => {
      eventMode = mode;
    },
  };
}

async function setStoredTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
}

test.beforeEach(async ({ page }) => {
  await mockAdminSession(page);
});

test('shows the Theme section above Branding with System selected by default', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  const picker = page.getByTestId('theme-mode-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: /User choice/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /System/ })).toBeChecked();
  await expect(page.getByTestId('theme-mode-save')).toBeDisabled();

  const themeHeading = page.getByRole('heading', { name: 'Theme', exact: true });
  const brandingHeading = page.getByRole('heading', { name: 'Branding' });
  const themeBox = await themeHeading.boundingBox();
  const brandingBox = await brandingHeading.boundingBox();
  expect(themeBox!.y).toBeLessThan(brandingBox!.y);
});

test('selects Dark and saves { themeMode: "DARK" }', async ({ page }) => {
  const api = await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('theme-mode-dark').click();
  await expect(page.getByRole('radio', { name: /Dark/ })).toBeChecked();

  const save = page.getByTestId('theme-mode-save');
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toEqual({ themeMode: 'DARK' });
  await expect(save).toBeDisabled();
});

test('radio group is keyboard navigable', async ({ page }) => {
  await mockOrgApi(page);
  await page.goto('/admin/organizations');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('radio', { name: /System/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Light/ })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: /System/ })).toBeChecked();
});

test('DARK forces dark on the public org page even when the visitor chose light', async ({ page }) => {
  const api = await mockOrgApi(page);
  api.setMode('DARK');
  await setStoredTheme(page, 'light');

  await page.goto(`/organizations/${org.id}`);
  await expect(page.getByTestId(`event-card-${publicEvent.id}`)).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  // The visitor's stored preference is untouched
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
});

test('LIGHT strips dark on the public venue page even when the visitor chose dark', async ({ page }) => {
  const api = await mockOrgApi(page);
  api.setMode('LIGHT');
  await setStoredTheme(page, 'dark');

  await page.goto('/venues/venue-theme-1');
  await expect(page.getByTestId(`event-card-${publicEvent.id}`)).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
});

test('SYSTEM follows the OS color scheme on the public event page and ignores the stored choice', async ({
  page,
}) => {
  const api = await mockOrgApi(page);
  api.setMode('SYSTEM');
  await setStoredTheme(page, 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/events/${publicEvent.id}`);
  await expect(page.getByRole('heading', { name: publicEvent.name })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // Live OS change is honored
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('client navigation between pages with different modes re-forces the theme', async ({ page }) => {
  const api = await mockOrgApi(page);
  api.setMode('DARK');
  api.setEventMode('LIGHT');
  await setStoredTheme(page, 'dark');

  await page.goto(`/organizations/${org.id}`);
  await expect(page.getByTestId(`event-card-${publicEvent.id}`)).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // Client-side navigation keeps the provider mounted; the next BrandScope swaps the forced value
  await page.getByTestId(`event-card-${publicEvent.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/events/${publicEvent.id}$`));
  await expect(page.getByRole('heading', { name: publicEvent.name })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
});
