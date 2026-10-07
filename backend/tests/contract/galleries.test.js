// Contract tests for Content › Galleries (spec 046 card A).

import request from 'supertest';
import sharp from 'sharp';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'galleries-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

// Unique pixels per run so the content-addressed File rows are this suite's own.
const seed = Date.now() % 200;
const wide = () =>
  sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: seed, g: 10, b: 20 } } })
    .png()
    .toBuffer();
const small = () =>
  sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 20, g: seed, b: 10 } } })
    .png()
    .toBuffer();

describe('Content › Galleries contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let wideFile;
  let smallFile;
  let pdfFile;
  let foreignFile;
  let gallery;

  const upload = async (token, buffer, filename, contentType = 'image/png') => {
    const response = await request(app)
      .post('/admin/files')
      .set(...auth(token))
      .attach('files', buffer, { filename, contentType });
    expect(response.status).toBe(201);
    return response.body.files[0];
  };

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');

    wideFile = await upload(organizerToken, await wide(), 'main-floor.png');
    smallFile = await upload(organizerToken, await small(), 'badge.png');
    pdfFile = await upload(
      organizerToken,
      Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' +
          ` ${TAG} ${seed} `
      ),
      'packet.pdf',
      'application/pdf'
    );
    foreignFile = await upload(otherToken, await small(), 'theirs.png');
    await prisma.storeFile.update({ where: { id: wideFile.id }, data: { altText: 'Crowd on the main floor' } });
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('creates a gallery with one empty section and a unique handle', async () => {
    const response = await request(app)
      .post('/admin/galleries')
      .set(...auth(organizerToken))
      .send({ title: 'Retro Expo 2026' });
    expect(response.status).toBe(201);
    gallery = response.body;
    expect(gallery).toMatchObject({ title: 'Retro Expo 2026', handle: 'retro-expo-2026', placements: [] });
    expect(gallery.sections).toEqual([{ id: expect.any(String), title: null, items: [] }]);

    const again = await request(app)
      .post('/admin/galleries')
      .set(...auth(organizerToken))
      .send({ title: 'Retro Expo 2026' });
    expect(again.body.handle).toBe('retro-expo-2026-2');

    const bad = await request(app).post('/admin/galleries').set(...auth(organizerToken)).send({ title: ' ' });
    expect(bad.status).toBe(400);
  });

  it('replaces the whole tree and keeps positions dense', async () => {
    const response = await request(app)
      .put(`/admin/galleries/${gallery.id}`)
      .set(...auth(organizerToken))
      .send({
        title: 'Retro Expo',
        description: 'Photos from the show',
        sections: [
          {
            title: 'Main floor',
            items: [
              { fileId: wideFile.id, caption: ' Saturday ' },
              { fileId: smallFile.id, altText: 'Show badge' },
            ],
          },
          { title: '  ', items: [{ fileId: smallFile.id, decorative: true, altText: 'ignored' }] },
        ],
      });
    expect(response.status).toBe(200);
    const body = response.body;
    expect(body.title).toBe('Retro Expo');
    expect(body.description).toBe('Photos from the show');
    expect(body.sections.map((s) => s.title)).toEqual(['Main floor', null]);
    const [first, second] = body.sections[0].items;
    expect(first).toMatchObject({ fileId: wideFile.id, altText: null, alt: 'Crowd on the main floor', caption: 'Saturday' });
    expect(second).toMatchObject({ altText: 'Show badge', alt: 'Show badge' });
    expect(body.sections[1].items[0]).toMatchObject({ decorative: true, altText: null, alt: '' });

    const rows = await prisma.gallerySection.findMany({
      where: { galleryId: gallery.id },
      orderBy: { position: 'asc' },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0].items.map((i) => i.position)).toEqual([0, 1]);
  });

  it('serves width srcsets that never exceed the original', async () => {
    const { body } = await request(app)
      .get(`/admin/galleries/${gallery.id}`)
      .set(...auth(organizerToken));
    const [wideItem, smallItem] = body.sections[0].items;
    expect(wideItem.file).toMatchObject({ width: 3000, height: 1500 });
    expect(wideItem.file.srcset.split(', ').map((c) => c.split(' ')[1])).toEqual([
      '480w',
      '960w',
      '1600w',
      '2400w',
    ]);
    expect(wideItem.file.src).toMatch(/\/w1600$/);
    // 300 px wide: one candidate, at its own width.
    expect(smallItem.file.srcset).toMatch(/\/w480 300w$/);
    expect(smallItem.file.srcset.split(', ')).toHaveLength(1);
  });

  it('generates a width variant on first request, then serves it again', async () => {
    const path = new URL(
      (await request(app).get(`/admin/galleries/${gallery.id}`).set(...auth(organizerToken))).body.sections[0]
        .items[0].file.srcset.split(', ')[3].split(' ')[0],
      'http://x'
    ).pathname;
    const first = await request(app).get(path);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/webp');
    const meta = await sharp(first.body).metadata();
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(1200);
    const second = await request(app).get(path);
    expect(second.status).toBe(200);
    expect(Buffer.compare(second.body, first.body)).toBe(0);

    const [, , imageId, hash] = path.split('/');
    expect((await request(app).get(`/images/${imageId}/${hash}/w9999`)).status).toBe(404);
    expect((await request(app).get(`/images/${imageId}/${'0'.repeat(64)}/w480`)).status).toBe(404);
  });

  it('refuses photos without alt text unless decorative', async () => {
    const response = await request(app)
      .put(`/admin/galleries/${gallery.id}`)
      .set(...auth(organizerToken))
      .send({ sections: [{ items: [{ fileId: wideFile.id }, { fileId: smallFile.id }] }] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('ALT_TEXT_REQUIRED');
    expect(response.body.details.items).toEqual([{ section: 0, item: 1, fileId: smallFile.id }]);
  });

  it('refuses another store’s file, a document and unknown ids', async () => {
    for (const fileId of [foreignFile.id, pdfFile.id, 'nope']) {
      const response = await request(app)
        .put(`/admin/galleries/${gallery.id}`)
        .set(...auth(organizerToken))
        .send({ sections: [{ items: [{ fileId, decorative: true }] }] });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('GALLERY_FILE_INVALID');
    }
  });

  it('enforces the section and photo limits', async () => {
    const tooManySections = Array.from({ length: 21 }, () => ({ items: [] }));
    const sections = await request(app)
      .put(`/admin/galleries/${gallery.id}`)
      .set(...auth(organizerToken))
      .send({ sections: tooManySections });
    expect(sections.status).toBe(400);
    expect(sections.body.code).toBe('GALLERY_LIMIT');

    const items = Array.from({ length: 501 }, () => ({ fileId: wideFile.id }));
    const photos = await request(app)
      .put(`/admin/galleries/${gallery.id}`)
      .set(...auth(organizerToken))
      .send({ sections: [{ items }] });
    expect(photos.status).toBe(400);
    expect(photos.body.code).toBe('GALLERY_LIMIT');
  });

  it('keeps every gallery inside its organization', async () => {
    expect((await request(app).get(`/admin/galleries/${gallery.id}`).set(...auth(otherToken))).status).toBe(404);
    expect(
      (
        await request(app)
          .put(`/admin/galleries/${gallery.id}`)
          .set(...auth(otherToken))
          .send({ sections: [] })
      ).status
    ).toBe(404);
    expect((await request(app).delete(`/admin/galleries/${gallery.id}`).set(...auth(otherToken))).status).toBe(404);
    const list = await request(app).get('/admin/galleries').set(...auth(otherToken));
    expect(list.body.galleries).toEqual([]);
  });

  it('lists galleries with counts, a cover and placements', async () => {
    await prisma.page.create({
      data: {
        organizationId: organization.id,
        title: 'Photos',
        slug: `photos-${seed}`,
        content: `<p>x</p><figure data-jump-gallery="${gallery.id}" data-layout="masonry"></figure>`,
        isVisible: true,
      },
    });
    const { body } = await request(app).get('/admin/galleries').set(...auth(organizerToken));
    const row = body.galleries.find((g) => g.id === gallery.id);
    expect(row).toMatchObject({ sectionCount: 2, photoCount: 3, placementCount: 1 });
    expect(row.coverThumbUrl).toMatch(/\/thumb$/);

    const detail = await request(app).get(`/admin/galleries/${gallery.id}`).set(...auth(organizerToken));
    expect(detail.body.placements).toEqual([
      expect.objectContaining({ kind: 'PAGE', title: 'Photos', href: expect.stringMatching(/^\/admin\/online-store\/pages\//) }),
    ]);
  });

  it('shows the gallery in Files “Used in”, and a file delete removes its photos', async () => {
    const file = await request(app).get(`/admin/files/${smallFile.id}`).set(...auth(organizerToken));
    expect(file.body.references).toEqual([
      { kind: 'GALLERY', targetId: gallery.id, title: 'Gallery Retro Expo', href: `/admin/content/galleries/${gallery.id}` },
    ]);

    const removed = await request(app).delete(`/admin/files/${smallFile.id}`).set(...auth(organizerToken));
    expect(removed.status).toBe(204);

    const { body } = await request(app).get(`/admin/galleries/${gallery.id}`).set(...auth(organizerToken));
    expect(body.sections[0].items.map((i) => i.fileId)).toEqual([wideFile.id]);
    expect(body.sections[1].items).toEqual([]);
  });

  it('resolves the public shape for its organization only', async () => {
    const { default: galleryService } = await import('../../src/services/GalleryService.js');
    const mine = await galleryService.resolveForOrg(organization.id, [gallery.id, 'missing']);
    expect(Object.keys(mine)).toEqual([gallery.id]);
    // The emptied second section is left out of the storefront shape.
    expect(mine[gallery.id].sections).toHaveLength(1);
    expect(mine[gallery.id].sections[0].items[0]).toEqual({
      id: expect.any(String),
      src: expect.stringMatching(/\/w1600$/),
      srcset: expect.stringContaining('2400w'),
      width: 3000,
      height: 1500,
      alt: 'Crowd on the main floor',
      caption: 'Saturday',
    });
    expect(await galleryService.resolveForOrg(otherOrganization.id, [gallery.id])).toEqual({});
  });

  it('resolves Gallery sections for themed pages, organization-scoped', async () => {
    const { default: themeService } = await import('../../src/services/ThemeService.js');
    const { galleryIdsInThemeJson } = await import('@jump/theme');
    const documents = {
      template: {
        content: [
          { type: 'Gallery', props: { id: 'G1', gallery: gallery.id } },
          { type: 'Hero', props: { id: 'H1', gallery: 'not-a-gallery-section' } },
        ],
      },
    };
    expect(galleryIdsInThemeJson(documents)).toEqual([gallery.id]);
    const mine = await themeService._resolve(organization.id, { documents }, { events: false });
    expect(Object.keys(mine.galleries)).toEqual([gallery.id]);
    const theirs = await themeService._resolve(otherOrganization.id, { documents }, { events: false });
    expect(theirs.galleries).toEqual({});
    // The editor preview resolves every gallery of the store, placed or not.
    const preview = await themeService._resolve(organization.id, { documents: {} }, { events: false, allGalleries: true });
    expect(Object.keys(preview.galleries)).toContain(gallery.id);
  });

  it('deletes a gallery and clears its file references', async () => {
    const response = await request(app).delete(`/admin/galleries/${gallery.id}`).set(...auth(organizerToken));
    expect(response.status).toBe(204);
    expect(await prisma.storeFileReference.count({ where: { kind: 'GALLERY', targetId: gallery.id } })).toBe(0);
    expect(await prisma.storeFile.count({ where: { id: wideFile.id } })).toBe(1);
  });
});
