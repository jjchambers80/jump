// Apply page "Pick your shifts" step (spec 050 §6.4, card 050-R): a FREE
// VOLUNTEER form lists its shifts in the venue zone, a full shift says "Full"
// and stays pickable, and the picks are sent with the submission. Phone
// viewport, axe, reduced motion. The API is mocked.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockLegalVersions } from './helpers/legal';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EVENT_ID = 'evt-shifts';
const APP_ID = 'app-shifts';

const event = {
  id: EVENT_ID,
  name: 'Crew Fair 2027',
  description: '<p>Volunteers welcome.</p>',
  date: '2027-09-18T15:00:00.000Z',
  capacity: 500,
  status: 'PUBLISHED',
  taxRate: 0,
  organizationId: 'org-shifts',
  organizationName: 'Crew Org',
  organizationBrandColor: '#0f766e',
  organizationThemeMode: 'LIGHT',
  venue: { id: 'v1', name: 'Hall', address: '1 Main St', city: 'Durham', state: 'NC', timezone: 'America/New_York' },
  priceTiers: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const form = {
  id: 'f-crew',
  kind: 'FREE',
  purpose: 'VOLUNTEER',
  name: 'Crew sign-up',
  slug: 'crew',
  intro: null,
  collectBusiness: false,
  acceptance: { open: true, reason: null },
  chargeTiming: null,
  feeMode: null,
  organizationName: 'Crew Org',
  tiers: [],
  questions: [],
  timezone: 'America/New_York',
  shifts: [
    { id: 'sh-gate', name: 'Gate', description: 'Scan tickets', startsAt: '2027-09-18T13:00:00.000Z', endsAt: '2027-09-18T17:00:00.000Z', remaining: 0, full: true },
    { id: 'sh-setup', name: 'Setup', description: null, startsAt: '2027-09-17T22:00:00.000Z', endsAt: null, remaining: 3, full: false },
    { id: 'sh-runner', name: 'Runner', description: null, startsAt: null, endsAt: null, remaining: null, full: false },
  ],
};

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: 'reduce' } });

test('volunteer picks shifts, a full one included, and they are submitted', async ({ page }) => {
  let payload: Record<string, unknown> | null = null;
  await mockLegalVersions(page, API);
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/events/${EVENT_ID}/applications/forms/crew`, (route) => route.fulfill(json(form)));
  await page.route(`${API}/events/${EVENT_ID}/applications`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const m = (route.request().postData() || '').match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/);
    payload = m ? JSON.parse(m[1]) : null;
    return route.fulfill(json({ applicationId: APP_ID, statusUrl: `http://localhost:3001/events/${EVENT_ID}/apply/status/${APP_ID}?token=t`, next: 'done' }, 201));
  });
  await page.route(`${API}/applications/${APP_ID}/status**`, (route) => route.fulfill(json({ error: 'NotFoundError', message: 'Application not found' }, 404)));

  await page.goto(`/events/${EVENT_ID}/apply/crew`);
  const picker = page.getByRole('group', { name: 'Shifts you can work' });
  await expect(picker).toBeVisible();
  await expect(page.getByRole('heading', { name: /Pick your shifts/ })).toBeVisible();

  // Venue wall clock with the zone, and Full as text (not colour alone).
  await expect(picker.getByText('Sat, Sep 18, 2027 · 9:00 AM EDT – 1:00 PM EDT')).toBeVisible();
  await expect(picker.getByText('Full', { exact: true })).toBeVisible();
  await expect(picker.getByText('3 spots left')).toBeVisible();

  const gate = picker.getByRole('checkbox', { name: /Gate/ });
  await expect(gate).toBeEnabled();
  const box = await gate.locator('xpath=ancestor::label').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);

  await page.getByLabel('First name').fill('Val');
  await page.getByLabel('Last name').fill('Unteer');
  await page.getByLabel('Email', { exact: true }).fill('val@example.com');
  await gate.check();
  await picker.getByRole('checkbox', { name: /Runner/ }).check();
  await page.getByTestId('apply-consent').check();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}/apply/status/${APP_ID}`));
  expect(payload).toMatchObject({ formSlug: 'crew', shiftIds: ['sh-gate', 'sh-runner'] });
});
