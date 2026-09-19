// Contract tests for Content › Files (spec 025).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'files-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`, `sysadmin@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
// Minimal valid PDF (single empty page).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n' +
    ` files-ct ${TAG} `
);

describe('Content › Files contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let sysAdminToken;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    sysAdminToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  let png;
  let pdf;

  it('uploads an image and a PDF in one request', async () => {
    const response = await request(app)
      .post('/admin/files')
      .set(...auth(organizerToken))
      .attach('files', PNG, { filename: 'Hero Image.png', contentType: 'image/png' })
      .attach('files', PDF, { filename: 'sponsor-packet.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.errors).toEqual([]);
    expect(response.body.files).toHaveLength(2);
    [png, pdf] = response.body.files;

    expect(png).toMatchObject({
      name: 'Hero Image',
      extension: 'png',
      kind: 'image',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      focalX: 0.5,
      altText: null,
      referenceCount: 0,
    });
    expect(png.url).toMatch(
      /^http:\/\/localhost:\d+\/files\/[a-z0-9]+\/[a-f0-9]{64}\/hero-image\.png$/
    );
    expect(png.thumbUrl).toMatch(/^\/images\/[a-z0-9]+\/[a-f0-9]{64}\/thumb$/);
    expect(pdf).toMatchObject({
      name: 'sponsor-packet',
      extension: 'pdf',
      kind: 'document',
      mimeType: 'application/pdf',
      thumbUrl: null,
    });
    expect(pdf.url).toMatch(/\/sponsor-packet\.pdf$/);
  });

  it('rejects files whose bytes do not match an allowed type', async () => {
    const response = await request(app)
      .post('/admin/files')
      .set(...auth(organizerToken))
      .attach('files', Buffer.from('MZ not really'), {
        filename: 'virus.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Only JPG/);

    const none = await request(app)
      .post('/admin/files')
      .set(...auth(organizerToken));
    expect(none.status).toBe(400);
  });

  it('reports partial success per file', async () => {
    const response = await request(app)
      .post('/admin/files')
      .set(...auth(organizerToken))
      .attach('files', PNG, { filename: 'ok.png', contentType: 'image/png' })
      .attach('files', Buffer.from('nope'), { filename: 'bad.png', contentType: 'image/png' });
    expect(response.status).toBe(201);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.errors).toEqual([
      { name: 'bad.png', message: expect.stringMatching(/Only JPG/) },
    ]);
    await request(app)
      .delete(`/admin/files/${response.body.files[0].id}`)
      .set(...auth(organizerToken));
  });

  it('shares bytes across organizations but not rows', async () => {
    const response = await request(app)
      .post('/admin/files')
      .set(...auth(otherToken))
      .attach('files', PDF, { filename: 'same.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(201);
    const theirs = response.body.files[0];
    expect(theirs.id).not.toBe(pdf.id);

    const files = await prisma.file.findMany({
      where: { storeFiles: { some: { id: { in: [pdf.id, theirs.id] } } } },
    });
    expect(files).toHaveLength(1);

    const mine = await request(app)
      .get('/admin/files')
      .set(...auth(organizerToken));
    expect(mine.body.files.map((f) => f.id)).not.toContain(theirs.id);
    const cross = await request(app)
      .get(`/admin/files/${theirs.id}`)
      .set(...auth(organizerToken));
    expect(cross.status).toBe(404);
  });

  it('lists with search, type filter, sort and pagination', async () => {
    const all = await request(app)
      .get('/admin/files')
      .set(...auth(organizerToken));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(all.body.files.map((f) => f.id)).toEqual([pdf.id, png.id]);

    const images = await request(app)
      .get('/admin/files?type=image')
      .set(...auth(organizerToken));
    expect(images.body.files.map((f) => f.id)).toEqual([png.id]);
    const pdfs = await request(app)
      .get('/admin/files?type=pdf')
      .set(...auth(organizerToken));
    expect(pdfs.body.files.map((f) => f.id)).toEqual([pdf.id]);

    const search = await request(app)
      .get('/admin/files?q=HERO')
      .set(...auth(organizerToken));
    expect(search.body.files.map((f) => f.id)).toEqual([png.id]);

    const byName = await request(app)
      .get('/admin/files?sort=name')
      .set(...auth(organizerToken));
    expect(byName.body.files.map((f) => f.name)).toEqual(['Hero Image', 'sponsor-packet']);

    const paged = await request(app)
      .get('/admin/files?pageSize=1&page=2')
      .set(...auth(organizerToken));
    expect(paged.body.files).toHaveLength(1);
    expect(paged.body.total).toBe(2);
  });

  it('serves the public URL with immutable caching and a download variant', async () => {
    const pathname = new URL(png.url).pathname;
    const served = await request(app).get(pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['content-disposition']).toMatch(/^inline; filename="Hero Image.png"/);
    expect(served.body.equals(PNG)).toBe(true);

    const download = await request(app).get(`${pathname}?download=1`);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);

    const cached = await request(app).get(pathname).set('If-None-Match', served.headers.etag);
    expect(cached.status).toBe(304);

    const wrongHash = await request(app).get(
      pathname.replace(/\/[a-f0-9]{64}\//, `/${'0'.repeat(64)}/`)
    );
    expect(wrongHash.status).toBe(404);

    const doc = await request(app).get(new URL(pdf.url).pathname);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toBe('application/pdf');
  });

  it('updates name, alt text and focal point through a whitelist', async () => {
    const response = await request(app)
      .patch(`/admin/files/${png.id}`)
      .set(...auth(organizerToken))
      .send({ name: 'Hero', altText: '  Crowd at the gate ', focalX: 0.25, focalY: 0.75 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Hero',
      altText: 'Crowd at the gate',
      focalX: 0.25,
      focalY: 0.75,
      references: [],
    });
    expect(response.body.url).toMatch(/\/hero\.png$/);

    const oldPath = new URL(png.url).pathname;
    expect((await request(app).get(oldPath)).status).toBe(200);

    const bad = await request(app)
      .patch(`/admin/files/${png.id}`)
      .set(...auth(organizerToken))
      .send({ extension: 'exe' });
    expect(bad.status).toBe(400);
    const cleared = await request(app)
      .patch(`/admin/files/${png.id}`)
      .set(...auth(organizerToken))
      .send({ altText: '' });
    expect(cleared.body.altText).toBeNull();
  });

  it('tracks pages that use a file and lists them under references', async () => {
    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({
        title: `${TAG} Vendors`,
        content: `<p>Packet: <a href="${pdf.url}">download</a> <img src="${png.url}"></p>`,
      });
    expect(created.status).toBe(201);

    const detail = await request(app)
      .get(`/admin/files/${pdf.id}`)
      .set(...auth(organizerToken));
    expect(detail.body.referenceCount).toBe(1);
    expect(detail.body.references).toEqual([
      {
        kind: 'PAGE',
        targetId: created.body.id,
        title: `${TAG} Vendors`,
        href: `/admin/online-store/pages/${created.body.id}`,
      },
    ]);

    const updated = await request(app)
      .put(`/admin/pages/${created.body.id}`)
      .set(...auth(organizerToken))
      .send({ content: '<p>no more links</p>' });
    expect(updated.status).toBe(200);
    const after = await request(app)
      .get(`/admin/files/${pdf.id}`)
      .set(...auth(organizerToken));
    expect(after.body.referenceCount).toBe(0);
    await prisma.page.delete({ where: { id: created.body.id } });
  });

  it('honors X-Jump-Org for SYSTEM_ADMIN', async () => {
    const response = await request(app)
      .get('/admin/files')
      .set(...auth(sysAdminToken))
      .set('X-Jump-Org', organization.id);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
  });

  it('rejects upload-from-URL targets that are not public', async () => {
    const response = await request(app)
      .post('/admin/files/from-url')
      .set(...auth(organizerToken))
      .send({ url: 'http://127.0.0.1:3000/images/x' });
    expect(response.status).toBe(400);
    const missing = await request(app)
      .post('/admin/files/from-url')
      .set(...auth(organizerToken))
      .send({});
    expect(missing.status).toBe(400);
  });

  it('deletes one file and bulk-deletes the rest', async () => {
    const one = await request(app)
      .delete(`/admin/files/${png.id}`)
      .set(...auth(organizerToken));
    expect(one.status).toBe(204);
    expect(
      (
        await request(app)
          .get(`/admin/files/${png.id}`)
          .set(...auth(organizerToken))
      ).status
    ).toBe(404);
    expect(
      await prisma.image.count({ where: { usageType: 'store_file', storeFile: { is: null } } })
    ).toBe(0);

    const bulk = await request(app)
      .post('/admin/files/bulk-delete')
      .set(...auth(organizerToken))
      .send({ ids: [pdf.id, 'nope'] });
    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual({
      deleted: [pdf.id],
      failed: [{ id: 'nope', message: 'File not found' }],
    });

    const empty = await request(app)
      .get('/admin/files')
      .set(...auth(organizerToken));
    expect(empty.body.total).toBe(0);
  });
});
