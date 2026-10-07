// Content › Galleries (spec 046B): list, editor with sections, photo panel,
// alt-text summary, multi-select picker, button moves, whole-tree PUT —
// backend mocked, at phone and desktop widths, with axe.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-galleries';
// 1×1 PNG so every <img> loads without a backend.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const fileView = (name: string, altText: string | null) => ({
  name,
  altText,
  width: 1200,
  height: 800,
  thumbUrl: `/images/${name}/h/thumb`,
  previewUrl: `/images/${name}/h/card`,
  src: `/images/${name}/h/w1600`,
  srcset: `/images/${name}/h/w480 480w, /images/${name}/h/w1200 1200w`,
});

const gallery = {
  id: 'gal-1',
  title: 'Retro Expo',
  handle: 'retro-expo',
  description: null,
  placements: [{ kind: 'PAGE', targetId: 'pg-1', title: 'Photos', href: '/admin/online-store/pages/pg-1' }],
  updatedAt: '2026-10-07T12:00:00.000Z',
  sections: [
    {
      id: 'sec-1',
      title: 'Main floor',
      items: [
        { id: 'it-1', fileId: 'f-crowd', altText: null, decorative: false, caption: null, alt: 'Crowd', file: fileView('crowd', 'Crowd') },
        { id: 'it-2', fileId: 'f-stage', altText: null, decorative: false, caption: null, alt: '', file: fileView('stage', null) },
      ],
    },
    { id: 'sec-2', title: 'Cosplay', items: [] },
  ],
};

const pickerFiles = ['arcade', 'pinball'].map((name) => ({
  id: `f-${name}`,
  organizationId: ORG_ID,
  name,
  extension: 'png',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 1000,
  width: 800,
  height: 600,
  altText: `${name} cabinet`,
  url: `/files/f-${name}/h/${name}.png`,
  downloadUrl: '',
  thumbUrl: `/images/${name}/h/thumb`,
  previewUrl: `/images/${name}/h/card`,
  focalX: 0.5,
  focalY: 0.5,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}));

async function mockApi(page: Page, { empty = false } = {}) {
  const puts: any[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`${API}/images/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(
      json([{ id: ORG_ID, name: 'Gallery Org', slug: 'gallery-org', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }])
    )
  );
  await page.route(`${API}/admin/files**`, (route) => route.fulfill(json({ files: pickerFiles, total: 2, page: 1, pageSize: 50 })));
  await page.route(`${API}/admin/galleries**`, (route) =>
    route.fulfill(
      json({
        galleries: empty
          ? []
          : [{ id: 'gal-1', title: 'Retro Expo', handle: 'retro-expo', sectionCount: 2, photoCount: 2, coverThumbUrl: '/images/crowd/h/thumb', placementCount: 1, updatedAt: gallery.updatedAt }],
      })
    )
  );
  await page.route(`${API}/admin/galleries/gal-1**`, (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      puts.push(body);
      let n = 0;
      return route.fulfill(
        json({
          ...gallery,
          title: body.title,
          sections: body.sections.map((section: any, s: number) => ({
            id: `saved-s${s}`,
            title: section.title,
            items: section.items.map((item: any) => ({
              id: `saved-${(n += 1)}`,
              ...item,
              alt: item.altText ?? '',
              file: fileView(item.fileId.replace('f-', ''), item.fileId === 'f-crowd' ? 'Crowd' : null),
            })),
          })),
        })
      );
    }
    return route.fulfill(json(gallery));
  });
  return { puts };
}

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test.describe(`galleries on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page, baseURL }) => {
      await signInAsStaff(page, { id: 'gal-admin', email: 'gal-admin@test.com', role: 'ADMIN' }, baseURL!);
    });

    test('lists galleries and shows the empty state', async ({ page }) => {
      await mockApi(page);
      await page.goto('/admin/content/galleries');
      await expect(page.getByRole('heading', { name: 'Galleries', level: 1 })).toBeVisible();
      const row = page.getByTestId('gallery-row');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Retro Expo');
      await expect(row).toContainText('2 photos · 2 sections');
      await expect(row).toContainText('Used in 1 place');
      expect(await seriousViolations(page)).toEqual([]);

      await page.unroute(`${API}/admin/galleries**`);
      await mockApi(page, { empty: true });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'No galleries yet' })).toBeVisible();
    });

    test('edits a gallery: alt text summary, picker, moves, whole-tree save', async ({ page }) => {
      const { puts } = await mockApi(page);
      await page.goto('/admin/content/galleries/gal-1');
      await expect(page.getByRole('heading', { name: 'Retro Expo', level: 1 })).toBeVisible();
      await expect(page.getByTestId('gallery-photo')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Edit photo: stage (alt text missing)' })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);

      // Add two photos to Cosplay through the multi-select picker.
      await page.getByRole('region', { name: 'Cosplay' }).getByRole('button', { name: 'Add photos' }).click();
      const picker = page.getByRole('dialog', { name: 'Add photos' });
      await picker.getByRole('button', { name: /arcade/ }).click();
      await picker.getByRole('button', { name: /pinball/ }).click();
      await expect(picker.getByRole('button', { name: /arcade/ })).toHaveAttribute('aria-pressed', 'true');
      await picker.getByRole('button', { name: 'Add 2 photos' }).click();
      await expect(page.getByRole('region', { name: 'Cosplay' }).getByTestId('gallery-photo')).toHaveCount(2);

      // Save is refused while a photo has no alt text; the summary takes focus.
      await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();
      const summary = page.getByTestId('alt-summary');
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('1 photo needs alt text');
      expect(puts).toHaveLength(0);

      // Fix it from the summary: the photo panel opens; type alt text and move it earlier.
      await summary.getByRole('button', { name: /Main floor, photo 2/ }).click();
      const panel = page.getByRole('dialog', { name: /Photo 2 of 2/ });
      await expect(panel).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await panel.getByLabel('Alt text').fill('Main stage at noon');
      await panel.getByLabel('Caption (optional)').fill('Saturday');
      await panel.getByRole('button', { name: 'Move earlier' }).click();
      await expect(page.getByRole('dialog', { name: /Photo 1 of 2/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Edit photo: Main stage at noon' })).toBeFocused();

      await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();
      await expect(page.getByTestId('toast')).toContainText('Gallery saved');
      await expect(page.getByTestId('save-bar')).toHaveCount(0);
      expect(puts[0]).toEqual({
        title: 'Retro Expo',
        description: null,
        sections: [
          {
            title: 'Main floor',
            items: [
              { fileId: 'f-stage', altText: 'Main stage at noon', decorative: false, caption: 'Saturday' },
              { fileId: 'f-crowd', altText: null, decorative: false, caption: null },
            ],
          },
          {
            title: 'Cosplay',
            items: [
              { fileId: 'f-arcade', altText: null, decorative: false, caption: null },
              { fileId: 'f-pinball', altText: null, decorative: false, caption: null },
            ],
          },
        ],
      });
    });

    test('moves sections and deletes one, keeping its photos', async ({ page }) => {
      const { puts } = await mockApi(page);
      await page.goto('/admin/content/galleries/gal-1');
      await page.getByRole('button', { name: 'Move Cosplay up' }).click();
      await expect(page.getByTestId('gallery-section').first()).toHaveAttribute('aria-label', 'Cosplay');
      await page.getByRole('button', { name: 'Delete Main floor' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Delete Main floor?' });
      await expect(confirm.getByLabel('Move to Cosplay')).toBeChecked();
      await confirm.getByRole('button', { name: 'Delete section' }).click();
      await expect(page.getByTestId('gallery-section')).toHaveCount(1);
      // Stage still lacks alt text: mark it decorative from its panel, then save.
      await page.getByRole('button', { name: 'Edit photo: stage (alt text missing)' }).click();
      await page.getByRole('dialog').getByLabel('Decorative (adds no information)').check();
      await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
      await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();
      await expect(page.getByTestId('toast')).toContainText('Gallery saved');
      expect(puts[0].sections).toEqual([
        {
          title: 'Cosplay',
          items: [
            { fileId: 'f-crowd', altText: null, decorative: false, caption: null },
            { fileId: 'f-stage', altText: null, decorative: true, caption: null },
          ],
        },
      ]);
    });
  });
}
