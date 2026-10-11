// Wizard step 13, Review and publish (spec 050-N). Every API call is
// mocked, anything else answers 404. Assertions are scoped to <main>: the
// preview frame repeats the event's name.

import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page, type Request } from '@playwright/test';
import { BASE_URL, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-review';
const EVENT_ID = 'evt-review';
const expect = baseExpect.configure({ timeout: 15000 });
const COLD = { timeout: 30000 };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const VENUES = [{ id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York', city: 'Raleigh', state: 'NC' }];
const PREVIEW_URL = 'http://localhost:3001/events/spring-fair?preview=signed-token';

function adminEvent(patch: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, slug: 'spring-fair', name: 'Spring Fair', description: '<p>Hi</p>', logoUrl: null,
    date: '2031-06-01T20:00:00.000Z', endDate: null, capacity: 200, category: null, status: 'DRAFT',
    admissionMode: 'TICKETED', setupStep: 'review', setupCompletedAt: null, rsvpLimit: null, rsvpMaxPartySize: 1,
    rsvpRemaining: null, taxRate: 0.0725, tax: { rate: 0.0725, source: 'MANUAL', region: 'NC' }, taxInclusivePricing: false,
    organizationId: ORG_ID, venue: { id: 'v-hall', name: 'Union Hall', address: '1 Main St', timezone: 'America/New_York' },
    priceTiers: [{ id: 't1', name: 'General', price: 10, quantityTotal: 200, isActive: true }],
    ...patch,
  };
}

const form = (id: string, name: string, kind: 'PAID' | 'FREE', status = 'DRAFT') => ({
  id, name, slug: id, kind, status, opensAt: null, closesAt: null, paid: kind === 'PAID', total: 0, tiers: [],
});

const READY = { ready: true, blockers: [], warnings: [] };

interface Setup {
  event?: Record<string, unknown>;
  readiness?: unknown;
  forms?: unknown[];
  publish?: (body: { openFormIds?: string[] }) => { status: number; body: unknown };
  /** Publish answers only once this settles (a publish in flight). */
  hold?: Promise<void>;
}

async function mockApi(page: Page, setup: Setup = {}) {
  const event = setup.event ?? adminEvent();
  const calls: { publish: Request[]; patch: Request[] } = { publish: [], patch: [] };
  const base = `${API}/organizations/${ORG_ID}/events/${EVENT_ID}`;
  await page.route(`${API}/**`, (route) => route.fulfill(json({ message: 'Not found' }, 404)));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: ORG_ID, name: 'Review Org', slug: 'review-org', status: 'ACTIVE', brandColor: '#0f766e', themeMode: 'LIGHT' }]))
  );
  await page.route(`${API}/admin/permissions`, (route) => route.fulfill(json({ granted: ['*'], hiddenPaths: [] })));
  await page.route(`${API}/organizations/${ORG_ID}/venues`, (route) => route.fulfill(json(VENUES)));
  await page.route(base, (route) => {
    calls.patch.push(route.request());
    const body = route.request().postDataJSON();
    route.fulfill(json({ ...event, ...(body.setupCompleted ? { setupCompletedAt: '2031-01-01T00:00:00.000Z' } : {}) }));
  });
  await page.route(`${base}/overview`, (route) => route.fulfill(json({ event, applications: { forms: setup.forms ?? [] } })));
  await page.route(`${base}/readiness`, (route) => route.fulfill(json(setup.readiness ?? READY)));
  // Each mint is a fresh 1 h link with its own URL.
  let mints = 0;
  await page.route(`${base}/preview-link`, (route) => {
    mints += 1;
    route.fulfill(json({ url: `${PREVIEW_URL}&n=${mints}`, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
  });
  await page.route(`${base}/preview-payload`, (route) =>
    route.fulfill(json({ event, organization: { id: ORG_ID, name: 'Review Org' }, forms: [] }))
  );
  await page.route(`${base}/publish`, async (route) => {
    calls.publish.push(route.request());
    if (setup.hold) await setup.hold;
    const reply = setup.publish?.(route.request().postDataJSON()) ?? {
      status: 200,
      body: { ...event, status: 'PUBLISHED', setupCompletedAt: '2031-01-01T00:00:00.000Z', formResults: [] },
    };
    route.fulfill(json(reply.body, reply.status));
  });
  return calls;
}


const main = (page: Page) => page.locator('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 1, name });
const REVIEW = `/admin/events/${EVENT_ID}/setup?step=review`;
const STAFF = { id: 'review-admin', email: 'review-admin@test.com', role: 'ADMIN' as const };

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

// Compile the routes these tests visit once, before anything is timed.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await signInAsStaff(page, STAFF, BASE_URL);
  await mockApi(page);
  for (const step of ['review', 'tickets', 'done']) {
    await page.goto(`/admin/events/${EVENT_ID}/setup?step=${step}`, { timeout: 120000 });
    await expect(page.locator('main h1')).toBeVisible({ timeout: 120000 });
  }
  await expect(page.frameLocator('iframe[title="Event page preview"]').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 120000 });
  await page.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(page, STAFF, baseURL!);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('blocked: blockers from /readiness link to their wizard step', async ({ page }) => {
    await mockApi(page, {
      readiness: {
        ready: false,
        blockers: [{ code: 'CAPACITY_MISSING', step: 'tickets', message: 'Set how many people can attend.' }],
        warnings: [{ code: 'NO_IMAGE', step: 'image', message: 'Add an image so the event stands out.' }],
      },
    });
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    const checklist = main(page).getByRole('region', { name: 'Checklist' });
    await expect(checklist.getByTestId('readiness-summary')).toHaveText('1 thing to fix before publishing');
    const fix = checklist.getByRole('link', { name: /Must fix: Set how many people can attend\..*Fix/ });
    await expect(fix).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=tickets`);
    await expect(checklist.getByRole('link', { name: /Check: Add an image/ })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=image`);
    // The footer has no Next on Review: Publish is the one primary action.
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await fix.click();
    await expect(heading(page, 'Tickets or RSVP')).toBeFocused();
  });

  test('warning only: a PAID form is disabled with the reason, a FREE one is ticked', async ({ page }) => {
    await mockApi(page, {
      readiness: {
        ready: true,
        blockers: [],
        warnings: [{ code: 'PAID_FORMS_DISABLED', step: 'vendors', formId: 'f-paid', message: 'Vendor booths charges applicants, and paid applications are not available yet. It stays closed.' }],
      },
      forms: [form('f-paid', 'Vendor booths', 'PAID'), form('f-free', 'Press passes', 'FREE')],
    });
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    await expect(main(page).getByTestId('readiness-summary')).toHaveText('Ready to publish, with 1 thing to check');
    const forms = main(page).getByRole('region', { name: 'Applications' });
    // Each box names its form, so a screen reader can tell them apart.
    const paid = forms.getByRole('checkbox', { name: 'Open applications when I publish: Vendor booths' });
    await expect(paid).toBeDisabled();
    await expect(paid).not.toBeChecked();
    await expect(paid).toHaveAccessibleDescription(/paid applications are not available yet/);
    await expect(forms.getByRole('checkbox', { name: 'Open applications when I publish: Press passes' })).toBeChecked();
  });

  test('ready: tax, brand and preview link; Save as draft marks setup complete', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    await expect(main(page).getByTestId('readiness-summary')).toHaveText('Ready to publish');
    await expect(main(page).getByTestId('event-tax-summary')).toContainText('7.25% · Manual rate · NC');
    await expect(main(page).getByRole('link', { name: 'Edit in Settings › Brand' })).toHaveAttribute('href', '/admin/settings/brand');
    await expect(main(page).getByText('#0F766E')).toBeVisible();
    const previewLink = main(page).getByRole('link', { name: /Open full preview/ });
    await expect(previewLink).toHaveAttribute('href', /^http:\/\/localhost:3001\/events\/spring-fair\?preview=signed-token&n=\d+$/);
    await expect(previewLink).toHaveAttribute('target', '_blank');
    await expect(previewLink).toHaveAttribute('rel', 'noopener noreferrer');

    await main(page).getByRole('button', { name: 'Save as draft' }).click();
    await expect(heading(page, 'Saved as draft')).toBeFocused();
    expect(calls.publish).toHaveLength(0);
    expect(calls.patch.map((r) => r.postDataJSON())).toContainEqual({ setupCompleted: true });
  });

  test('publish sends the ticked openFormIds and Done lists each form result', async ({ page }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const calls = await mockApi(page, {
      hold,
      forms: [form('f-a', 'Vendor booths', 'FREE'), form('f-b', 'Volunteers', 'FREE'), form('f-c', 'Panels', 'FREE'), form('f-d', 'Sponsors', 'FREE')],
      publish: ({ openFormIds = [] }) => ({
        status: 200,
        body: {
          ...adminEvent({ status: 'PUBLISHED', setupCompletedAt: '2031-01-01T00:00:00.000Z' }),
          formResults: openFormIds.map((formId) =>
            formId === 'f-c'
              ? { formId, status: 'REFUSED', code: 'FORM_NOT_READY', message: 'Add an active tier first.' }
              : formId === 'f-d'
                ? { formId, status: 'REFUSED', code: 'FORM_NOT_READY', message: 'Sponsors has no questions yet.' }
                : { formId, status: 'OPEN' }
          ),
        },
      }),
    });
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    await expect(main(page).getByRole('checkbox', { name: /^Open applications when I publish: / })).toHaveCount(4);
    await main(page).getByRole('checkbox', { name: 'Open applications when I publish: Volunteers' }).uncheck();
    await main(page).getByRole('button', { name: 'Publish' }).click();

    // While the publish is out, Back and the step menu wait, and say why.
    const back = page.getByRole('button', { name: 'Back' });
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    await expect(back).toHaveAccessibleDescription('Publishing… Back and the step menu return when it finishes.');
    await expect(page.getByRole('button', { name: 'Setup steps' })).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled keeps it focusable; pressing it does nothing.
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(heading(page, 'Review and publish')).toBeVisible();
    release();

    await expect(heading(page, 'Your event is live')).toBeFocused();
    expect(calls.publish).toHaveLength(1);
    expect(calls.publish[0].postDataJSON()).toEqual({ openFormIds: ['f-a', 'f-c', 'f-d'] });
    const results = main(page).getByTestId('form-results');
    await expect(results).toContainText('Vendor booths: open for applications.');
    await expect(results).toContainText('Panels: still closed. Add an active tier first.');
    // A message that already names its form is not prefixed with the name again.
    await expect(results).toContainText('Still closed. Sponsors has no questions yet.');
    await expect(results).not.toContainText('Sponsors: still closed');
  });

  test('the preview link is re-minted before it expires', async ({ page }) => {
    await page.clock.install();
    await mockApi(page);
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    const previewLink = main(page).getByRole('link', { name: /Open full preview/ });
    await expect(previewLink).toHaveAttribute('href', /&n=\d+$/);
    const first = await previewLink.getAttribute('href');
    // The 1 h link is replaced 5 minutes before it expires, without a click.
    await page.clock.runFor('56:00');
    await expect(previewLink).not.toHaveAttribute('href', first!);
    await expect(previewLink).toHaveAttribute('href', /&n=\d+$/);
  });

  test('a 422 shows the focused error summary with step links', async ({ page }) => {
    await mockApi(page, {
      publish: () => ({
        status: 422,
        body: {
          error: 'UnprocessableEntityError', code: 'EVENT_NOT_READY', message: 'This event is not ready to publish',
          details: { blockers: [{ code: 'DATE_IN_PAST', step: 'date', message: 'The start time has passed.' }], warnings: [] },
        },
      }),
    });
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    await main(page).getByRole('button', { name: 'Publish' }).click();
    const summary = main(page).getByRole('alert').filter({ hasText: 'Fix 1 thing before publishing' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link', { name: /The start time has passed\./ })).toHaveAttribute('href', `/admin/events/${EVENT_ID}/setup?step=date`);
    await expect(heading(page, 'Review and publish')).toBeVisible();
  });

  test('edit mode on a published event shows its status instead of Publish', async ({ page }) => {
    await mockApi(page, { event: adminEvent({ status: 'PUBLISHED', setupCompletedAt: '2031-01-01T00:00:00.000Z' }) });
    await page.goto(REVIEW);
    await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
    await expect(main(page).getByTestId('review-status')).toContainText('This event is published.');
    await expect(main(page).getByRole('button', { name: 'Publish' })).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Save as draft' })).toHaveCount(0);
  });
});

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious axe findings and no horizontal scroll (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page, {
        readiness: {
          ready: false,
          blockers: [{ code: 'NO_ACTIVE_TIER', step: 'tickets', message: 'Add at least one active ticket type.' }],
          warnings: [{ code: 'PAID_FORMS_DISABLED', step: 'vendors', formId: 'f-paid', message: 'Vendor booths charges applicants. It stays closed.' }],
        },
        forms: [form('f-paid', 'Vendor booths', 'PAID'), form('f-free', 'Press passes', 'FREE')],
      });
      await page.goto(REVIEW);
      await expect(heading(page, 'Review and publish')).toBeVisible(COLD);
      await expect(main(page).getByRole('link', { name: /Open full preview/ })).toBeVisible();
      const publish = main(page).getByRole('button', { name: 'Publish' });
      const box = await publish.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await serious(page)).toEqual([]);
      const overflow = await page.evaluate(() =>
        [document.documentElement, document.querySelector('main')].filter((el) => el && el.scrollWidth > el.clientWidth).length
      );
      expect(overflow).toBe(0);
    });
  }
});
