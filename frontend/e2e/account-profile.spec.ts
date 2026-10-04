// Patron account settings (spec 040 card B): profile save, verified email
// change, marketing switch, RSVPs, printable receipt, email confirmation and
// one-click unsubscribe pages. Backend and buyer proxies mocked.

import { expect, test, type Page, type Route } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG_ID = 'org-profile';
const ORG = { id: ORG_ID, name: 'Profile Org', logoUrl: null, coverUrl: null, brandColor: '#9d174d', themeMode: 'SYSTEM', buyerSignInLinks: true };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const future = new Date(Date.now() + 20 * 86400000).toISOString();
const past = new Date(Date.now() - 40 * 86400000).toISOString();

const ME = {
  id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', phone: null, location: null,
  emailSubscribed: false, pendingEmail: null,
  marketingConsentText: 'Email me news and offers from Profile Org. I can turn this off at any time.',
  organization: { id: ORG_ID, name: 'Profile Org' },
};

async function mockAccount(page: Page, extra: { rsvps?: unknown[] } = {}) {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me', (r) => r.fulfill(json(ME)));
  await page.route('**/api/buyer/me/tickets', (r) => r.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/orders', (r) => r.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/applications', (r) => r.fulfill(json({ data: [] })));
  await page.route('**/api/buyer/me/rsvps', (r) => r.fulfill(json({ data: extra.rsvps ?? [] })));
}

test('profile: saves only the changed fields and reports it', async ({ page }) => {
  await mockAccount(page);
  const patches: unknown[] = [];
  await page.route('**/api/buyer/me', (r: Route) => {
    if (r.request().method() === 'PATCH') {
      patches.push(r.request().postDataJSON());
      return r.fulfill(json({ ...ME, ...r.request().postDataJSON() }));
    }
    return r.fulfill(json(ME));
  });
  await page.goto(`/organizations/${ORG_ID}/account/profile`);

  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Phone').fill('+1 919 555 0100');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(patches).toEqual([{ phone: '+1 919 555 0100' }]);
  await expect(save).toBeDisabled();
});

test('profile: an email change waits on the link sent to the new address and can be cancelled', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/email', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill(json({ pendingEmail: 'grace@example.com' }, 202))
      : r.fulfill(json({ pendingEmail: null }))
  );
  await page.goto(`/organizations/${ORG_ID}/account/profile`);

  await page.getByRole('button', { name: 'Change email' }).click();
  await page.getByLabel('New email address').fill('not-an-email');
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('Enter a valid email address');

  await page.getByLabel('New email address').fill('grace@example.com');
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  const pending = page.getByTestId('profile-email-pending');
  await expect(pending).toContainText('grace@example.com');
  await expect(page.getByTestId('profile-email')).toHaveText('ada@example.com');

  await pending.getByRole('button', { name: 'Cancel change' }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change email' })).toBeVisible();
});

test('profile: an address already used here is refused with the server message', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/email', (r) => r.fulfill(json({ message: 'That email address already belongs to another account here', code: 'EMAIL_IN_USE' }, 409)));
  await page.goto(`/organizations/${ORG_ID}/account/profile`);
  await page.getByRole('button', { name: 'Change email' }).click();
  await page.getByLabel('New email address').fill('taken@example.com');
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('That email address already belongs to another account here');
});

test('preferences: the switch shows the consent label and saves each flip', async ({ page }) => {
  await mockAccount(page);
  const bodies: unknown[] = [];
  await page.route('**/api/buyer/me/preferences', (r) => {
    bodies.push(r.request().postDataJSON());
    return r.fulfill(json(r.request().postDataJSON()));
  });
  await page.goto(`/organizations/${ORG_ID}/account/preferences`);

  const toggle = page.getByRole('switch', { name: 'News and offers' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(ME.marketingConsentText)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).toHaveText("You'll get news and offers from Profile Org.");
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(bodies).toEqual([{ emailSubscribed: true }, { emailSubscribed: false }]);
});

test('preferences: a failed save puts the switch back', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/preferences', (r) => r.fulfill(json({ message: 'Server said no' }, 500)));
  await page.goto(`/organizations/${ORG_ID}/account/preferences`);
  const toggle = page.getByRole('switch', { name: 'News and offers' });
  await toggle.click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('Server said no');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('RSVPs: tab appears with RSVPs, upcoming ones cancel, past ones do not', async ({ page }) => {
  const venue = { name: 'Hall', city: 'Raleigh', state: 'NC' };
  const rsvps = [
    { id: 'r1', partySize: 3, status: 'GOING', cancelledAt: null, createdAt: past, event: { id: 'e1', slug: 'picnic', name: 'Picnic', date: future, timezone: 'America/New_York', venue } },
    { id: 'r2', partySize: 1, status: 'GOING', cancelledAt: null, createdAt: past, event: { id: 'e2', slug: null, name: 'Old Meetup', date: past, timezone: 'America/New_York', venue } },
  ];
  await mockAccount(page, { rsvps });
  let cancelled = false;
  await page.route('**/api/buyer/me/rsvps/r1/cancel', (r) => {
    cancelled = true;
    return r.fulfill(json({ status: 'ok' }));
  });
  await page.goto(`/organizations/${ORG_ID}/account`);
  await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'RSVPs' }).click();
  await expect(page).toHaveURL(/\/account\/rsvps$/);

  const upcoming = page.getByRole('list', { name: 'Upcoming RSVPs' });
  await expect(upcoming.getByTestId('account-rsvp')).toHaveCount(1);
  await expect(upcoming).toContainText('Party of 3');
  await expect(page.getByRole('list', { name: 'Past' }).getByRole('button', { name: 'Cancel RSVP' })).toHaveCount(0);

  page.once('dialog', (d) => d.accept());
  await upcoming.getByRole('button', { name: 'Cancel RSVP' }).click();
  await expect(page.getByRole('status')).toHaveText('Your RSVP for Picnic is cancelled.');
  expect(cancelled).toBe(true);
});

test('receipt: lines, totals and refunds, with the account chrome hidden when printed', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/buyer/me/orders/o1/receipt', (r) =>
    r.fulfill(json({
      id: 'o1', orderRef: 'JMP-ABC123', kind: 'TICKET', status: 'PARTIALLY_REFUNDED',
      organization: { name: 'Profile Org', logoUrl: null },
      event: { name: 'Spring Fair', date: future, timezone: 'America/New_York', venue: { name: 'Hall', city: 'Raleigh', state: 'NC' } },
      billedTo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      createdAt: past, paidAt: past, paymentSource: 'STRIPE', offlineMethod: null,
      lines: [{ description: 'GA', quantity: 2, unitPrice: 20, amount: 40 }],
      subtotal: 40, fees: 3.22, tax: 2.9, total: 46.12, currency: 'usd',
      refunds: [{ amount: 20, feeRetained: 0, createdAt: past }],
    }))
  );
  await page.goto(`/organizations/${ORG_ID}/account/orders/o1/receipt`);

  const receipt = page.getByTestId('receipt');
  await expect(receipt.getByRole('heading', { name: 'Receipt' })).toBeVisible();
  await expect(receipt).toContainText('JMP-ABC123');
  await expect(receipt.getByRole('row', { name: /GA/ })).toContainText('$40.00');
  await expect(page.getByTestId('receipt-total')).toHaveText('$46.12');
  await expect(receipt).toContainText('Net');
  await expect(receipt).toContainText('$26.12');
  await expect(page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Account' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(receipt).toBeVisible();
});

test('email confirmation page: success and a dead link', async ({ page }) => {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  await page.route('**/api/buyer/me/email/confirm', (r) =>
    r.request().postDataJSON().token === 'good'
      ? r.fulfill(json({ organizationId: ORG_ID, email: 'grace@example.com' }))
      : r.fulfill(json({ message: 'This confirmation link is invalid or has expired' }, 400))
  );
  await page.goto(`/organizations/${ORG_ID}/account/email-confirm?token=good`);
  await expect(page.getByRole('heading', { name: 'Email address updated' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('grace@example.com');

  await page.goto(`/organizations/${ORG_ID}/account/email-confirm?token=bad`);
  await expect(page.getByRole('heading', { name: "That link didn't work" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try again from your profile' })).toHaveAttribute('href', `/organizations/${ORG_ID}/account/profile`);
});

test('unsubscribe page: loading changes nothing, one click unsubscribes', async ({ page }) => {
  await page.route(`${API}/organizations/${ORG_ID}/public`, (r) => r.fulfill(json({ organization: ORG, locked: false, events: [] })));
  const posts: string[] = [];
  await page.route('**/api/buyer/unsubscribe?t=*', (r) => {
    if (r.request().method() === 'POST') {
      posts.push(r.request().url());
      return r.fulfill(json({ organization: { id: ORG_ID, name: 'Profile Org' }, email: 'a•••@example.com', emailSubscribed: false }));
    }
    return r.fulfill(json({ organization: { id: ORG_ID, name: 'Profile Org' }, email: 'a•••@example.com', emailSubscribed: true }));
  });
  await page.goto(`/organizations/${ORG_ID}/account/unsubscribe?t=c1.sig`);
  await expect(page.getByRole('heading', { name: 'Unsubscribe from Profile Org?' })).toBeVisible();
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('heading', { name: "You're unsubscribed" })).toBeVisible();
  expect(posts).toHaveLength(1);
});
