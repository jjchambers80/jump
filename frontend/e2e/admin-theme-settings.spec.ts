import { expect as baseExpect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';
import { mockThemeEditorApi } from './helpers/themeEditorMocks';

// Spec 049 card C: the theme editor's gear panel (Logo, Colors, Typography).
// Settings ride Puck's history, restyle the canvas at once and save with the documents.

const expect = baseExpect.configure({ timeout: 20_000 });
const canvas = (page: Page) => page.frameLocator('iframe').first();
const scope = (page: Page) => canvas(page).locator('[data-theme-type]').first();
const panel = (page: Page) => page.getByTestId('theme-settings');

test.describe('theme settings panel (spec 049 C)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, baseURL }) => {
    await signInAsStaff(page, { id: 'editor-admin', email: 'editor-admin@test.com', role: 'ADMIN' }, baseURL!);
  });

  test('heading and body fonts and scheme accent restyle the canvas, undo reverts, Save sends settings', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    await page.goto('/admin/online-store/themes/theme-main/editor');
    await expect(canvas(page).getByText('Welcome').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Theme settings' }).click();
    await expect(panel(page).getByRole('button', { name: 'Logo', expanded: true })).toBeVisible();
    await expect(panel(page).getByText('Using your brand logo.')).toBeVisible();

    // One group open at a time.
    await panel(page).getByRole('button', { name: 'Typography' }).click();
    await expect(panel(page).getByRole('button', { name: 'Logo' })).toHaveAttribute('aria-expanded', 'false');
    await panel(page).getByLabel('Heading font').selectOption('oswald');
    await expect(scope(page)).toHaveAttribute('style', /--theme-heading-font: var\(--theme-font-oswald\)/);
    // Heading font on every heading; body text keeps the body font.
    const headingFont = () => page.frames()[1].evaluate(() => getComputedStyle(document.querySelector('[data-theme-type] h1, [data-theme-type] h2')!).fontFamily);
    const bodyFont = () => page.frames()[1].evaluate(() => getComputedStyle(document.querySelector('[data-theme-type] a, [data-theme-type] p')!).fontFamily);
    await expect.poll(headingFont).toContain('Oswald');
    await expect.poll(bodyFont).not.toContain('Oswald');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

    // Undo covers settings (they live in Puck's root props).
    await page.getByTitle('Undo').click();
    await expect(scope(page)).toHaveAttribute('style', /--theme-heading-font: var\(--theme-font-inter\)/);
    await expect.poll(headingFont).toContain('Inter');
    await expect(panel(page).getByLabel('Heading font')).toHaveValue('inter');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await panel(page).getByLabel('Heading font').selectOption('oswald');
    await panel(page).getByLabel('Body font').selectOption('lora');
    await expect.poll(bodyFont).toContain('Lora');
    await expect.poll(headingFont).toContain('Oswald');

    await panel(page).getByRole('button', { name: 'Colors' }).click();
    await panel(page).locator('summary', { hasText: 'Inverse' }).click();
    const inverse = panel(page).locator('details[open]');
    await inverse.getByLabel('Accent (buttons and links)').selectOption('custom');
    await inverse.getByLabel('Accent (buttons and links) color').fill('#ff0000');
    const schemeCss = () =>
      page.frames()[1].evaluate(() => [...document.querySelectorAll('style')].map((el) => el.textContent ?? '').find((css) => css.includes('.jump-scheme-2{')) ?? '');
    await expect.poll(schemeCss).toContain('--brand:#ff0000');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.saves.length).toBe(1);
    const body = api.saves[0];
    expect(body.documents).toBeUndefined();
    expect(body.settings.typography).toEqual({ headingFont: 'oswald', bodyFont: 'lora' });
    expect(body.settings.colors.schemes.map((s: any) => s.id)).toEqual(['scheme-1', 'scheme-2']);
    expect(body.settings.colors.schemes[1].accent).toBe('#ff0000');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('reset removes the group overrides; a scheme a page uses cannot be removed', async ({ page }) => {
    const api = await mockThemeEditorApi(page);
    const home = structuredClone(api.docs.home);
    home.content[0].props.colorScheme = 'scheme-2';
    api.docs.home = home;
    await page.goto('/admin/online-store/themes/theme-main/editor');
    await expect(canvas(page).getByText('Welcome').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Theme settings' }).click();

    await panel(page).getByRole('spinbutton', { name: /Logo size/ }).fill('200');
    await expect(scope(page)).toHaveAttribute('style', /--theme-logo-width: 200px/);
    await panel(page).getByRole('button', { name: 'Reset to theme defaults' }).click();
    await expect(scope(page)).toHaveAttribute('style', /--theme-logo-width: 120px/);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    await panel(page).getByRole('button', { name: 'Colors' }).click();
    await panel(page).getByRole('button', { name: 'Add color scheme' }).click();
    await expect(panel(page).locator('summary', { hasText: 'Scheme 3' })).toBeVisible();
    await panel(page).locator('summary', { hasText: 'Inverse' }).click();
    const inverse = panel(page).locator('details[open]');
    await expect(inverse.getByRole('button', { name: 'Remove' })).toBeDisabled();
    await expect(inverse.getByText(/^Used by Home page/)).toBeVisible();
  });
});
