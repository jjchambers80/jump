// Guest status page for a form without the business step (spec 050 §6.2: a
// FREE volunteer form with `collectBusiness: false`): the application has no
// profile, so the page must render without one. The API is mocked.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EVENT_ID = 'evt-no-profile';
const APP_ID = 'app-no-profile';

const event = {
  id: EVENT_ID,
  name: 'Crew Fair 2027',
  description: '<p>Volunteers welcome.</p>',
  date: '2027-10-02T15:00:00.000Z',
  capacity: 500,
  status: 'PUBLISHED',
  taxRate: 0,
  organizationId: 'org-no-profile',
  organizationName: 'Crew Org',
  organizationBrandColor: '#0f766e',
  organizationThemeMode: 'LIGHT',
  venue: { id: 'v1', name: 'Hall', address: '1 Main St', city: 'Durham', state: 'NC', timezone: 'America/New_York' },
  priceTiers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const zero = { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' };

test.use({ viewport: { width: 390, height: 844 } });

test('status page renders an application without a business profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(event) }));
  await page.route(`${API}/applications/${APP_ID}/status**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: APP_ID,
        orderRef: null,
        form: { id: 'f-crew', name: 'Crew sign-up', kind: 'FREE' },
        event: { id: EVENT_ID, name: event.name, date: event.date, timezone: 'America/New_York' },
        organization: { id: 'org-no-profile', name: 'Crew Org' },
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        tier: null,
        amounts: zero,
        addOns: [],
        paymentDueAt: null,
        profile: null,
        answers: [{ questionId: 'q1', label: 'Which days are you available?', value: ['Saturday'] }],
        boothLabel: null,
        booth: null,
        submittedAt: '2026-09-16T14:00:00.000Z',
        decidedAt: null,
        paidAt: null,
        refundedTotal: 0,
        canWithdraw: true,
        canResume: false,
        canPay: false,
        canUpdateCard: false,
      }),
    })
  );

  await page.goto(`/events/${EVENT_ID}/apply/status/${APP_ID}?token=tok`);
  const pill = page.getByTestId('apply-status-pill').filter({ visible: true }).first();
  await expect(pill).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Your application' }).filter({ visible: true }).first()).toBeVisible();
  expect(errors).toEqual([]);

  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact || '')
  );
  expect(violations).toEqual([]);
});
