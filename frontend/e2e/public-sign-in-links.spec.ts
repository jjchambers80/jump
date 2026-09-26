// Storefront sign-in links (spec 031): header link on the organization page,
// checkout "Already have an account? Sign in" + prefill, and the toggle
// hiding both. Backend mocked; the buyer session proxy is stubbed.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-signin';
const EVENT_ID = 'evt-signin';
const TIER = { id: 'tier-ga', name: 'General Admission', price: 25 };

function org(buyerSignInLinks: boolean) {
  return { id: ORG_ID, name: 'Sign-in Org', logoUrl: null, coverUrl: null, brandColor: null, themeMode: 'SYSTEM', buyerSignInLinks };
}

function eventResponse(organizationSignInLinks: boolean) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: EVENT_ID,
    name: 'Sign-in Test Event',
    description: 'Fixture',
    date: future.toISOString(),
    imageUrl: null,
    taxRate: 0,
    organizationId: ORG_ID,
    organizationName: 'Sign-in Org',
    organizationLogoUrl: null,
    organizationBrandColor: null,
    organizationThemeMode: 'LIGHT',
    organizationSignInLinks,
    venue: { id: 'venue-1', name: 'Test Hall', address: '1 Main St' },
    priceTiers: [{ ...TIER, description: null, quantityTotal: 100, quantityAvailable: 100, isActive: true, isRefundable: true, minPerOrder: 1, maxPerOrder: 10 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function mockStorefront(page: Page, { links = true, buyer = false } = {}) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organization: org(links), locked: false, events: [] }) })
  );
  await page.route(`${API}/organizations/${ORG_ID}/public/menus`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ main: [], footer: [] }) })
  );
  await page.route(`${API}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eventResponse(links)) })
  );
  await page.route(`${API}/legal/versions`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/buyer/me', (route) =>
    buyer
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', organization: { id: ORG_ID, name: 'Sign-in Org' } }),
        })
      : route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  );
}

const checkoutUrl = `/checkout/${EVENT_ID}?items=${encodeURIComponent(JSON.stringify([{ priceTierId: TIER.id, quantity: 1 }]))}`;

test('header shows Sign in for a guest and Account for a signed-in buyer', async ({ page }) => {
  await mockStorefront(page);
  await page.goto(`/organizations/${ORG_ID}`);
  const link = page.getByTestId('buyer-sign-in-link');
  await expect(link).toHaveText('Sign in');
  await expect(link).toHaveAttribute('href', `/organizations/${ORG_ID}/account`);

  await mockStorefront(page, { buyer: true });
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('buyer-sign-in-link')).toHaveText('Account');
});

test('checkout offers sign-in with a return path and prefills a signed-in buyer', async ({ page }) => {
  await mockStorefront(page);
  await page.goto(checkoutUrl);
  const signIn = page.getByTestId('checkout-sign-in-link');
  await expect(signIn).toBeVisible();
  const href = await signIn.getAttribute('href');
  expect(href).toMatch(new RegExp(`^/organizations/${ORG_ID}/account\\?next=`));
  expect(decodeURIComponent(href!.split('next=')[1])).toBe(checkoutUrl);
  await expect(page.getByLabel('First Name')).toHaveValue('');
  await expect(page.locator('#createAccount')).toBeVisible();

  await mockStorefront(page, { buyer: true });
  await page.goto(checkoutUrl);
  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByLabel('First Name')).toHaveValue('Ada');
  await expect(page.getByLabel('Last Name')).toHaveValue('Lovelace');
  await expect(page.getByLabel('Email Address')).toHaveValue('ada@example.com');
  await expect(page.locator('#createAccount')).toHaveCount(0);
  await expect(page.getByTestId('checkout-sign-in-link')).toHaveCount(0);
});

test('the setting turns both links off', async ({ page }) => {
  await mockStorefront(page, { links: false });
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('organization-header')).toBeVisible();
  await expect(page.getByTestId('buyer-sign-in-link')).toHaveCount(0);

  await page.goto(checkoutUrl);
  await expect(page.getByLabel('First Name')).toBeVisible();
  await expect(page.getByTestId('checkout-sign-in-link')).toHaveCount(0);
});

test('a signed-in buyer landing on the account page with ?next= continues there', async ({ page }) => {
  await mockStorefront(page, { buyer: true });
  await page.route('**/api/buyer/me/orders', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.route('**/api/buyer/me/tickets', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.goto(`/organizations/${ORG_ID}/account?next=${encodeURIComponent(checkoutUrl)}`);
  // The dev server may still be compiling the checkout route on a cold run.
  await expect(page).toHaveURL(new RegExp(`/checkout/${EVENT_ID}`), { timeout: 20_000 });

  // Off-site targets are ignored.
  await page.goto(`/organizations/${ORG_ID}/account?next=${encodeURIComponent('https://evil.test/')}`);
  await expect(page).toHaveURL(new RegExp(`/organizations/${ORG_ID}/account`));
});
