// Contract tests for Content › URL redirects (spec 028).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'redirects-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Content › URL redirects contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let redirect;

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
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('creates a normalised redirect and refuses duplicates', async () => {
    const created = await request(app)
      .post('/admin/redirects')
      .set(...auth(organizerToken))
      .send({ fromPath: 'Vendor-Info/', toPath: 'pages/vendors' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      fromPath: '/vendor-info',
      toPath: '/pages/vendors',
      absolute: false,
    });
    redirect = created.body;

    const dup = await request(app)
      .post('/admin/redirects')
      .set(...auth(organizerToken))
      .send({ fromPath: '/VENDOR-INFO', toPath: '/pages/other' });
    expect(dup.status).toBe(409);
  });

  it('rejects reserved paths, self-redirects, bad targets and unknown fields', async () => {
    const send = (body) =>
      request(app)
        .post('/admin/redirects')
        .set(...auth(organizerToken))
        .send(body);
    expect((await send({ fromPath: '/events/abc', toPath: '/pages/x' })).status).toBe(400);
    expect((await send({ fromPath: '/loop', toPath: '/loop' })).status).toBe(400);
    expect((await send({ fromPath: '/x', toPath: 'javascript:alert(1)' })).status).toBe(400);
    expect((await send({ fromPath: '/x', toPath: '/y', bogus: 1 })).status).toBe(400);
    expect((await send({ fromPath: '', toPath: '/y' })).status).toBe(400);
  });

  it('resolves publicly with normalisation, one hop, not gated', async () => {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: true, storefrontPasswordHash: 'x' },
    });
    const hit = await request(app).get(
      `/organizations/${organization.id}/public/redirect?path=/Vendor-Info/?utm=1`
    );
    expect(hit.status).toBe(200);
    expect(hit.body).toEqual({ to: '/pages/vendors', absolute: false });
    expect(hit.headers['cache-control']).toBe('public, max-age=60');
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: false, storefrontPasswordHash: null },
    });

    const miss = await request(app).get(
      `/organizations/${organization.id}/public/redirect?path=/nope`
    );
    expect(miss.status).toBe(404);
    const otherOrg = await request(app).get(
      `/organizations/${otherOrganization.id}/public/redirect?path=/vendor-info`
    );
    expect(otherOrg.status).toBe(404);
  });

  it('updates, lists with search, and marks absolute targets', async () => {
    const updated = await request(app)
      .patch(`/admin/redirects/${redirect.id}`)
      .set(...auth(organizerToken))
      .send({ toPath: 'https://tix.partner.com/show' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      fromPath: '/vendor-info',
      toPath: 'https://tix.partner.com/show',
      absolute: true,
    });

    await request(app)
      .post('/admin/redirects')
      .set(...auth(organizerToken))
      .send({ fromPath: '/flyer', toPath: '/pages/flyer' });
    const all = await request(app)
      .get('/admin/redirects')
      .set(...auth(organizerToken));
    expect(all.body.total).toBe(2);
    expect(all.body.redirects.map((r) => r.fromPath)).toEqual(['/flyer', '/vendor-info']);
    const search = await request(app)
      .get('/admin/redirects?q=partner')
      .set(...auth(organizerToken));
    expect(search.body.redirects.map((r) => r.fromPath)).toEqual(['/vendor-info']);
    const cross = await request(app)
      .get('/admin/redirects')
      .set(...auth(otherToken));
    expect(cross.body.total).toBe(0);
    expect(
      (
        await request(app)
          .patch(`/admin/redirects/${redirect.id}`)
          .set(...auth(otherToken))
          .send({ toPath: '/x' })
      ).status
    ).toBe(404);
  });

  it('deletes one and bulk-deletes the rest', async () => {
    expect(
      (
        await request(app)
          .delete(`/admin/redirects/${redirect.id}`)
          .set(...auth(organizerToken))
      ).status
    ).toBe(204);
    const remaining = await request(app)
      .get('/admin/redirects')
      .set(...auth(organizerToken));
    const bulk = await request(app)
      .post('/admin/redirects/bulk-delete')
      .set(...auth(organizerToken))
      .send({ ids: [...remaining.body.redirects.map((r) => r.id), 'nope'] });
    expect(bulk.body).toEqual({ deleted: 1 });
    expect(
      (
        await request(app)
          .get('/admin/redirects')
          .set(...auth(organizerToken))
      ).body.total
    ).toBe(0);
  });
});
