// Shift roster on the event's Applications tab (spec 050 §6.4, card 050-S):
// the one SubmissionsTable gains a Shift filter (sent to the server as
// `shift`) and a Shifts column where an assigned shift says so in text.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-roster';
const EVENT_ID = 'evt-roster';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const event = {
  id: EVENT_ID, name: 'Spring Fair', description: null, date: '2031-06-01T20:00:00.000Z', capacity: 100, status: 'PUBLISHED', taxRate: 0,
  organizationId: ORG_ID, organizationName: 'Roster Org',
  venue: { id: 'v1', name: 'Union Hall', address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' },
  priceTiers: [], createdAt: '2031-01-01T00:00:00.000Z', updatedAt: '2031-01-01T00:00:00.000Z',
};
const crew = {
  id: 'form-crew', eventId: EVENT_ID, kind: 'FREE', purpose: 'VOLUNTEER', name: 'Crew', slug: 'crew', status: 'OPEN', questions: [], tiers: [], addOns: [],
  shifts: [{ id: 'sh-gate', name: 'Gate crew' }, { id: 'sh-runner', name: 'Runner' }],
};
const row = (id: string, first: string, status: string, shifts: { id: string; name: string; assigned: boolean }[]) => ({
  id, shortId: id, formId: 'form-crew', formName: 'Crew', formKind: 'FREE', status, paymentStatus: 'NOT_REQUIRED', businessName: null,
  contact: { email: `${first.toLowerCase()}@example.com`, firstName: first, lastName: 'Vol' }, tier: null, applicantPays: 0, addOns: [],
  submittedAt: '2031-05-01T14:00:00.000Z', decidedAt: null, paymentDueAt: null, overdue: false, boothLabel: null, tags: [], shifts,
  checkedInAt: null, checkedOutAt: null, eventId: EVENT_ID,
});
const ROWS = [
  row('app-ana', 'Ana', 'APPROVED', [{ id: 'sh-gate', name: 'Gate crew', assigned: true }, { id: 'sh-runner', name: 'Runner', assigned: false }]),
  row('app-bo', 'Bo', 'SUBMITTED', [{ id: 'sh-runner', name: 'Runner', assigned: false }]),
  row('app-cy', 'Cy', 'SUBMITTED', []),
];

async function mock(page: Page, baseURL: string) {
  const listCalls: URL[] = [];
  await signInAsStaff(page, { id: 'roster-admin', email: 'roster-admin@test.com', role: 'ADMIN' }, baseURL);
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) => route.fulfill(json([{ id: ORG_ID, name: 'Roster Org', status: 'ACTIVE' }])));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill(json(event)));
  await page.route(`${API}/admin/events/${EVENT_ID}/application-forms`, (route) => route.fulfill(json({ data: [crew] })));
  await page.route(`${API}/admin/events/${EVENT_ID}/applications/tags`, (route) => route.fulfill(json({ data: [] })));
  await page.route(new RegExp(`${API}/admin/events/${EVENT_ID}/applications(\\?.*)?$`), (route) => {
    const url = new URL(route.request().url());
    listCalls.push(url);
    const shift = url.searchParams.get('shift');
    const assignedOnly = url.searchParams.get('shiftMode') === 'assigned';
    const data = ROWS.filter((r) => !shift || r.shifts.some((s) => s.id === shift && (!assignedOnly || s.assigned)));
    return route.fulfill(json({ data, total: data.length, page: 1, pageSize: 50, summary: { APPROVED: 1, SUBMITTED: 2 }, awaitingSpace: 0 }));
  });
  return listCalls;
}

test.use({ viewport: { width: 1280, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

test('filters the roster by shift and shows assigned shifts in text', async ({ page, baseURL }) => {
  const calls = await mock(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  const table = page.getByTestId('applications-table');
  await expect(table).toContainText('Cy', { timeout: 30000 });
  await expect(table.getByRole('columnheader', { name: 'Shifts' })).toBeVisible();
  await expect(page.getByTestId('application-shifts-app-ana')).toContainText('Gate crew · assigned');
  await expect(page.getByTestId('application-shifts-app-cy')).toHaveText('—');

  await page.getByTestId('applications-shift-filter').selectOption({ label: 'Picked or on Gate crew' });
  await expect(page).toHaveURL(/shift=sh-gate/);
  await expect.poll(() => calls.at(-1)?.searchParams.get('shift')).toBe('sh-gate');
  await expect(table).not.toContainText('Bo Vol');
  await expect(page.getByTestId('application-row-app-ana')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('[data-testid="applications-table"]').analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);

  // Assigned mode: Ana picked Runner but is not assigned to it.
  await page.getByTestId('applications-shift-filter').selectOption({ label: 'Assigned to Runner' });
  await expect(page).toHaveURL(/shiftMode=assigned/);
  await expect(page).toHaveURL(/shift=sh-runner/);
  await expect(table).toContainText('No applications match');
  await page.getByTestId('applications-shift-filter').selectOption({ label: 'Picked or on Runner' });
  await expect(page).not.toHaveURL(/shiftMode=/);
  await expect(page.getByTestId('application-row-app-ana')).toBeVisible();
  await expect(page.getByTestId('application-row-app-bo')).toBeVisible();

  await page.getByTestId('applications-shift-filter').selectOption({ label: 'Any shift' });
  await expect(page).not.toHaveURL(/shift=/);
  await expect(table).toContainText('Bo');
});

test('a shared ?shift= link shows in the control', async ({ page, baseURL }) => {
  const calls = await mock(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications?shift=sh-gate&shiftMode=assigned`);
  await expect(page.getByTestId('applications-table')).toContainText('Ana', { timeout: 30000 });
  await expect(page.getByTestId('applications-shift-filter')).toHaveValue('sh-gate|assigned');
  await expect(page.getByTestId('application-row-app-bo')).toHaveCount(0);
  expect(calls.at(-1)?.searchParams.get('shiftMode')).toBe('assigned');
});

test('Add a form opens a list of the four application flows; Escape closes it and returns focus (spec 051)', async ({ page, baseURL }) => {
  await mock(page, baseURL!);
  await page.goto(`/admin/events/${EVENT_ID}/applications`);
  await expect(page.getByTestId('applications-table')).toContainText('Cy', { timeout: 30000 });
  const toggle = page.getByRole('button', { name: 'Add a form' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const flow = (path: string) => new RegExp(`^/admin/events/${EVENT_ID}/setup/${path}`);
  await expect(page.getByRole('link', { name: 'Add a vendor application' })).toHaveAttribute('href', flow('vendors'));
  await expect(page.getByRole('link', { name: 'Add special guests' })).toHaveAttribute('href', flow('special-guests\\?step=lineup'));
  await expect(page.getByRole('link', { name: 'Add a volunteer application' })).toHaveAttribute('href', flow('volunteers'));
  await expect(page.getByRole('link', { name: 'Add an application' })).toHaveAttribute('href', flow('other-applications'));
  const a11y = await new AxeBuilder({ page }).include('header').analyze();
  expect(a11y.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Add a vendor application' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});
