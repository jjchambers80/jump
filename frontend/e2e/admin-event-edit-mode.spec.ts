// Edit mode (spec 050 §8.4, card 050-O): every Event
// Details section's Edit opens its wizard step, the flyouts are gone, the old
// editors and forms configuration pages redirect, and a set-up event opens
// the wizard non-linearly (Back / Next, Save & exit back to Details with a
// "Saved" notice; a PUBLISHED event saves only when asked). Every API call is mocked by
// a small stateful fake. Wizard assertions are scoped to the form pane
// (<main>): the preview frame repeats names.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-edit';
const EVENT_ID = 'evt-edit';
const expect = baseExpect.configure({ timeout: 15000 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const VENUE = { id: 'v-hall', name: 'Union Hall', address: '1 Main St, Raleigh, NC', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' };

const tier = (patch: Record<string, unknown>) => ({
  description: null, quantityReserved: 0, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, isRefundable: false,
  saleStartDate: null, saleEndDate: null, visibility: 'PUBLIC', saleStatus: 'ON_SALE', ...patch,
});

function baseEvent(patch: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: '<p>Makers and music.</p>', logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 300, category: 'Market', status: 'PUBLISHED',
    admissionMode: 'TICKETED', setupStep: 'review', setupCompletedAt: '2031-01-01T00:00:00.000Z', rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, salesClosed: false, taxRate: 0, tax: { rate: 0, source: null, region: null }, taxInclusivePricing: false,
    organizationId: ORG_ID, organizationName: 'Edit Org',
    venue: { id: VENUE.id, name: VENUE.name, address: VENUE.address, timezone: VENUE.timezone },
    priceTiers: [tier({ id: 't-ga', name: 'General Admission', price: 25, quantityTotal: 200, quantitySold: 10, quantityAvailable: 190 })],
    ...patch,
  };
}

const counts = { SUBMITTED: 0, WAITLISTED: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0 };
const overviewForm = (id: string, name: string, spaceSelection: string | null = null) => ({
  id, name, slug: id, kind: 'FREE', status: 'OPEN', spaceSelection, opensAt: null, closesAt: null, paid: false,
  counts, total: 0, approvedSettled: 0, approvedAwaitingPayment: 0, tiers: [],
});
/** The admin form shape the wizard's application steps list. */
const adminForm = (f: ReturnType<typeof overviewForm>) => ({
  ...f, eventId: EVENT_ID, intro: null, chargeTiming: 'APPROVAL', feeMode: 'PASS', taxable: false, paymentDueDays: 7,
  overduePolicy: 'WITHDRAW', reserveOnApproval: true, displayOrder: 0, createdFromTemplateId: null,
  acceptance: { accepting: true, reason: null }, paymentsEnabled: true, applicationCount: 0, collectBusiness: f.id !== 'f-volunteers',
  addOns: [], questions: [], timezone: VENUE.timezone,
  ...(f.id === 'f-volunteers' && { applicationCount: 2, opensAt: '2031-05-01T14:00:00.000Z' }),
});

const OTHER_ORG = { id: 'org-other', name: 'Other Org', slug: 'other-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' };

// Forms from before spec 057: a live event keeps them, but they are edited only on a registration event.
const FORMS = [overviewForm('f-vendors', 'Vendor booths', 'MAP'), overviewForm('f-volunteers', 'Volunteer crew')];

type Calls = { patch: Request[] };
type Options = { failPatch?: boolean; otherOrgFirst?: boolean };

/** A stateful fake API: PATCH changes the event that later loads return. */
async function mockApi(page: Page, initial = baseEvent(), options: Options = {}) {
  const event: Record<string, any> = structuredClone(initial);
  const calls: Calls = { patch: [] };
  const org = { id: ORG_ID, name: 'Edit Org', slug: 'edit-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' };
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) => route.fulfill(json(options.otherOrgFirst ? [OTHER_ORG, org] : [org])));
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json([VENUE])));
  await page.route(`${API}/organizations/${ORG_ID}/tier-presets`, (route) => route.fulfill(json({ tierPresets: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}`, (route) => {
    calls.patch.push(route.request());
    if (options.failPatch) return route.fulfill(json({ message: 'Server unavailable' }, 500));
    Object.assign(event, route.request().postDataJSON());
    route.fulfill(json(event));
  });
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/overview`, (route) =>
    route.fulfill(
      json({
        event,
        money: { gross: 250, orgReceives: 240, refunded: 0, net: 250, tickets: { orders: 5, gross: 250 }, applications: { orders: 0, gross: 0 } },
        tickets: { issued: 10, checkedIn: 0, voided: 0 },
        rsvp: null,
        addOns: { addOns: [], totals: { sold: 0, reserved: 0, revenue: 0 } },
        applications: { forms: FORMS },
        map: null,
        admissionLock: { locked: true, reason: 'Tickets have been sold.' },
      })
    )
  );
  await page.route(`${API}/organizations/${ORG_ID}/events/${EVENT_ID}/preview-payload`, (route) =>
    route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Edit Org' }, forms: [] }))
  );
  await page.route(`${API}/admin/events/${EVENT_ID}/application-forms`, (route) => route.fulfill(json({ data: FORMS.map(adminForm) })));
  await page.route(new RegExp(`${API}/admin/events/${EVENT_ID}/application-forms/[^/]+$`), (route) => {
    const id = route.request().url().split('/').pop();
    const found = FORMS.find((f) => f.id === id);
    route.fulfill(found ? json(adminForm(found)) : json({ message: 'Not found' }, 404));
  });
  return calls;
}

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const COLD = { timeout: 30000 };
test.describe.configure({ timeout: 120000 });
const STAFF = { id: 'edit-admin', email: 'edit-admin@test.com', role: 'ADMIN' as const };
const DETAILS = `/admin/events/${EVENT_ID}`;
const setupUrl = (query: string) => `/admin/events/${EVENT_ID}/setup?${query}`;

const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
/** Serious / critical axe findings as "rule: targets" lines, so a failure names what failed. */
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => ['serious', 'critical'].includes(v.impact || ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
const ORG_Q = `&org=${ORG_ID}`;
/** Arms once a live edit is pending: the history guard's entry is on top. */
const guardArmed = (page: Page) => page.waitForFunction(() => !!(window.history.state as Record<string, unknown> | null)?.__jumpSetupGuard);

test.beforeEach(async ({ page }) => {
  await signInAsStaff(page, STAFF, BASE_URL);
  await page.setViewportSize({ width: 1440, height: 900 });
});

// Compile the routes once, so the first test does not spend its budget on cold builds.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300000);
  const page = await browser.newPage({ baseURL: BASE_URL });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page);
  await page.goto(DETAILS, { timeout: 120000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible({ timeout: 120000 });
  for (const url of [setupUrl('step=name')]) {
    await page.goto(url, { timeout: 120000 });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 120000 });
  }
  // The redirect pages compile on first visit; each lands on the (warm) wizard.
  for (const path of [`${DETAILS}/edit`, `${DETAILS}/edit/details`, `${DETAILS}/edit/sales`, `${DETAILS}/applications/forms`, `${DETAILS}/applications/forms/f-vendors`, `${DETAILS}/applications`]) {
    await page.goto(path, { timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
  }
  await page.close();
});

/** Details section control → [path after /setup, step h1]. Forms and the floor map open their flows (spec 051). */
const LINKS: [string, string, string][] = [
  ['Edit event', '?step=name', 'Name your event'],
  ['Edit image', '?step=image', 'Add an image'],
  ['Edit date and venue', '?step=date', 'When is it?'],
  ['Change venue', '?step=venue', 'Where is it?'],
  ['Edit description', '?step=description', 'Describe it'],
  ['Edit tickets', '?step=tickets', 'Tickets or RSVP'],
  ['Edit tier General Admission', '?step=tickets&tier=t-ga', 'Tickets or RSVP'],
  ['Edit add-ons', '?step=collect-more', 'Collect more'],
  ['Edit admission', '?step=tickets', 'Tickets or RSVP'],
  ['Edit listing', '?step=name', 'Name your event'],
];
// A form opens the registration flow (spec 057); a live event's old form goes back to the event.
const FORM_LINKS: [string, string][] = [
  ['Edit form Vendor booths', '/registration?step=start&form=f-vendors'],
  ['Edit form Volunteer crew', '/registration?step=start&form=f-volunteers'],
  ['Edit floor map', '/registration?step=floor-map&form=f-vendors'],
];
const linkHref = (path: string) => `/admin/events/${EVENT_ID}/setup${path}${ORG_Q}`;
const flowUrl = (path: string) => `/admin/events/${EVENT_ID}/setup/${path}`;

test.describe('Details links into the wizard', () => {
  test('every section links to its step and no flyout is offered', async ({ page }) => {
    await mockApi(page);
    await page.goto(DETAILS);
    await expect(page.getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
    for (const [name, path] of [...LINKS, ...FORM_LINKS]) {
      await expect(page.getByRole('link', { name, exact: true }).first(), name).toHaveAttribute('href', linkHref(path));
    }
    // One form per field: no Edit control opens a dialog here any more.
    await expect(page.locator('button[aria-haspopup="dialog"]').filter({ hasText: /Edit|Settings|Add tier/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Settings for / })).toHaveCount(0);
    await expect(page.locator('a[href*="/edit/"], a[href*="/applications/forms"]')).toHaveCount(0);
  });

  for (const [name, path, title] of LINKS) {
    test(`${name} opens "${title}" with focus on its heading`, async ({ page }) => {
      await mockApi(page);
      await page.goto(DETAILS);
      await page.getByRole('link', { name, exact: true }).first().click();
      await expect(page).toHaveURL((url) => url.pathname + url.search === linkHref(path));
      if (path.includes('tier=')) {
        // The tier's own dialog opens over the step.
        await expect(page.getByRole('dialog')).toBeVisible(COLD);
        await expect(page.getByRole('dialog').getByLabel('Tier Name *')).toHaveValue('General Admission');
        await expect(page.getByRole('dialog').getByLabel('Tier Name *')).toBeFocused();
        return;
      }
      await expect(heading(page, title)).toBeFocused(COLD);
    });
  }

  test('a live event\'s old form link goes back to the event', async ({ page }) => {
    await mockApi(page);
    await page.goto(flowUrl('registration?step=details&form=f-volunteers'));
    await expect(page).toHaveURL((url) => url.pathname === DETAILS, COLD);
  });
});

test.describe('edit mode', () => {
  test('a failed save then "Leave anyway" never says "Saved."; focus returns to the exact control', async ({ page }) => {
    await mockApi(page, baseEvent(), { failPatch: true });
    await page.goto(DETAILS);
    // Edit admission and Edit tickets both open the Tickets step: focus must come back to the one used.
    await page.getByRole('link', { name: 'Edit admission', exact: true }).click();
    await expect(heading(page, 'Tickets or RSVP')).toBeFocused(COLD);
    await main(page).getByLabel(/Capacity/).first().fill('250');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Save & exit' }).click();
    await expect(page).toHaveURL(new RegExp(`${DETAILS}$`), COLD);
    await expect(page.getByRole('status').filter({ hasText: 'Your latest changes were not saved.' })).toBeVisible();
    await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit admission', exact: true })).toBeFocused();
  });

  test('links that leave the wizard ask first while a live edit is unsaved', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeFocused(COLD);
    await main(page).getByLabel(/Capacity/).first().fill('250');
    await guardArmed(page);
    const asked: string[] = [];
    page.once('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await main(page).getByRole('link', { name: 'Settings › Tax' }).click();
    await expect.poll(() => asked).toEqual(['You have unsaved changes. Leave without saving?']);
    await expect(page).toHaveURL(/step=tickets/);
    expect(calls.patch).toHaveLength(0);
  });

  test('Tickets shows the tax summary read-only; the header links to the live page', async ({ page }) => {
    await mockApi(page);
    await page.goto(setupUrl('step=tickets'));
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
    await expect(main(page).getByTestId('event-tax-summary')).toContainText('Tax: 0%');
    await expect(page.getByRole('banner').getByRole('link', { name: /View event/ })).toHaveAttribute('href', '/events/spring-fair');
  });

  test('the progress is the bar alone: no step line, no saved line, no step menu', async ({ page }) => {
    await mockApi(page);
    await page.goto(setupUrl('step=description'));
    await expect(heading(page, 'Describe it')).toBeVisible(COLD);
    await expect(page.getByText(/Step \d+ of \d+ —/)).toHaveCount(0);
    await expect(page.getByText('Editing Describe it')).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Jump to edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Setup steps' })).toHaveCount(0);
  });

  test('a published event saves only through Save; navigating sends no PATCH; Save & exit returns with "Saved"', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(DETAILS);
    await page.getByRole('link', { name: 'Edit event', exact: true }).click();
    await expect(heading(page, 'Name your event')).toBeFocused(COLD);
    await main(page).getByLabel('Event name').fill('Spring Fair 2031');
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    // The edit stays pending; nothing is sent.
    await page.waitForTimeout(1200); // past the 800 ms autosave a DRAFT would use
    expect(calls.patch).toHaveLength(0);

    // Save & exit is the explicit save, then Details announces it.
    await page.getByRole('button', { name: 'Save & exit' }).click();
    await expect(page).toHaveURL(new RegExp(`${DETAILS}$`), COLD);
    expect(calls.patch.map((r) => r.postDataJSON())).toEqual([{ name: 'Spring Fair 2031' }]);
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Spring Fair 2031' })).toBeVisible();
    // Focus returns to the control the organizer left from.
    await expect(page.getByRole('link', { name: 'Edit event', exact: true })).toBeFocused();
  });

  test('Save on a published event sends the change once', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(setupUrl('step=name'));
    await expect(heading(page, 'Name your event')).toBeFocused(COLD);
    await main(page).getByLabel('Event name').fill('Live Rename');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => calls.patch.length).toBe(1);
    expect(calls.patch[0].postDataJSON()).toEqual({ name: 'Live Rename' });
    // "Unsaved changes" clears; there is no "Saved" line (spec 051).
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  });

  test('the unsaved-changes guard asks before browser Back leaves a published edit', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(DETAILS);
    await page.getByRole('link', { name: 'Edit listing', exact: true }).click();
    await expect(heading(page, 'Name your event')).toBeFocused(COLD);
    await main(page).getByLabel('Category (optional)').selectOption('Festivals & Fairs');
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await guardArmed(page);
    const asked: string[] = [];
    page.once('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goBack();
    await expect.poll(() => asked).toEqual(['You have unsaved changes. Leave without saving?']);
    await expect(heading(page, 'Name your event')).toBeVisible();
    await expect(main(page).getByLabel('Category (optional)')).toHaveValue('Festivals & Fairs');
    expect(calls.patch).toHaveLength(0);
  });
});

test.describe('redirects to the wizard', () => {
  const cases: [string, string][] = [
    [`${DETAILS}/edit#event-add-ons`, '?step=collect-more'],
    [`${DETAILS}/edit/details#event-media`, '?step=image'],
    [`${DETAILS}/edit/details`, '?step=name'],
    [`${DETAILS}/edit/sales#event-admission`, '?step=tickets'],
    [`${DETAILS}/edit/sales`, '?step=tickets'],
  ];
  for (const [from, path] of cases) {
    test(`${from.replace(DETAILS, '…')} → ${path}`, async ({ page }) => {
      await mockApi(page);
      await page.goto(from);
      await expect(page).toHaveURL((url) => url.pathname + url.search === `${DETAILS}/setup${path}`, COLD);
    });
  }

  // Old form links open the registration flow, which sends a live event back to the event (spec 057).
  for (const from of [`${DETAILS}/applications/forms`, `${DETAILS}/applications/forms/f-volunteers`]) {
    test(`${from.replace(DETAILS, '…')} → the event`, async ({ page }) => {
      await mockApi(page);
      await page.goto(from);
      await expect(page).toHaveURL((url) => url.pathname === DETAILS, COLD);
    });
  }

  test('an old link keeps its organization: a member of two orgs lands on the right event', async ({ page }) => {
    await mockApi(page, baseEvent(), { otherOrgFirst: true });
    await page.goto(`${DETAILS}/edit/sales?orgId=${ORG_ID}#event-capacity`);
    await expect(page).toHaveURL(new RegExp(`/setup\\?step=tickets&org=${ORG_ID}$`), COLD);
    await expect(heading(page, 'Tickets or RSVP')).toBeVisible(COLD);
  });

  test('submission review stays on the Applications tab', async ({ page }) => {
    await mockApi(page);
    await page.goto(`${DETAILS}/applications`);
    await expect(page).toHaveURL(new RegExp(`${DETAILS}/applications$`));
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`${DETAILS}/applications$`));
  });
});

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`Details and a wizard step: 44 px targets, no serious axe findings (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await mockApi(page);
      await page.goto(DETAILS);
      await expect(page.getByRole('heading', { level: 1, name: 'Spring Fair' })).toBeVisible(COLD);
      for (const name of ['Edit event', 'Edit tickets', 'Edit date and venue', 'Edit description', 'Edit form Vendor booths']) {
        const box = await page.getByRole('link', { name, exact: true }).first().boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
      }
      expect(await serious(page)).toEqual([]);

      await page.getByRole('link', { name: 'Edit description', exact: true }).click();
      await expect(heading(page, 'Describe it')).toBeFocused(COLD);
      // Tiptap mounts client-side after the step; scan the finished editor, not its placeholder.
      await expect(main(page).locator('.ProseMirror')).toBeVisible(COLD);
      // No step menu on phones either: Back and Next sit in the footer.
      await expect(page.getByRole('button', { name: 'Setup steps' })).toHaveCount(0);
      expect((await page.getByRole('button', { name: 'Back' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await serious(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }
});
