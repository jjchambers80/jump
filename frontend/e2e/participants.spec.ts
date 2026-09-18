// Participants (spec 019 phase 1): the organization-wide submissions list
// and the per-event tab rendering the same table. Backend mocked at the
// network layer.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-parts';
const EXPO = { id: 'evt-expo', name: 'Gaming Geek Expo 2027', date: '2027-09-18T15:00:00.000Z', status: 'PUBLISHED' };
const CON = { id: 'evt-con', name: 'Winter Con', date: '2027-01-10T15:00:00.000Z', status: 'PUBLISHED' };

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const forms = [
  { id: 'form-press', eventId: EXPO.id, event: EXPO, kind: 'FREE', name: 'Press & Media', slug: 'press-media', status: 'OPEN', opensAt: null, closesAt: null, acceptance: { open: true, reason: null }, applicationCount: 2, pinnedQuestions: [{ id: 'q-outlet', label: 'Outlet', type: 'SHORT_TEXT' }, { id: 'q-insurance', label: 'Proof of insurance', type: 'CHECKBOX' }], addOns: [], updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'form-vendor', eventId: EXPO.id, event: EXPO, kind: 'PAID', name: 'Vendor Space', slug: 'vendor-space', status: 'OPEN', opensAt: null, closesAt: null, acceptance: { open: true, reason: null }, applicationCount: 1, pinnedQuestions: [], addOns: [{ id: 'addon-power', name: 'Booth power' }], updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'form-panels', eventId: CON.id, event: CON, kind: 'FREE', name: 'Panels', slug: 'panels', status: 'DRAFT', opensAt: null, closesAt: null, acceptance: { open: false, reason: 'not_published' }, applicationCount: 1, pinnedQuestions: [], addOns: [], updatedAt: '2026-09-01T00:00:00.000Z' },
];

type Row = Record<string, any>;
function row(over: Row): Row {
  return {
    formId: 'form-press',
    formName: 'Press & Media',
    formKind: 'FREE',
    status: 'SUBMITTED',
    paymentStatus: 'NOT_REQUIRED',
    contact: { email: 'pat@retroweekly.example', firstName: 'Pat', lastName: 'Press' },
    tier: null,
    applicantPays: 0,
    addOns: [],
    submittedAt: '2026-09-16T14:00:00.000Z',
    decidedAt: null,
    paymentDueAt: null,
    overdue: false,
    boothLabel: null,
    tags: [],
    checkedInAt: null,
    checkedOutAt: null,
    pinnedAnswers: [],
    logoUrl: null,
    statusUrl: 'http://localhost:3001/events/evt-expo/apply/status/app-1?token=tok',
    ...over,
  };
}

const rows: Row[] = [
  row({ id: 'app-retroweekly', shortId: 'ROWEEKLY', eventId: EXPO.id, event: EXPO, businessName: 'Retro Weekly', boothLabel: 'Media row 3', tags: ['Sponsor', 'Returning'], pinnedAnswers: [{ questionId: 'q-outlet', label: 'Outlet', type: 'SHORT_TEXT', value: 'Retro Weekly Magazine' }, { questionId: 'q-insurance', label: 'Proof of insurance', type: 'CHECKBOX', value: 'true' }] }),
  row({ id: 'app-pixelpins1', shortId: 'XELPINS1', eventId: EXPO.id, event: EXPO, businessName: 'Pixel Pins', formId: 'form-vendor', formName: 'Vendor Space', formKind: 'PAID', paymentStatus: 'CARD_ON_FILE', tier: { id: 't1', name: '10x10' }, applicantPays: 303.3, contact: { email: 'pins@example.com', firstName: 'Pix', lastName: 'Pins' }, submittedAt: '2026-09-16T12:00:00.000Z' }),
  row({ id: 'app-piatalks01', shortId: 'ATALKS01', eventId: CON.id, event: CON, businessName: 'Pia Talks', formId: 'form-panels', formName: 'Panels', status: 'APPROVED', contact: { email: 'pia@example.com', firstName: 'Pia', lastName: 'Panel' }, submittedAt: '2026-09-15T10:00:00.000Z', decidedAt: '2026-09-16T09:00:00.000Z' }),
];

function adminApp(r: Row) {
  return {
    id: r.id,
    form: { id: r.formId, name: r.formName, slug: 'x', kind: r.formKind, chargeTiming: 'APPROVAL', feeMode: 'PASS', paymentDueDays: 7, overduePolicy: 'WITHDRAW' },
    event: r.event,
    status: r.status,
    paymentStatus: r.paymentStatus,
    capacitySlot: 'NONE',
    contact: { id: 'c1', ...r.contact, accountCreatedAt: null },
    profile: { id: 'p1', businessName: r.businessName, description: null, website: null, socials: {}, photos: [], updatedAt: '2026-09-16T14:00:00.000Z' },
    tier: null,
    amounts: { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: 'PASS', currency: 'usd' },
    pricing: null,
    addOns: [],
    addOnsEditable: { allowed: true, reason: null },
    adjustments: [],
    amountEditable: { allowed: true, reason: null },
    canSettleOffline: false,
    paymentSource: 'stripe',
    offlinePayment: null,
    payment: { stripePaymentIntentId: null, stripePaymentMethodId: null, stripeAccountId: null, applicationFee: null, chargeAttempts: 0, lastChargeError: null, paidAt: null, refundedTotal: 0, payNowUrl: null },
    answers: [],
    decisions: [],
    refunds: [],
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
    decidedById: null,
    withdrawnBy: null,
    withdrawReason: null,
    boothLabel: r.boothLabel,
    internalNote: null,
    tags: r.tags,
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
  };
}

async function mockAdmin(page: Page, baseURL: string, role: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN' = 'ORGANIZER') {
  await signInAsStaff(page, { id: `parts-${role.toLowerCase()}`, email: `parts-${role.toLowerCase()}@test.com`, role }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json([{ id: ORG_ID, name: 'Raleigh Retro Gamers', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])) : route.fallback()
  );
  await page.route(`${API}/events/${EXPO.id}`, (route) => route.fulfill(json({ ...EXPO, organizationId: ORG_ID, venue: { id: 'v1', name: 'RCC' }, priceTiers: [] })));

  const state = { rows: rows.map((r) => ({ ...r })) };
  const calls: { method: string; path: string; search: string; body?: unknown }[] = [];
  const summaryOf = (list: Row[]) => list.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const filtered = (url: URL, scope: Row[]) => {
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q')?.toLowerCase();
    const event = url.searchParams.get('event');
    const tag = url.searchParams.get('tag');
    const form = url.searchParams.get('form');
    const sort = url.searchParams.get('sort');
    let data = scope.filter(
      (r) =>
        (!status || status.split(',').includes(r.status)) &&
        (!event || r.eventId === event) &&
        (!form || r.formId === form) &&
        (!tag || r.tags.includes(tag)) &&
        (!q || r.businessName.toLowerCase().includes(q) || r.shortId.toLowerCase() === q || r.formName.toLowerCase().includes(q) || r.tags.some((t: string) => t.toLowerCase() === q))
    );
    if (sort === 'status') data = [...data].sort((a, b) => a.status.localeCompare(b.status));
    if (sort === 'status_desc') data = [...data].sort((a, b) => b.status.localeCompare(a.status));
    return data;
  };

  await page.route(`${API}/admin/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? undefined : req.postDataJSON();
    calls.push({ method, path, search: url.search, body });

    if (path === '/admin/applications' && method === 'GET') {
      const data = filtered(url, state.rows);
      return route.fulfill(json({ data, total: data.length, page: 1, pageSize: Number(url.searchParams.get('pageSize') || 25), summary: summaryOf(state.rows) }));
    }
    if (path === '/admin/applications/summary') return route.fulfill(json(summaryOf(state.rows)));
    if (path === '/admin/applications/tags') return route.fulfill(json({ data: [...new Set(state.rows.flatMap((r) => r.tags as string[]))].sort() }));
    if (path === '/admin/application-forms' && method === 'GET') return route.fulfill(json({ data: forms }));
    if (path === '/admin/application-templates' && method === 'GET') return route.fulfill(json({ data: [] }));
    if (path === '/admin/applications/bulk' && method === 'POST') {
      const { ids, decision } = body as { ids: string[]; decision: string };
      const to = decision === 'WAITLIST' ? 'WAITLISTED' : decision === 'REJECT' ? 'REJECTED' : 'APPROVED';
      for (const r of state.rows) if (ids.includes(r.id)) r.status = to;
      return route.fulfill(json({ results: ids.map((id) => ({ id, ok: true })), succeeded: ids.length, failed: 0 }));
    }
    // Per-event mount and per-row actions.
    const perEvent = path.match(/^\/admin\/events\/([^/]+)\/applications(?:\/([^/]+))?(?:\/(preview|decision))?$/);
    if (perEvent) {
      const [, eventId, id, action] = perEvent;
      const scope = state.rows.filter((r) => r.eventId === eventId);
      if (!id && method === 'GET') {
        const data = filtered(url, scope);
        return route.fulfill(json({ data, total: data.length, page: 1, pageSize: 50, summary: summaryOf(scope) }));
      }
      if (id === 'summary') return route.fulfill(json(summaryOf(scope)));
      if (id === 'tags') return route.fulfill(json({ data: [...new Set(scope.flatMap((r) => r.tags as string[]))].sort() }));
      const r = state.rows.find((x) => x.id === id);
      if (!r) return route.fulfill(json({ error: 'NotFoundError', message: 'Application not found' }, 404));
      if (method === 'PATCH') {
        const b = body as { tags?: string[]; checkedIn?: boolean; checkedOut?: boolean; boothLabel?: string | null; internalNote?: string | null };
        if ((b.checkedIn !== undefined || b.checkedOut !== undefined) && r.status !== 'APPROVED') return route.fulfill(json({ error: 'ConflictError', message: 'Only approved applications can be checked in' }, 409));
        if (b.tags) r.tags = b.tags;
        if (b.checkedIn !== undefined) r.checkedInAt = b.checkedIn ? r.checkedInAt ?? '2026-09-18T15:00:00.000Z' : null;
        if (b.checkedOut !== undefined) r.checkedOutAt = b.checkedOut ? r.checkedOutAt ?? '2026-09-18T18:00:00.000Z' : null;
        if (b.boothLabel !== undefined) r.boothLabel = b.boothLabel;
        return route.fulfill(json(adminApp(r)));
      }
      if (action === 'preview') return route.fulfill(json({ subject: `You are on the waitlist for ${r.event.name}`, body: `${r.businessName} is on the waitlist.` }));
      if (action === 'decision') {
        r.status = (body as { decision: string }).decision === 'WAITLIST' ? 'WAITLISTED' : 'APPROVED';
        return route.fulfill(json(adminApp(r)));
      }
      if (method === 'GET') return route.fulfill(json(adminApp(r)));
    }
    if (path.match(/^\/admin\/events\/[^/]+\/application-forms$/)) {
      const eventId = path.split('/')[3];
      return route.fulfill(json({ data: forms.filter((f) => f.eventId === eventId).map((f) => ({ ...f, tiers: [], questions: f.pinnedQuestions.map((q, i) => ({ ...q, helpText: null, required: false, options: [], displayOrder: i, pinned: true })), addOns: f.addOns.map((a) => ({ ...a, price: 10, allTiers: true, isActive: true, scope: 'APPLICATION' })) })) }));
    }
    return route.fulfill(json({ error: 'NotFoundError', message: `Unmocked ${method} ${path}` }, 404));
  });
  return { state, calls };
}

test('sidebar entry and the org-wide list: events, short ids, tags, status sort, search by id', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants');
  await expect(page.getByRole('heading', { name: 'Participants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Participants' }).first()).toHaveAttribute('href', '/admin/participants');
  await expect(page.getByTestId('applications-summary')).toContainText('All 3');

  const table = page.getByTestId('applications-table');
  await expect(table).toContainText('Retro Weekly');
  await expect(table).toContainText('Pia Talks');
  await expect(page.getByTestId('application-event-app-piatalks01')).toContainText('Winter Con');
  await expect(page.getByTestId('application-row-app-retroweekly')).toContainText('ID: ROWEEKLY');
  await expect(page.getByTestId('application-tags-app-retroweekly')).toContainText('Media row 3');
  await expect(page.getByTestId('application-tags-app-retroweekly')).toContainText('Sponsor');
  await expect(page.getByRole('link', { name: 'Retro Weekly' })).toHaveAttribute('href', `/admin/events/${EXPO.id}/applications/app-retroweekly`);

  await page.getByTestId('applications-sort-status').click();
  await expect(page).toHaveURL(/sort=status&/);
  await page.getByTestId('applications-sort-status').click();
  await expect(page).toHaveURL(/sort=status_desc/);
  await expect.poll(() => calls.some((c) => c.path === '/admin/applications' && c.search.includes('sort=status_desc'))).toBe(true);

  await page.getByLabel('Event').selectOption(CON.id);
  await expect(page).toHaveURL(/event=evt-con/);
  await expect(table).not.toContainText('Retro Weekly');
  await expect(table).toContainText('Pia Talks');
  // Form options narrow to the chosen event.
  await expect(page.getByLabel('Form').locator('option')).toHaveCount(2);

  await page.getByLabel('Event').selectOption('');
  await page.getByLabel('Search').fill('xelpins1');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=xelpins1/);
  await expect(table).toContainText('Pixel Pins');
  await expect(table).not.toContainText('Retro Weekly');

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('row actions: Waitlist through the decision dialog updates the row and the summary chips', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants');
  await expect(page.getByTestId('applications-summary')).toContainText('Submitted 2');
  const listCalls = () => calls.filter((c) => c.path === '/admin/applications' && c.method === 'GET').length;
  const loadsBefore = listCalls();

  await page.getByTestId('application-actions-app-retroweekly').click();
  const menu = page.getByRole('menu', { name: 'Actions for Retro Weekly' });
  await expect(menu.getByRole('menuitem')).toHaveText(['View', 'Approve', 'Waitlist', 'Reject', 'Withdraw', 'Edit tags', 'Copy status link']);
  await menu.getByRole('menuitem', { name: 'Waitlist' }).click();

  const dialog = page.getByRole('dialog', { name: 'Move to waitlist' });
  await expect(dialog.getByLabel('Subject')).toHaveValue('You are on the waitlist for Gaming Geek Expo 2027');
  await dialog.getByRole('button', { name: 'Waitlist' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('application-row-app-retroweekly')).toContainText('Waitlisted');
  await expect(page.getByTestId('applications-summary')).toContainText('Submitted 1');
  await expect(page.getByTestId('applications-summary')).toContainText('Waitlisted 1');
  expect(calls.some((c) => c.path === `/admin/events/${EXPO.id}/applications/app-retroweekly/decision` && (c.body as { decision: string }).decision === 'WAITLIST')).toBe(true);
  // One summary refresh, not a full reload.
  expect(calls.filter((c) => c.path === '/admin/applications/summary')).toHaveLength(1);
  expect(listCalls()).toBe(loadsBefore);

  // An approved row only offers Withdraw.
  await page.getByTestId('application-actions-app-piatalks01').click();
  await expect(page.getByRole('menu', { name: 'Actions for Pia Talks' }).getByRole('menuitem')).toHaveText(['View', 'Withdraw', 'Edit tags', 'Copy status link']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('bulk across events posts to the org route; saved views round-trip under their own key', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants');
  await page.getByRole('checkbox', { name: 'Select Retro Weekly' }).check();
  await page.getByRole('checkbox', { name: 'Select Pia Talks' }).check();
  const bar = page.getByTestId('applications-bulk-bar');
  await expect(bar).toContainText('2 selected');
  page.once('dialog', (d) => d.accept());
  await bar.getByRole('button', { name: 'Reject' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/admin/applications/bulk')?.body).toEqual({ ids: ['app-retroweekly', 'app-piatalks01'], decision: 'REJECT' });
  await expect(page.getByRole('status')).toContainText('2 rejected');
  await expect(page.getByTestId('applications-summary')).toContainText('Rejected 2');

  await page.getByRole('button', { name: /^Submitted/ }).click();
  await expect(page).toHaveURL(/status=SUBMITTED/);
  page.once('dialog', (d) => d.accept('Needs review'));
  await page.getByTestId('applications-save-view').click();
  await expect(page.getByTestId('applications-saved-views')).toHaveValue('Needs review');
  expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem('jump.participants.views.org') || '[]'))).toEqual([{ name: 'Needs review', query: { status: 'SUBMITTED' } }]);
});

test('per-event tab renders the same table without the Event filter or event line', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${EXPO.id}/applications`);
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(page.getByTestId('applications-summary')).toContainText('All 2');
  await expect(page.getByTestId('applications-table')).toContainText('Retro Weekly');
  await expect(page.getByTestId('applications-table')).not.toContainText('Pia Talks');
  await expect(page.getByLabel('Event')).toHaveCount(0);
  await expect(page.getByTestId('application-event-app-retroweekly')).toHaveCount(0);
  await expect(page.getByTestId('applications-add-on-filter')).toBeVisible();
  await expect(page.getByTestId('application-actions-app-retroweekly')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('Applications tab lists forms across events with links to the editor and filtered submissions', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!, 'ADMIN');
  await page.goto('/admin/participants/applications');
  await expect(page.getByRole('link', { name: 'Applications' }).first()).toHaveAttribute('aria-current', 'page');
  const table = page.getByTestId('participants-forms-table');
  await expect(table).toContainText('Vendor Space');
  await expect(table).toContainText('Winter Con');
  await expect(page.getByTestId('participants-form-form-panels').getByRole('link', { name: 'Edit' })).toHaveAttribute('href', `/admin/events/${CON.id}/applications/forms/form-panels`);
  await expect(page.getByTestId('participants-form-form-press').getByRole('link', { name: '2 submissions' })).toHaveAttribute('href', `/admin/participants?event=${EXPO.id}&form=form-press`);
});

// ─── Phase 3 ─────────────────────────────────────────────────────────────────

test('tags: edit with suggestions from the ⋯ menu, filter by tag, search a tag; check-in ticks only on approved rows and persist on reload', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants');
  const table = page.getByTestId('applications-table');
  await expect(page.getByTestId('applications-tag-filter').locator('option')).toHaveText(['Any tag', 'Tagged Returning', 'Tagged Sponsor']);

  // Edit tags on Pia (no tags yet): suggestion chips add, Enter adds a typed one.
  await page.getByTestId('application-actions-app-piatalks01').click();
  await page.getByRole('menuitem', { name: 'Edit tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tags' });
  await expect(dialog.getByTestId('tag-suggestions')).toContainText('+ Sponsor');
  await dialog.getByRole('button', { name: '+ Returning' }).click();
  await dialog.getByLabel('Tags').fill('  Panelist  ');
  await dialog.getByLabel('Tags').press('Enter');
  await dialog.getByLabel('Tags').fill('returning');
  await dialog.getByLabel('Tags').press('Enter');
  await expect(dialog.getByTestId('tag-chips')).toContainText('Returning');
  await expect(dialog.getByTestId('tag-chips')).toContainText('Panelist');
  await expect(dialog.getByTestId('tag-chips').locator('span')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save tags' }).click();
  await expect(dialog).toHaveCount(0);
  const patch = calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/applications/app-piatalks01'));
  expect(patch?.body).toEqual({ tags: ['Returning', 'Panelist'] });
  await expect(page.getByTestId('application-tags-app-piatalks01')).toContainText('Panelist');
  await expect(page.getByTestId('applications-tag-filter').locator('option')).toHaveText(['Any tag', 'Tagged Panelist', 'Tagged Returning', 'Tagged Sponsor']);

  // Filter by tag narrows the list and lands in the URL.
  await page.getByTestId('applications-tag-filter').selectOption('Sponsor');
  await expect(page).toHaveURL(/tag=Sponsor/);
  await expect(table).toContainText('Retro Weekly');
  await expect(table).not.toContainText('Pia Talks');
  await page.getByTestId('applications-tag-filter').selectOption('');
  await expect(page).not.toHaveURL(/tag=/);
  await page.getByLabel('Search').fill('panelist');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(table).toContainText('Pia Talks');
  await expect(table).not.toContainText('Retro Weekly');
  await page.getByLabel('Search').fill('');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).not.toHaveURL(/q=/);

  // Check-in: only the approved row shows ticks; optimistic tick persists on reload.
  await expect(page.getByTestId('application-checkin-app-retroweekly')).toHaveCount(0);
  const checks = page.getByTestId('application-checkin-app-piatalks01');
  await expect(checks).toBeVisible();
  await page.getByRole('checkbox', { name: 'Checked in Pia Talks' }).check();
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/app-piatalks01')).map((c) => c.body)).toContainEqual({ checkedIn: true });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Checked in Pia Talks' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Checked out Pia Talks' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Checked in Pia Talks' }).uncheck();
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/app-piatalks01')).map((c) => c.body)).toContainEqual({ checkedIn: false });
  await expect(page.getByRole('checkbox', { name: 'Checked in Pia Talks' })).not.toBeChecked();

  const a11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(a11y.violations).toEqual([]);
});

test('detail page: tags block with Edit tags, check-in on an approved application', async ({ page, baseURL }) => {
  const { calls } = await mockAdmin(page, baseURL!);
  await page.goto(`/admin/events/${CON.id}/applications/app-piatalks01`);
  await expect(page.getByTestId('application-tags')).toContainText('No tags.');
  await page.getByRole('button', { name: 'Edit tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit tags' });
  await dialog.getByLabel('Tags').fill('Panelist');
  await dialog.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByTestId('application-tags')).toContainText('Panelist');
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ tags: ['Panelist'] });

  const checkin = page.getByTestId('application-checkin');
  await checkin.getByRole('checkbox', { name: /Checked in/ }).check();
  await expect(checkin).toContainText('Checked in · Sep 18, 2026');
  await expect(checkin.getByRole('checkbox', { name: /Checked in/ })).toBeChecked();
});

// ─── Pinned answer columns ───────────────────────────────────────────────────

test('pinned answers: an Answers column without a form filter, one column per pinned question with it — on both mounts', async ({ page, baseURL }) => {
  await mockAdmin(page, baseURL!);
  await page.goto('/admin/participants');
  const table = page.getByTestId('applications-table');
  await expect(table.getByRole('columnheader', { name: 'Answers' })).toBeVisible();
  await expect(page.getByTestId('application-answers-app-retroweekly')).toContainText('Outlet: Retro Weekly Magazine');
  await expect(page.getByTestId('application-answers-app-retroweekly')).toContainText('Proof of insurance: true');
  await expect(page.getByTestId('application-answers-app-piatalks01')).toContainText('—');

  await page.getByLabel('Form').selectOption('form-press');
  await expect(page).toHaveURL(/form=form-press/);
  await expect(table.getByRole('columnheader', { name: 'Answers' })).toHaveCount(0);
  await expect(page.getByTestId('pinned-column-q-outlet')).toHaveText('Outlet');
  await expect(page.getByTestId('pinned-column-q-insurance')).toHaveText('Proof of insurance');
  await expect(page.getByTestId('pinned-answer-app-retroweekly-q-outlet')).toHaveText('Retro Weekly Magazine');
  await expect(page.getByTestId('pinned-answer-app-retroweekly-q-insurance')).toHaveText('true');

  // Per-event mount reads pinned questions from the event's forms.
  await page.goto(`/admin/events/${EXPO.id}/applications?form=form-press`);
  await expect(page.getByTestId('pinned-column-q-outlet')).toHaveText('Outlet');
  await expect(page.getByTestId('pinned-answer-app-retroweekly-q-outlet')).toHaveText('Retro Weekly Magazine');
  // A form with nothing pinned and no pinned answers shows neither.
  await page.goto(`/admin/events/${EXPO.id}/applications?form=form-vendor`);
  await expect(page.getByTestId('applications-table')).toContainText('Pixel Pins');
  await expect(page.getByTestId('applications-table').getByRole('columnheader', { name: 'Answers' })).toHaveCount(0);
  await expect(page.getByTestId('pinned-column-q-outlet')).toHaveCount(0);
});
