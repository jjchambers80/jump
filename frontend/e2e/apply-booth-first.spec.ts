// Booth-first apply form (spec 037): the vendor picks their booth on the form,
// before submitting. Backend mocked — this covers the surface, not the hold;
// the hold is proved in backend/tests/contract/boothFirstApplication.test.js.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';

const EVENT = {
  id: 'ev-bf',
  slug: 'ev-bf',
  name: 'Booth First Expo',
  date: '2027-06-01T15:00:00.000Z',
  status: 'PUBLISHED',
  capacity: 100,
  venue: { id: 've-1', name: 'Hall', address: '1 St', city: 'Raleigh', state: 'NC' },
  priceTiers: [],
  organizationId: 'org-bf',
  organizationName: 'Booth First Org',
  organizationLogoUrl: null,
  organizationBrandColor: '#b91c1c',
  organizationThemeMode: 'SYSTEM',
  taxRate: 0,
  taxInclusivePricing: false,
};

const FORM = {
  id: 'form-1',
  kind: 'PAID',
  name: 'Vendors',
  slug: 'vendors',
  intro: null,
  acceptance: { open: true, reason: null },
  chargeTiming: 'APPROVAL',
  feeMode: 'ABSORB',
  paymentDueDays: 7,
  organizationName: 'Booth First Org',
  tiers: [
    {
      id: 't-1',
      name: '10×10 booth',
      description: 'One 10 by 10 space',
      price: 275,
      applicantPays: 275,
      feesIncluded: 0,
      tax: 0,
      soldOut: false,
      boothFirst: true,
      addOns: [],
    },
  ],
  questions: [],
};

const MAP = {
  id: 'map-1',
  eventId: 'ev-bf',
  name: 'Main hall',
  width: 40,
  height: 20,
  unit: 'ft',
  gridSize: 10,
  underlayUrl: null,
  underlayOpacity: 40,
  layout: { version: 1, elements: [] },
  legend: [{ tierId: 't-1', name: '10×10 booth', price: 275, swatch: 0 }],
  vendors: [],
  booths: [
    { id: 'b-1', label: 'A1', kind: 'BOOTH', x: 0, y: 0, w: 10, h: 10, rotation: 0, status: 'SOLD', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: 'Acme Crafts' },
    { id: 'b-2', label: 'A2', kind: 'BOOTH', x: 12, y: 0, w: 10, h: 10, rotation: 0, status: 'AVAILABLE', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: null },
    { id: 'b-3', label: 'A3', kind: 'BOOTH', x: 24, y: 0, w: 10, h: 10, rotation: 0, status: 'AVAILABLE', tier: { id: 't-1', name: '10×10 booth', price: 275 }, vendorName: null },
  ],
  brandColor: '#b91c1c',
  themeMode: 'SYSTEM',
  updatedAt: '2026-09-25T00:00:00.000Z',
  etag: '"1"',
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockApply(page: Page, { boothFirst = true } = {}) {
  // Anything else the storefront shell reaches for is not part of this surface.
  // Registered first: Playwright tries the most recently added route first, so
  // a catch-all added last would answer every request below with `{}`.
  await page.route(`${API}/**`, (route) => route.fulfill(json({})));
  await page.route(`${API}/events/ev-bf/meta*`, (route) => route.fulfill(json({ slug: 'ev-bf' })));
  await page.route(`${API}/events/ev-bf/applications/forms/vendors*`, (route) =>
    route.fulfill(json({ ...FORM, tiers: [{ ...FORM.tiers[0], boothFirst }] }))
  );
  await page.route(`${API}/events/ev-bf/map*`, (route) =>
    route.fulfill({ ...json(MAP), headers: { 'Cache-Control': 'no-store', ETag: MAP.etag } })
  );
  await page.route(`${API}/events/ev-bf*`, (route) => route.fulfill(json(EVENT)));
  await page.route(`${API}/legal/versions*`, (route) =>
    route.fulfill(json({ terms: '1', privacy: '1', cardAuthorization: '1', vendorTerms: '1', refundPolicy: '1' }))
  );
  await page.route(`${API}/organizations/org-bf/public/menus*`, (route) => route.fulfill(json({ main: [], footer: [] })));
}

/** Fill everything the form needs apart from the booth. */
async function fillApplicant(page: Page) {
  await page.getByLabel('First name').fill('Vee');
  await page.getByLabel('Last name').fill('Vendor');
  await page.getByLabel('Email').first().fill('vee@example.test');
  await page.getByLabel(/business|outlet/i).first().fill('Hidden Block Games');
  await page.getByTestId('apply-card-authorization').check();
  for (const box of await page.locator('input[type="checkbox"][required]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
}

test.describe('booth-first apply form', () => {
  test('picks a booth on the form and sends it with the submission', async ({ page }) => {
    await mockApply(page);
    let submitted: any = null;
    await page.route(`${API}/events/ev-bf/applications`, async (route) => {
      // The form posts multipart (photos ride along); the JSON is the `payload` part.
      const raw = route.request().postData() ?? '';
      const part = raw.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/);
      submitted = part ? JSON.parse(part[1]) : {};
      await route.fulfill(json({ applicationId: 'app-1', statusUrl: 'http://localhost:3001/events/ev-bf/apply/status/app-1?token=t', next: 'done' }, 201));
    });

    await page.goto('/events/ev-bf/apply/vendors');
    await expect(page.getByTestId('apply-booth-step')).toBeVisible();

    // A sold booth is not selectable; an available one in the tier is.
    await expect(page.getByTestId('booth-A1')).toBeDisabled();
    await expect(page.getByTestId('apply-booth-selected')).toHaveCount(0);

    await page.getByTestId('booth-A2').click();
    await expect(page.getByTestId('apply-booth-selected')).toContainText('A2');

    // test-results/ is gitignored; this is the evidence shot for the new step.
    await page.screenshot({ path: 'test-results/apply-booth-first-step.png', fullPage: true });

    await fillApplicant(page);
    await page.getByTestId('apply-form').locator('button[type="submit"]').click();

    await expect.poll(() => submitted?.boothId).toBe('b-2');
    expect(submitted.tierId).toBe('t-1');
  });

  test('refuses to submit without a booth', async ({ page }) => {
    await mockApply(page);
    let called = false;
    await page.route(`${API}/events/ev-bf/applications`, async (route) => {
      called = true;
      await route.fulfill(json({ applicationId: 'app-1' }, 201));
    });

    await page.goto('/events/ev-bf/apply/vendors');
    await fillApplicant(page);
    await page.getByTestId('apply-form').locator('button[type="submit"]').click();

    await expect(page.getByRole('alert').filter({ hasText: /choose a booth/i })).toBeVisible();
    expect(called).toBe(false);
  });

  test('clears the selection and says so when the booth is taken mid-form', async ({ page }) => {
    await mockApply(page);
    await page.route(`${API}/events/ev-bf/applications`, (route) =>
      route.fulfill(json({ error: 'Conflict', code: 'BOOTH_TAKEN', message: 'This booth is no longer available' }, 409))
    );

    await page.goto('/events/ev-bf/apply/vendors');
    await page.getByTestId('booth-A2').click();
    await expect(page.getByTestId('apply-booth-selected')).toContainText('A2');

    await fillApplicant(page);
    await page.getByTestId('apply-form').locator('button[type="submit"]').click();

    // The applicant must be told to pick again, and the stale pick must go —
    // nothing was created server-side.
    await expect(page.getByRole('alert').filter({ hasText: /just taken/i })).toBeVisible();
    await expect(page.getByTestId('apply-booth-selected')).toHaveCount(0);
  });

  test('shows no map step on a tier that is not sold from the floor map', async ({ page }) => {
    await mockApply(page, { boothFirst: false });
    await page.goto('/events/ev-bf/apply/vendors');
    await expect(page.getByTestId('apply-price-note')).toBeVisible();
    await expect(page.getByTestId('apply-booth-step')).toHaveCount(0);
  });
});
