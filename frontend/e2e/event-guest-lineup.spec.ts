// Special guest lineup (spec 050-Q). Storefront: the #guests section on the
// public event page (visible guests, photo alt = name, named links, hidden
// with no guests, placeholder in preview). Wizard: the lineup editor in the
// Special guests step (add by hand, edit, reorder with buttons, hide, delete).
// Every API call is mocked; assertions are scoped to #guests or the form pane. Axe runs with reduced motion at 390 × 844.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const GUESTS = [
  { id: 'g-mara', name: 'Mara Voss', role: 'Voice actor', bio: 'Voice of Captain Rook.\nSigning Saturday only.', imageUrl: '/images/img-mara/abc/square', links: { instagram: 'https://instagram.com/mara', website: 'https://mara.example' } },
  { id: 'g-sam', name: 'Sam Lee', role: null, bio: null, imageUrl: null, links: null },
];

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, slug: id, name: 'Retro Con', description: null, logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 100, status: 'PUBLISHED', admissionMode: 'TICKETED', taxRate: 0,
    organizationId: 'org-lineup', organizationName: 'Lineup Org', organizationBrandColor: '#0f766e', organizationThemeMode: 'LIGHT',
    organizationSignInLinks: false,
    venue: { id: 'v1', name: 'Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [], guests: GUESTS,
    ...overrides,
  };
}

async function mockEvent(page: Page, body: { id: string }) {
  await page.route(`${API}/events/${body.id}`, (route) => route.fulfill(json(body)));
  await page.route(`${API}/events/${body.id}/applications/forms`, (route) => route.fulfill(json({ data: [] })));
  await page.route(`${API}/events/${body.id}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route(`${API}/images/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await mockLegalVersions(page, API);
}

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } });

test.describe('storefront lineup', () => {
  // The first test may compile the event route cold.
  test.describe.configure({ timeout: 90000 });

  test('shows visible guests in order with photo alt, plain-text bio and named links', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup'));
    await page.goto('/events/e2e-lineup');
    const section = page.locator('#guests');
    await expect(section.getByRole('heading', { level: 2, name: 'Special guests' })).toBeVisible({ timeout: 30000 });
    await expect(section.getByRole('heading', { level: 3 })).toHaveText(['Mara Voss', 'Sam Lee']);
    await expect(section.getByRole('img', { name: 'Mara Voss' })).toBeVisible();
    await expect(section.getByText('Voice actor')).toBeVisible();
    await expect(section.getByText(/Signing Saturday only/)).toBeVisible();
    await expect(section.getByRole('link', { name: 'Mara Voss on Instagram' })).toHaveAttribute('href', 'https://instagram.com/mara');
    await expect(section.getByRole('link', { name: "Mara Voss's website" })).toHaveAttribute('href', 'https://mara.example');
    const box = await section.getByRole('link', { name: 'Mara Voss on Instagram' }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await serious(page)).toEqual([]);
  });

  test('renders nothing without visible guests', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup-empty', { guests: [] }));
    await page.goto('/events/e2e-lineup-empty');
    await expect(page.getByRole('heading', { level: 1, name: 'Retro Con' }).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#guests')).toHaveCount(0);
  });

  test('preview shows a placeholder when the lineup is empty', async ({ page }) => {
    await mockEvent(page, event('e2e-lineup-preview', { guests: [], status: 'DRAFT', preview: true }));
    await page.goto('/events/e2e-lineup-preview');
    const section = page.locator('#guests');
    await expect(section.getByText('Guests you add to the lineup show here')).toBeVisible({ timeout: 30000 });
    expect(await serious(page)).toEqual([]);
  });
});

// ── Wizard: lineup editor in the Special guests step ─────────────────────────

const ORG_ID = 'org-lineup';
const EVENT_ID = 'evt-lineup';
const WIZARD_EVENT = {
  ...event(EVENT_ID, { guests: [] }), status: 'DRAFT', setupStep: 'special-guests', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
  rsvpRemaining: null, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false, category: null,
};

type Row = { id: string; name: string; role: string | null; bio: string | null; imageUrl: string | null; links: Record<string, string> | null; isVisible: boolean; displayOrder: number; applicationId: null; imageId: null };

async function mockWizard(page: Page, initial: Partial<Row>[] = []) {
  let rows: Row[] = initial.map((g, i) => ({ id: `g-${i}`, name: 'Guest', role: null, bio: null, imageUrl: null, links: null, isVisible: true, displayOrder: i, applicationId: null, imageId: null, ...g }));
  const state = { previews: 0, posts: [] as unknown[], patches: [] as unknown[], reorders: [] as unknown[] };
  const base = `${API}/organizations/${ORG_ID}/events/${EVENT_ID}/guests`;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Lineup Org', slug: 'lineup-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }])));
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['dashboard', 'events', 'applications', 'applications.forms', 'venues'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([{ ...WIZARD_EVENT.venue, city: 'Raleigh', state: 'NC' }])));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(json({ event: WIZARD_EVENT, applications: { forms: [] }, admissionLock: { locked: false, reason: null } }))
  );
  await page.route(`${API}/admin/events/${EVENT_ID}/application-forms`, (route) => route.fulfill(json({ data: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) => {
    state.previews += 1;
    const visible = rows.filter((g) => g.isVisible).map(({ id, name, role, bio, imageUrl, links }) => ({ id, name, role, bio, imageUrl, links }));
    return route.fulfill(json({ event: { ...WIZARD_EVENT, guests: visible }, organization: { id: ORG_ID, name: 'Lineup Org' }, forms: [], guests: rows }));
  });
  await page.route(base, (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json({ data: rows }));
    const body = route.request().postDataJSON();
    state.posts.push(body);
    const row: Row = { id: `g-${rows.length + 10}`, role: null, bio: null, imageUrl: null, links: null, isVisible: true, displayOrder: rows.length, applicationId: null, imageId: null, ...body };
    rows.push(row);
    return route.fulfill(json(row, 201));
  });
  await page.route(`${base}/reorder`, (route) => {
    const { ids } = route.request().postDataJSON();
    state.reorders.push(ids);
    rows = ids.map((id: string, i: number) => ({ ...rows.find((g) => g.id === id)!, displayOrder: i }));
    return route.fulfill(json({ data: rows }));
  });
  await page.route(new RegExp(`${base}/[^/]+$`), (route) => {
    const id = route.request().url().split('/').pop()!;
    if (id === 'reorder') return route.fallback();
    if (route.request().method() === 'DELETE') {
      rows = rows.filter((g) => g.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    const body = route.request().postDataJSON();
    state.patches.push(body);
    const row = rows.find((g) => g.id === id)!;
    Object.assign(row, body);
    return route.fulfill(json(row));
  });
  return state;
}

const STAFF = { id: 'lineup-organizer', email: 'lineup-organizer@test.com', role: 'ORGANIZER' as const };
// Spec 051: the lineup is the first step of the special guests flow.
const STEP_URL = `/admin/events/${EVENT_ID}/setup/special-guests?step=lineup`;

test.describe('wizard lineup editor', () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, STAFF, baseURL!);
  });

  const editor = (page: Page) => page.locator('main').getByTestId('lineup-editor');

  test('adds a guest by hand with no form, edits, reorders with buttons, hides and deletes', async ({ page }) => {
    const state = await mockWizard(page);
    await page.goto(STEP_URL);
    const pane = editor(page);
    await expect(pane.getByText('No guests in the lineup yet.')).toBeVisible({ timeout: 90000 });

    // Add by hand: the name is required.
    await pane.getByRole('button', { name: 'Add a guest' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a guest' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Add guest' }).click();
    await expect(dialog.getByText('Enter the guest’s name')).toBeVisible();
    await dialog.getByLabel('Name').fill('Mara Voss');
    await dialog.getByLabel(/^Role/).fill('Voice actor');
    await dialog.getByLabel(/^Bio/).fill('Voice of Captain Rook.');
    await dialog.getByLabel('Instagram').fill('https://instagram.com/mara');
    expect(await serious(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Add guest' }).click();
    await expect(dialog).toBeHidden();
    // The empty state's Add button is gone: focus lands on the new row.
    await expect(pane.getByRole('button', { name: 'Edit Mara Voss' })).toBeFocused();
    expect(state.posts).toEqual([{ name: 'Mara Voss', role: 'Voice actor', bio: 'Voice of Captain Rook.', links: { instagram: 'https://instagram.com/mara' } }]);

    await pane.getByRole('button', { name: 'Add a guest' }).click();
    await page.getByRole('dialog', { name: 'Add a guest' }).getByLabel('Name').fill('Sam Lee');
    await page.getByRole('dialog', { name: 'Add a guest' }).getByRole('button', { name: 'Add guest' }).click();
    await expect(pane.getByTestId('lineup-row')).toHaveCount(2);

    // Edit.
    await pane.getByRole('button', { name: 'Edit Sam Lee' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Sam Lee' });
    await edit.getByLabel(/^Role/).fill('Panel host');
    await edit.getByRole('button', { name: 'Save guest' }).click();
    await expect(pane.getByText('Panel host')).toBeVisible();

    // Reorder with the keyboard: focus stays on a move button, the new position is announced.
    const previewsBefore = state.previews;
    await pane.getByRole('button', { name: 'Move Sam Lee up' }).focus();
    await page.keyboard.press('Enter');
    await expect(pane.getByRole('status')).toHaveText('Sam Lee moved to position 1 of 2');
    expect(state.reorders.at(-1)).toEqual(['g-11', 'g-10']);
    await expect(pane.getByTestId('lineup-row').first()).toContainText('Sam Lee');
    // Up is disabled at the top, so focus moves to the row's other move button.
    await expect(pane.getByRole('button', { name: 'Move Sam Lee down' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pane.getByRole('status')).toHaveText('Sam Lee moved to position 2 of 2');
    await expect(pane.getByRole('button', { name: 'Move Sam Lee up' })).toBeFocused();
    await pane.getByRole('button', { name: 'Move Sam Lee up' }).press('Enter');
    await expect(pane.getByTestId('lineup-row').first()).toContainText('Sam Lee');
    await expect.poll(() => state.previews).toBeGreaterThan(previewsBefore);

    // Hide, then delete.
    await pane.getByLabel('Show on event page').first().uncheck();
    await expect(pane.getByRole('status')).toHaveText('Sam Lee hidden from the event page');
    expect(state.patches.at(-1)).toEqual({ isVisible: false });
    page.once('dialog', (d) => d.accept());
    await pane.getByRole('button', { name: 'Remove Sam Lee' }).click();
    await expect(pane.getByTestId('lineup-row')).toHaveCount(1);
    // Focus goes to the next row, never lost to <body>.
    await expect(pane.getByRole('button', { name: 'Edit Mara Voss' })).toBeFocused();
    for (const button of await pane.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await serious(page)).toEqual([]);
  });

  test('a retry after a failed photo upload updates the created guest instead of adding another', async ({ page }) => {
    const state = await mockWizard(page);
    let uploads = 0;
    await page.route(new RegExp(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/guests/[^/]+/image$`), (route) => {
      uploads += 1;
      return uploads === 1 ? route.fulfill(json({ message: 'Storage unavailable' }, 500)) : route.fulfill(json({ id: 'g-10', name: 'Mara Voss', role: null, bio: null, imageUrl: null, links: null, isVisible: true, displayOrder: 0, applicationId: null, imageId: 'img' }));
    });
    await page.goto(STEP_URL);
    const pane = editor(page);
    await pane.getByRole('button', { name: 'Add a guest' }).click({ timeout: 90000 });
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Mara Voss');
    await dialog.getByLabel(/^Photo/).setInputFiles({ name: 'mara.png', mimeType: 'image/png', buffer: PIXEL });
    await dialog.getByRole('button', { name: /Add guest|Save guest/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('Storage unavailable');
    await dialog.getByRole('button', { name: 'Save guest' }).click();
    await expect(dialog).toBeHidden();
    expect(state.posts).toHaveLength(1);
    expect(uploads).toBe(2);
    await expect(pane.getByTestId('lineup-row')).toHaveCount(1);
  });
});
