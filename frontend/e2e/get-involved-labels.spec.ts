// "Get involved" pills (spec 050 §6.2, card 050-B): the short label comes from
// each form's `purpose`, never from its name. The API is mocked.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EVENT_ID = 'evt-get-involved';

function eventResponse() {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Get Involved Fixture',
    description: '<p>Fixture for the Get involved pills.</p>',
    date: future.toISOString(),
    taxRate: 0,
    organizationBrandColor: null,
    organizationThemeMode: 'LIGHT',
    admissionMode: 'TICKETED',
    venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [
      { id: 'tier-1', name: 'General', description: null, price: 10, quantityTotal: 100, quantitySold: 0, quantityReserved: 0, quantityAvailable: 100, displayOrder: 0, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Names deliberately say nothing about the role: only `purpose` can produce the label.
const FORMS: [string, string, string][] = [
  ['VENDOR', 'Market hall 2027', 'Become a vendor'],
  ['SPONSOR', 'Partner packages', 'Become a sponsor'],
  ['PRESS', 'Accreditation', 'Press pass'],
  ['PANEL', 'Stage program', 'Host a panel'],
  ['SPECIAL_GUEST', 'Celebrity row', 'Apply as a guest'],
  ['VOLUNTEER', 'Crew sign-up', 'Volunteer'],
  ['OTHER', 'Something else', 'Apply'],
];

async function mockEvent(page: Page) {
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventResponse()) })
  );
  await page.route(`${API}/events/${EVENT_ID}/applications/forms`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: FORMS.map(([purpose, name], i) => ({
          id: `f-${i}`, purpose, name, slug: `form-${i}`, kind: 'FREE', intro: null,
          acceptance: { open: true, reason: null }, chargeTiming: null, feeMode: null, tiers: [], questions: [],
        })),
      }),
    })
  );
  await page.route(`${API}/events/${EVENT_ID}/map`, (route) => route.fulfill({ status: 404, body: '{}' }));
}

test.use({ viewport: { width: 390, height: 844 } });

test('pill labels come from the form purpose', async ({ page }) => {
  await mockEvent(page);
  await page.goto(`/events/${EVENT_ID}`);

  const strip = page.getByTestId('get-involved').filter({ visible: true }).first();
  await expect(strip).toBeVisible({ timeout: 30000 });
  for (const [, name, label] of FORMS) {
    const link = strip.getByRole('link', { name: `${label}: ${name}`, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(label);
  }

  const violations = (await new AxeBuilder({ page }).include('[data-testid="get-involved"]').analyze()).violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact || '')
  );
  expect(violations).toEqual([]);
});
