// Admin › Maps (spec 014 phase 1): list, builder, booth assignment panel — backend mocked.
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-maps';
const EVENT_ID = 'evt-maps';
const MAP_ID = 'map-maps';

type Booth = {
  id: string;
  mapId: string;
  label: string;
  kind: 'BOOTH' | 'TABLE';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  tierId: string | null;
  status: 'AVAILABLE' | 'SOLD' | 'RESERVED' | 'BLOCKED';
  applicationId: string | null;
  assignedById: string | null;
  createdAt: string;
  updatedAt: string;
  holder?: { id: string; status: string; paymentStatus: string; businessName: string | null } | null;
};

type Tier = {
  id: string;
  name: string;
  price: number;
  mapBound: boolean;
  quantityTotal: number | null;
  form: { id: string; name: string; slug: string } | null;
  displayOrder: number;
};

const booths: Booth[] = [
  {
    id: 'booth-a1',
    mapId: MAP_ID,
    label: 'A1',
    kind: 'BOOTH',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    tierId: null,
    status: 'AVAILABLE',
    applicationId: null,
    assignedById: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  },
  {
    id: 'booth-a2',
    mapId: MAP_ID,
    label: 'A2',
    kind: 'BOOTH',
    x: 12,
    y: 0,
    w: 10,
    h: 10,
    rotation: 0,
    tierId: null,
    status: 'AVAILABLE',
    applicationId: null,
    assignedById: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  },
  {
    id: 'booth-a3',
    mapId: MAP_ID,
    label: 'A3',
    kind: 'TABLE',
    x: 0,
    y: 12,
    w: 10,
    h: 10,
    rotation: 0,
    tierId: null,
    status: 'SOLD',
    applicationId: 'app-vendor1',
    assignedById: 'admin-1',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    holder: {
      id: 'app-vendor1',
      status: 'APPROVED',
      paymentStatus: 'PAID',
      businessName: 'Vendor One',
    },
  },
];

const tiers: Tier[] = [
  {
    id: 'tier-standard',
    name: 'Standard',
    price: 5000,
    mapBound: false,
    quantityTotal: null,
    form: { id: 'form-vendor', name: 'Vendor Form', slug: 'vendor' },
    displayOrder: 0,
  },
];

const mapDetail = {
  id: MAP_ID,
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  name: 'Floor Plan',
  status: 'DRAFT',
  unit: 'ft',
  gridSize: 10,
  width: 50,
  height: 40,
  underlayFileId: null,
  underlayOpacity: 40,
  layout: { version: 1, elements: [] },
  publishedAt: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  booths,
  tiers,
};

const assignableApps = [
  {
    id: 'app-vendor2',
    businessName: 'Vendor Two',
    contactName: 'Jane Smith',
    email: 'vendor2@test.com',
    tier: { id: 'tier-standard', name: 'Standard', price: 5000, mapBound: false },
    tierMatch: true,
    status: 'APPROVED',
  },
];

async function mockMapsApi(page: Page) {
  // Deep clone fixture data so previous tests' mutations don't leak
  const initialBooths: Booth[] = structuredClone(booths);
  const initialTiers: Tier[] = structuredClone(tiers);
  // The admin shell resolves the active org from this list; without it every
  // org-scoped page stays on its loading state.
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Maps Org',
          slug: 'maps-org',
          status: 'ACTIVE',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ]),
    })
  );
  await page.route(`${API}/admin/maps`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: MAP_ID,
          eventId: EVENT_ID,
          event: { id: EVENT_ID, name: 'Expo 2026', slug: 'expo-2026', date: '2026-10-04T00:00:00.000Z' },
          name: 'Floor Plan',
          status: 'DRAFT',
          width: 50,
          height: 40,
          boothCount: 3,
          soldCount: 1,
          reservedCount: 0,
          blockedCount: 0,
          publishedAt: null,
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z',
        },
      ]),
    })
  );

  await page.route(`${API}/admin/maps/${MAP_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...mapDetail, booths: initialBooths, tiers: initialTiers }),
    })
  );

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/assignable*`, async (route) => {
    const url = new URL(route.request().url());
    const boothId = url.pathname.split('/booths/')[1].split('/assignable')[0];
    // Return apps for any assignable booth
    const results = assignableApps;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(results),
    });
  });

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/assign`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { applicationId: string; force?: boolean };
    const boothId = new URL(request.url()).pathname.split('/booths/')[1].split('/assign')[0];
    const booth = initialBooths.find((b) => b.id === boothId);
    if (!booth || (booth.status !== 'AVAILABLE' && booth.status !== 'RESERVED')) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Booth not available' }) });
    }
    booth.status = 'SOLD';
    booth.applicationId = body.applicationId;
    booth.assignedById = 'admin-1';
    booth.holder = { id: body.applicationId, status: 'APPROVED', paymentStatus: 'PAID', businessName: 'Vendor Two' };
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ boothId: booth.id, label: booth.label, status: 'SOLD' }),
    });
  });

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/unassign`, async (route) => {
    const boothId = new URL(route.request().url()).pathname.split('/booths/')[1].split('/unassign')[0];
    const booth = initialBooths.find((b) => b.id === boothId);
    if (!booth || booth.status !== 'SOLD') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Booth not sold' }) });
    }
    booth.status = 'AVAILABLE';
    booth.applicationId = null;
    booth.assignedById = null;
    booth.holder = null;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ boothId: booth.id, label: booth.label, status: 'AVAILABLE' }),
    });
  });

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/move`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { targetBoothId: string };
    const fromBoothId = new URL(request.url()).pathname.split('/booths/')[1].split('/move')[0];
    const fromBooth = initialBooths.find((b) => b.id === fromBoothId);
    const toBooth = initialBooths.find((b) => b.id === body.targetBoothId);
    const canReceive = (status: string) => status === 'AVAILABLE' || status === 'RESERVED' || status === 'SOLD';
    if (!fromBooth || !toBooth || fromBooth.status !== 'SOLD' || !canReceive(toBooth.status)) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid move' }) });
    }
    // Swap if target is sold, otherwise move
    if (toBooth.status === 'SOLD' && toBooth.applicationId) {
      const tempAppId = fromBooth.applicationId;
      fromBooth.applicationId = toBooth.applicationId;
      fromBooth.assignedById = toBooth.assignedById;
      toBooth.applicationId = tempAppId;
      toBooth.assignedById = fromBooth.assignedById;
      // Update holders
      fromBooth.holder = { ...fromBooth.holder!, id: fromBooth.applicationId ?? '' };
      toBooth.holder = { ...toBooth.holder!, id: toBooth.applicationId ?? '' };
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: true }),
      });
    } else {
      toBooth.status = 'SOLD';
      toBooth.applicationId = fromBooth.applicationId;
      toBooth.assignedById = fromBooth.assignedById;
      toBooth.holder = fromBooth.holder;
      fromBooth.status = 'AVAILABLE';
      fromBooth.applicationId = null;
      fromBooth.assignedById = null;
      fromBooth.holder = null;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: false }),
      });
    }
  });

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/status`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED' };
    const boothId = new URL(request.url()).pathname.split('/booths/')[1].split('/status')[0];
    const booth = initialBooths.find((b) => b.id === boothId);
    if (!booth || booth.status === 'SOLD') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Cannot change status of sold booth' }) });
    }
    booth.status = body.status;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ boothId: booth.id, label: booth.label, status: body.status }),
    });
  });
}

async function gotoBuilder(page: Page) {
  await mockMapsApi(page);
  await page.goto(`/admin/maps/${MAP_ID}`);
  await expect(page.getByRole('heading', { name: 'Floor Plan' })).toBeVisible();
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'maps-admin', email: 'maps-admin@test.com', role: 'ADMIN' },
    baseURL!
  );
});

test('lists maps with event and booth counts', async ({ page }) => {
  await mockMapsApi(page);
  await page.goto('/admin/maps');
  await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible();
  const rows = page.getByTestId('map-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Floor Plan');
  await expect(rows.nth(0)).toContainText('1 / 3');
});

// Selecting a booth on the SVG canvas opens its panel under the Properties tab.
async function selectBooth(page: Page, label: string) {
  await page.getByTestId(`booth-${label}`).click();
  const properties = page.getByRole('button', { name: 'Properties' });
  await expect(properties).toBeEnabled();
  await properties.click();
}

test('opens builder and selects a booth', async ({ page }) => {
  await gotoBuilder(page);
  await selectBooth(page, 'A1');
  await expect(page.getByText('Assign', { exact: true })).toBeVisible();
  await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();
});

test('assigns an application from the booth panel', async ({ page }) => {
  await gotoBuilder(page);
  await selectBooth(page, 'A1');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Assign to A1' })).toBeVisible();
  await dialog.getByPlaceholder('Search by business name or contact…').fill('Vendor');
  await expect(dialog.getByText('Vendor Two')).toBeVisible();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  // The panel now shows the holder and the Sold pill.
  await expect(page.getByRole('link', { name: 'Vendor Two' })).toBeVisible();
  await expect(page.getByText('Sold', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('booth-A1')).toHaveAttribute('aria-label', /Sold/);
});

test('unassigns a booth from the booth panel', async ({ page }) => {
  await gotoBuilder(page);
  await selectBooth(page, 'A3');
  await expect(page.getByRole('link', { name: 'Vendor One' })).toBeVisible();
  await page.getByRole('button', { name: 'Unassign' }).click();
  await expect(page.getByRole('link', { name: 'Vendor One' })).toHaveCount(0);
  await expect(page.getByTestId('booth-A3')).toHaveAttribute('aria-label', /Available/);
});

test('moves a holder to another booth via Move to…', async ({ page }) => {
  // Assign booth A2 first, then move to A1
  await gotoBuilder(page);
  await selectBooth(page, 'A2');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Search by business name or contact…').fill('Vendor');
  await expect(dialog.getByText('Vendor Two')).toBeVisible();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Vendor Two' })).toBeVisible();

  // Booth A2 already has Properties panel open — click Move to…
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByTestId('booth-A1').click();
  await expect(page.getByTestId('booth-A1')).toHaveAttribute('aria-label', /Sold/);
  await expect(page.getByTestId('booth-A2')).toHaveAttribute('aria-label', /Available/);
});

test('blocks a booth and makes it available again', async ({ page }) => {
  await gotoBuilder(page);
  await selectBooth(page, 'A1');
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.getByTestId('booth-A1')).toHaveAttribute('aria-label', /Blocked/);
  await page.getByRole('button', { name: 'Make available' }).click();
  await expect(page.getByTestId('booth-A1')).toHaveAttribute('aria-label', /Available/);
});

test('sidebar Maps entry navigates to maps list', async ({ page }) => {
  await mockMapsApi(page);
  await page.goto('/admin/dashboard');
  await page.getByRole('link', { name: 'Maps' }).click();
  await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible();
});