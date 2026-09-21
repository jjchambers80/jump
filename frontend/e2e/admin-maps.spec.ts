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
      body: JSON.stringify(mapDetail),
    })
  );

  await page.route(`${API}/admin/maps/${MAP_ID}/booths/*/assignable*`, async (route) => {
    const url = new URL(route.request().url());
    const boothId = url.pathname.split('/booths/')[1].split('/assignable')[0];
    // Return different apps based on booth tier
    const results = boothId === 'booth-a1' ? assignableApps : [];
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
    const booth = booths.find((b) => b.id === boothId);
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
    const booth = booths.find((b) => b.id === boothId);
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
    const fromBooth = booths.find((b) => b.id === fromBoothId);
    const toBooth = booths.find((b) => b.id === body.targetBoothId);
    if (!fromBooth || !toBooth || fromBooth.status !== 'SOLD' || (toBooth.status !== 'AVAILABLE' && toBooth.status !== 'RESERVED')) {
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
      fromBooth.holder = { ...fromBooth.holder!, id: fromBooth.applicationId };
      toBooth.holder = { ...toBooth.holder!, id: toBooth.applicationId };
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
    const booth = booths.find((b) => b.id === boothId);
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

test('opens builder and selects a booth', async ({ page }) => {
  await gotoBuilder(page);
  // Click booth A1 on the canvas (simulated by clicking its label in the sidebar list)
  await page.getByTestId('booth-row-a1').click();
  await expect(page.getByRole('tab', { name: 'Properties' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Properties' }).click();
  await expect(page.getByText('A1')).toBeVisible();
});

test('assigns an application from the booth panel', async ({ page }) => {
  await gotoBuilder(page);
  // Select booth A1 (available)
  await page.getByTestId('booth-row-a1').click();
  await page.getByRole('tab', { name: 'Properties' }).click();
  // Click Assign button
  await page.getByRole('button', { name: 'Assign' }).click();
  // Search for vendor
  await page.getByPlaceholder('Search by business name or contact…').fill('Vendor');
  await expect(page.getByText('Vendor Two')).toBeVisible();
  // Click Assign on the vendor
  await page.getByRole('button', { name: 'Assign' }).click();
  // Booth should now show as SOLD
  await expect(page.getByText('Sold')).toBeVisible();
  await expect(page.getByText('Vendor Two')).toBeVisible();
});

test('unassigns a booth from the booth panel', async ({ page }) => {
  await gotoBuilder(page);
  // Select booth A3 (already sold)
  await page.getByTestId('booth-row-a3').click();
  await page.getByRole('tab', { name: 'Properties' }).click();
  await expect(page.getByText('Vendor One')).toBeVisible();
  // Click Unassign
  await page.getByRole('button', { name: 'Unassign' }).click();
  // Booth should now show as Available
  await expect(page.getByText('Available')).toBeVisible();
  await expect(page.getByText('Vendor One')).not.toBeVisible();
});

test('moves a holder to another booth via Move to…', async ({ page }) => {
  await gotoBuilder(page);
  // Select booth A3 (sold)
  await page.getByTestId('booth-row-a3').click();
  await page.getByRole('tab', { name: 'Properties' }).click();
  // Click Move to…
  await page.getByRole('button', { name: 'Move to…' }).click();
  // Click target booth A1 on canvas (simulated by clicking booth row)
  await page.getByTestId('booth-row-a1').click();
  // Booth A3 should now be available, A1 should show the holder
  await expect(page.getByTestId('booth-row-a1')).toContainText('Vendor One');
  await expect(page.getByTestId('booth-row-a3')).toContainText('Available');
});

test('blocks a booth and makes it available again', async ({ page }) => {
  await gotoBuilder(page);
  // Select booth A1 (available)
  await page.getByTestId('booth-row-a1').click();
  await page.getByRole('tab', { name: 'Properties' }).click();
  // Click Block
  await page.getByRole('button', { name: 'Block' }).click();
  await expect(page.getByText('Blocked')).toBeVisible();
  // Click Make available
  await page.getByRole('button', { name: 'Make available' }).click();
  await expect(page.getByText('Available')).toBeVisible();
});

test('sidebar Maps entry navigates to maps list', async ({ page }) => {
  await mockMapsApi(page);
  await page.goto('/admin/dashboard');
  await page.getByRole('link', { name: 'Maps' }).click();
  await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible();
});