import { test, expect, type Page } from '@playwright/test';

const canvas = (page: Page) => page.frameLocator('iframe#preview-frame, iframe').first();

async function openEditor(page: Page) {
  await page.goto('/spike/editor');
  await expect(canvas(page).getByText('Summer Series 2027').first()).toBeVisible({ timeout: 30_000 });
  return page.getByTestId('sections-outline');
}

test.describe('Puck spike editor', () => {
  test('outline selects a section and its fields edit the canvas', async ({ page }) => {
    const outline = await openEditor(page);
    await outline.getByRole('button', { name: 'Hero', exact: true }).first().click();
    const heading = page.getByRole('textbox', { name: 'Heading', exact: true });
    await expect(heading).toBeVisible();
    await heading.fill('Autumn Series');
    await expect(canvas(page).getByText('Autumn Series').first()).toBeVisible();
  });

  test('clicking the canvas selects the section and the outline follows', async ({ page }) => {
    const outline = await openEditor(page);
    await canvas(page).getByText('About the series (1)').click();
    await expect(outline.getByRole('button', { name: 'Rich text', exact: true })).toHaveAttribute('aria-current', 'true');
  });

  test('nested block can be selected from the canvas', async ({ page }) => {
    const outline = await openEditor(page);
    // First click selects the Hero, the second (now inside the selected
    // section) selects the nested Button block.
    await canvas(page).getByRole('button', { name: 'Learn more' }).first().click();
    await canvas(page).getByRole('button', { name: 'Learn more' }).first().click();
    await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Learn more');
    await expect(outline.getByRole('button', { name: 'Button', exact: true }).nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('locked sections offer no delete or duplicate', async ({ page }) => {
    const outline = await openEditor(page);
    await expect(outline.getByRole('button', { name: 'More actions for Header' })).toHaveCount(0);
    await outline.getByRole('button', { name: 'Header', exact: true }).click();
    const frame = canvas(page);
    await expect(frame.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: /duplicate/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  });

  test('hide dims in the editor; keyboard ⋯ menu reorders', async ({ page }) => {
    const outline = await openEditor(page);
    await outline.getByRole('button', { name: 'Hide Rich text' }).click();
    await expect(canvas(page).locator('[data-hidden-section]')).toHaveCount(1);

    const more = outline.locator('summary[aria-label="More actions for Rich text"]');
    await more.focus();
    await page.keyboard.press('Enter');
    await outline.getByRole('menuitem', { name: 'Move up' }).first().click();
    const rows = outline.locator('section').nth(1).locator(':scope > ul > li > div > button:first-child');
    await expect(rows.first()).toHaveText('Rich text');
  });

  test('theme settings restyle the canvas live and undo reverts them', async ({ page }) => {
    await openEditor(page);
    // Finding: Puck 0.23's plugin rail items are not buttons (no role, no
    // tabindex), so the rail is mouse-only; Jump must render its own rail
    // buttons that dispatch setUi({ plugin: { current } }).
    await expect(page.getByRole('button', { name: 'Theme settings' })).toHaveCount(0);
    await page.getByText('Theme settings', { exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Page width' });
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '1400');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const scope = canvas(page).getByTestId('canvas-scope');
    await expect(scope).toHaveAttribute('style', /--theme-page-width: 1400px/);
    await page.getByRole('button', { name: 'undo' }).click();
    await expect(scope).toHaveAttribute('style', /--theme-page-width: 1200px/);
  });

  test('mobile viewport renders a 390 px canvas and selection still works', async ({ page }) => {
    const outline = await openEditor(page);
    await page.getByRole('button', { name: 'Switch to Mobile viewport' }).click();
    await expect.poll(async () => page.locator('iframe').first().evaluate((f) => Math.round(f.getBoundingClientRect().width))).toBeLessThanOrEqual(400);
    await canvas(page).getByText('About the series (1)').click();
    await expect(outline.getByRole('button', { name: 'Rich text', exact: true })).toHaveAttribute('aria-current', 'true');
  });

  test('inspector off: canvas clicks no longer select', async ({ page }) => {
    const outline = await openEditor(page);
    await page.getByRole('button', { name: /Inspector on/ }).click();
    await canvas(page).getByText('About the series (1)').click();
    await expect(outline.getByRole('button', { name: 'Rich text', exact: true })).not.toHaveAttribute('aria-current', 'true');
  });

  test('save splits the one tree into header / home / footer + settings', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Save' }).click();
    const saved = JSON.parse((await page.getByTestId('saved').textContent()) || '{}');
    expect(Object.keys(saved.documents)).toEqual(['header', 'home', 'footer']);
    expect(saved.documents.header.data.content.map((c: any) => c.type)).toEqual(['AnnouncementBar', 'Header']);
    expect(saved.documents.home.data.content).toHaveLength(4);
    expect(saved.documents.footer.data.content[0].type).toBe('Footer');
  });
});
