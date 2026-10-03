import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';
import { API, editorOrg, mockThemeEditorApi } from './helpers/themeEditorMocks';

// Spec 038D: the theme editor against a mocked API (documents from the real
// preset). Covers §16 editor tests and acceptance tests 11 (axe) and 16 (restore).

const expect = baseExpect.configure({ timeout: 20_000 });
const canvas = (page: Page) => page.frameLocator('iframe').first();
const outline = (page: Page) => page.getByTestId('sections-outline');
const EDITOR = '/admin/online-store/themes/theme-main/editor';

/** Which slide the canvas carousel shows (0-based), from its track's scroll position. */
const shownSlide = (page: Page) =>
  page.frames()[1].evaluate(() => {
    const track = document.querySelector('.hero-carousel-track');
    return track ? Math.round(track.scrollLeft / track.clientWidth) : -1;
  });

async function openEditor(page: Page) {
  await page.goto(EDITOR);
  await expect(canvas(page).getByText('Welcome').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('theme editor (038D)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'editor-admin', email: 'editor-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('loads the live theme without the admin chrome', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockThemeEditorApi(page);
    await openEditor(page);
    await expect(page.getByText('Eventimus Default · Active')).toBeVisible();
    await expect(page.locator('aside nav a', { hasText: 'Online store' })).toHaveCount(0);
    for (const group of ['Header', 'Template', 'Footer']) await expect(outline(page).getByRole('heading', { name: group })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('select from the outline, edit a field, save only what changed, see the live-store note', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    const heading = page.getByRole('textbox', { name: 'Heading', exact: true });
    await heading.fill('Autumn Series');
    await expect(canvas(page).getByText('Autumn Series').first()).toBeVisible();
    await expect(page.getByLabel('Page being edited')).toContainText('Home page •');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /editing your live store/ })).toBeVisible();
    expect(api.saves).toHaveLength(1);
    expect(Object.keys(api.saves[0].documents)).toEqual(['home']);
    expect(api.saves[0]).toMatchObject({ themeVersion: 1, documents: { home: { version: 0 } } });
    expect(api.saves[0].documents.home.data.content[0]).toMatchObject({ type: 'Hero', props: { heading: 'Autumn Series' } });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('clicking the canvas selects a section', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    await canvas(page).getByText('Find your next night out.').click();
    await expect(outline(page).getByRole('button', { name: 'Hero', exact: true })).toHaveAttribute('aria-current', 'true');
  });

  test('switching pages keeps unsaved edits per document and saves them together', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Changed home');
    await page.getByLabel('Page being edited').selectOption('events');
    await expect(canvas(page).getByText('Upcoming events').first()).toBeVisible();
    await expect(outline(page).getByRole('button', { name: 'Event list', exact: true })).toBeVisible();
    await page.getByLabel('Page being edited').selectOption('home');
    await expect(canvas(page).getByText('Changed home').first()).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);
    expect(Object.keys(api.saves[0].documents)).toEqual(['home']);
  });

  test('hide from the outline dims the section and saves hidden: true', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hide Call to action' }).click();
    await expect(canvas(page).locator('[data-hidden-section]')).toHaveCount(2); // the preset announcement bar + this one
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);
    const cta = api.saves[0].documents.home.data.content.find((s: any) => s.type === 'CallToAction');
    expect(cta.props.hidden).toBe(true);
  });

  test('keyboard: add a section, move it, locked sections offer no actions', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    await expect(outline(page).getByRole('button', { name: 'More actions for Header' })).toHaveCount(0);
    await expect(outline(page).getByRole('button', { name: 'Hide Footer' })).toHaveCount(0);

    const template = outline(page).getByRole('region', { name: 'Template' });
    await template.getByRole('button', { name: 'Add section' }).focus();
    await page.keyboard.press('Enter');
    await template.getByRole('list', { name: /Sections you can add to the template/ }).getByRole('button', { name: 'Rich text' }).click();
    await expect(canvas(page).getByText('Talk about your events').first()).toBeVisible();

    const more = template.getByRole('button', { name: 'More actions for Rich text' });
    await more.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    const labels = await template.locator(':scope > ul > li > div > button:first-child').allTextContents();
    expect(labels.indexOf('Rich text')).toBe(labels.indexOf('Call to action') - 1);
    // Only one announcement bar is allowed, and the header already has one.
    await expect(outline(page).getByRole('region', { name: 'Header' }).getByRole('button', { name: 'Add section' })).toHaveCount(0);
  });

  test('hero carousel and FAQ are added with starter blocks and saved as sections with blocks (spec 041)', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    const template = outline(page).getByRole('region', { name: 'Template' });
    const addable = template.getByRole('list', { name: /Sections you can add to the template/ });
    await template.getByRole('button', { name: 'Add section' }).click();
    await addable.getByRole('button', { name: 'Hero carousel' }).click();
    await expect(canvas(page).getByText('Your next big show').first()).toBeVisible();
    await expect(canvas(page).getByRole('button', { name: 'Slide 2 of 2' })).toBeVisible();
    await template.getByRole('button', { name: 'Add section' }).click();
    await addable.getByRole('button', { name: 'FAQ' }).click();
    await expect(canvas(page).getByText('When do doors open?').first()).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);
    const content = api.saves[0].documents.home.data.content;
    const carousel = content.find((s: any) => s.type === 'HeroCarousel');
    const faq = content.find((s: any) => s.type === 'Faq');
    expect(carousel.props.blocks.map((b: any) => b.type)).toEqual(['Slide', 'Slide']);
    expect(faq.props.blocks.map((b: any) => b.props.question)).toEqual(['When do doors open?', 'Can I get a refund?']);
    for (const block of [...carousel.props.blocks, ...faq.props.blocks]) expect(block.props.id).toBeTruthy();
  });

  test('slides and questions are told apart, followed on the canvas and added from the Sections panel (spec 041)', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    const template = outline(page).getByRole('region', { name: 'Template' });
    const addable = template.getByRole('list', { name: /Sections you can add to the template/ });
    await template.getByRole('button', { name: 'Add section' }).click();
    await addable.getByRole('button', { name: 'Hero carousel' }).click();

    // Selecting slide 2 in the panel scrolls the carousel on the canvas to it.
    await outline(page).getByRole('button', { name: 'Slide 2 · Another highlight', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue('Another highlight');
    await expect.poll(() => shownSlide(page)).toBe(1);

    await outline(page).getByRole('button', { name: 'Add slide to Hero carousel' }).click();
    await expect(outline(page).getByRole('button', { name: 'Slide 3 · New slide', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => shownSlide(page)).toBe(2);

    // Selecting a question opens it on the canvas.
    await template.getByRole('button', { name: 'Add section' }).click();
    await addable.getByRole('button', { name: 'FAQ' }).click();
    await outline(page).getByRole('button', { name: 'Question 2 · Can I get a refund?', exact: true }).click();
    await expect(canvas(page).getByText('See the refund policy on your ticket.')).toBeVisible();
    await outline(page).getByRole('button', { name: 'Add question to FAQ' }).click();
    await expect(outline(page).getByRole('button', { name: 'Question 3 · New question', exact: true })).toBeVisible();
  });

  test('announcements are edited as a list and render on the canvas', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Show Announcement bar' }).click();
    await outline(page).getByRole('button', { name: 'Announcement bar', exact: true }).click();
    await page.getByRole('button', { name: 'Add announcement' }).click();
    await page.getByRole('group', { name: 'Announcement 2' }).getByRole('textbox', { name: 'Text', exact: true }).fill('Free parking every show');
    await expect(page.getByRole('button', { name: 'Move announcement 2 up' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);
    const bar = api.saves[0].documents.header.data.content[0];
    expect(bar.type).toBe('AnnouncementBar');
    expect(bar.props.hidden).toBe(false);
    expect(bar.props.blocks.map((b: any) => b.props.text)).toEqual(['Tickets on sale now', 'Free parking every show']);
    expect(bar.props.blocks[1].props.id).toMatch(/^Announcement-/);
  });

  test('a 409 explains the conflict and keeps the edits to apply after reloading', async ({ page }) => {
    await mockThemeEditorApi(page, { conflictOnSave: true });
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Mine');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'This theme changed elsewhere' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload' }).click();
    await expect(canvas(page).getByText('Welcome').first()).toBeVisible();
    await page.getByRole('button', { name: 'Apply them again' }).click();
    await expect(canvas(page).getByText('Mine').first()).toBeVisible();
  });

  test('a 400 lists the problems and saves nothing', async ({ page }) => {
    await mockThemeEditorApi(page, { invalidOnSave: true });
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('x');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'The theme has errors' });
    await expect(alert).toContainText('Home page › Hero › Heading: must be at most 120 characters');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  });

  test('problems the browser can see are named before anything is sent', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    // A heading over the 120-character limit: the same check the server runs.
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('x'.repeat(121));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Fix these before saving' });
    await expect(alert).toContainText('Home page › Hero › Heading: must be at most 120 characters');
    expect(api.saves).toEqual([]);
  });

  test('revision history restores the whole theme after a confirm (test 16)', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await page.getByRole('button', { name: 'More editor actions' }).click();
    await page.getByRole('menuitem', { name: 'Revision history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revision history' });
    await expect(dialog.getByTestId('revision-list').getByRole('listitem')).toHaveCount(2);
    await expect(dialog.getByText('Theme settings')).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(/Restore the whole theme to how it was on/)).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).last().click();
    await expect.poll(() => api.restores.length).toBe(1);
    expect(api.restores[0].url).toContain('/revisions/rev-1/restore');
    expect(api.restores[0].body).toEqual({ themeVersion: 1 });
    await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toBeVisible();
  });

  test('reset a saved page to the theme default deletes the stored document', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Saved once');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'More editor actions' }).click();
    // The menu sits above the editor panels: its last item is on top, not clipped under the sidebar.
    const box = (await page.getByRole('menuitem', { name: 'View store' }).boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(onTop).toBe(true);
    await page.getByRole('menuitem', { name: 'Reset home page to theme default' }).click();
    await expect(canvas(page).getByText('Welcome').first()).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(2);
    expect(api.saves[1].documents.home).toEqual({ data: null, version: 1 });
  });

  test('mobile viewport and the inspector toggle', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    await page.getByRole('button', { name: 'Switch to Mobile viewport' }).click();
    await expect
      .poll(async () => page.locator('iframe').first().evaluate((f) => Math.round(f.getBoundingClientRect().width)))
      .toBeLessThanOrEqual(400);
    const inspector = page.getByRole('button', { name: /Inspector/ });
    await expect(inspector).toHaveAttribute('aria-pressed', 'true');
    await inspector.click();
    await expect(inspector).toHaveAttribute('aria-pressed', 'false');
  });

  test('leaving with unsaved changes asks first', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Unsaved');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('link', { name: 'Exit' }).click();
    await expect(page).toHaveURL(/\/editor$/);
  });

  test('an admin in dark mode gets a light editor with readable text, and dark mode back on exit', async ({ page }) => {
    await mockThemeEditorApi(page);
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await page.goto('/admin/online-store');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await openEditor(page);
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    const color = await outline(page).getByRole('button', { name: 'Upcoming events', exact: true }).evaluate((el) => getComputedStyle(el).color);
    // gray-900 text, not the dark theme's near-white foreground.
    expect(color).toBe('rgb(17, 24, 39)');
    await page.getByRole('link', { name: 'Exit' }).click();
    await expect(page).toHaveURL(/\/admin\/online-store$/);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => window.localStorage.getItem('theme'))).toBe('dark');
  });

  test('fields show the storefront default when a document leaves a value unset', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    await outline(page).getByRole('button', { name: 'Hero', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Overlay opacity (%)' })).toHaveAttribute('placeholder', 'Default: 40');
  });

  test('a stylesheet that never finishes loading (e.g. a browser extension\'s) does not stall the canvas', async ({ page }) => {
    await mockThemeEditorApi(page);
    await page.route('**/never-loads.css', () => {});
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/never-loads.css';
        document.head.appendChild(link);
      });
    });
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
    await expect(canvas(page).getByText('Welcome').first()).toBeVisible({ timeout: 60_000 });
  });

  test('our editor chrome passes axe (test 11)', async ({ page }) => {
    await mockThemeEditorApi(page);
    await openEditor(page);
    const results = await new AxeBuilder({ page })
      .include('[data-testid="sections-outline"]')
      .include('[data-testid="editor-actions"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('theme editor as a system administrator', () => {
  test.describe.configure({ timeout: 120_000 });

  test('waits for the org switcher, so every call carries X-Jump-Org', async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'sys', email: 'sys@test.com', role: 'SYSTEM_ADMIN' }, baseURL!);
    await mockThemeEditorApi(page);
    // Production: the org list is slower than the editor's first render.
    await page.route(`${API}/organizations`, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ json: [editorOrg] });
    });
    const withoutOrg: string[] = [];
    // SYSTEM_ADMIN has no memberships: without X-Jump-Org the backend answers 404.
    await page.route(`${API}/admin/**`, (route) => {
      if (route.request().headers()['x-jump-org']) return route.fallback();
      withoutOrg.push(route.request().url());
      return route.fulfill({ status: 404, json: { error: 'NotFoundError', message: 'No organization is assigned to this user' } });
    });
    await openEditor(page);
    expect(withoutOrg).toEqual([]);
  });
});
