// Contract tests for organization-scoped Online Store pages.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'pages-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`, `unassigned@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Online Store pages contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let unassignedToken;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});

    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    unassignedToken = await staffToken({ email: emails[2], role: 'UNASSIGNED' });

    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other Store` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({
        where: { id: { in: [organization.id, otherOrganization.id] } },
      })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('returns an explicit empty pages collection', async () => {
    const response = await request(app)
      .get('/admin/pages')
      .set(...auth(organizerToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pages: [] });
  });

  it('creates a page and lists it only for the active organization', async () => {
    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'About us', content: '<p>Our story</p>', isVisible: false });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      organizationId: organization.id,
      title: 'About us',
      slug: 'about-us',
      content: '<p>Our story</p>',
      isVisible: false,
      seoTitle: null,
      seoDescription: null,
    });
    expect(created.body.id).toEqual(expect.any(String));
    expect(created.body.createdAt).toEqual(expect.any(String));
    expect(created.body.updatedAt).toEqual(expect.any(String));

    const mine = await request(app)
      .get('/admin/pages')
      .set(...auth(organizerToken));
    expect(mine.status).toBe(200);
    expect(mine.body.pages).toEqual([
      expect.objectContaining({ id: created.body.id, title: 'About us' }),
    ]);

    const theirs = await request(app)
      .get('/admin/pages')
      .set(...auth(otherToken));
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual({ pages: [] });
  });

  it('defaults visibility to visible', async () => {
    const response = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'Contact', content: '<p>Email us</p>' });

    expect(response.status).toBe(201);
    expect(response.body.isVisible).toBe(true);
  });

  it.each([
    [{ content: 'Missing title' }, 'title'],
    [{ title: 'Missing content' }, 'content'],
    [{ title: ' ', content: 'Body' }, 'title'],
    [{ title: 'Page', content: 'Body', isVisible: 'yes' }, 'isVisible'],
  ])('rejects invalid page input %#', async (body, field) => {
    const response = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })])
    );
  });

  it('stores the search engine listing and keeps handles unique per organization', async () => {
    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({
        title: 'FAQ',
        content: '<p>Answers</p>',
        slug: 'About Us',
        seoTitle: 'Frequently asked questions',
        seoDescription: 'Everything you need to know.',
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      slug: 'about-us-2',
      seoTitle: 'Frequently asked questions',
      seoDescription: 'Everything you need to know.',
    });

    // The same handle is free in another organization.
    const theirs = await request(app)
      .post('/admin/pages')
      .set(...auth(otherToken))
      .send({ title: 'About us', content: '<p>Them</p>' });
    expect(theirs.status).toBe(201);
    expect(theirs.body.slug).toBe('about-us');
  });

  it('gets and updates a page only within the active organization', async () => {
    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'Policies', content: '<p>Rules</p>' });
    expect(created.status).toBe(201);

    const fetched = await request(app)
      .get(`/admin/pages/${created.body.id}`)
      .set(...auth(organizerToken));
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      id: created.body.id,
      title: 'Policies',
      slug: 'policies',
    });

    const updated = await request(app)
      .put(`/admin/pages/${created.body.id}`)
      .set(...auth(organizerToken))
      .send({ title: 'Refund policy', isVisible: false, seoTitle: 'Refunds', slug: '' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: created.body.id,
      title: 'Refund policy',
      slug: 'refund-policy',
      content: '<p>Rules</p>',
      isVisible: false,
      seoTitle: 'Refunds',
    });

    const custom = await request(app)
      .put(`/admin/pages/${created.body.id}`)
      .set(...auth(organizerToken))
      .send({ slug: 'refunds', seoTitle: null });
    expect(custom.status).toBe(200);
    expect(custom.body).toMatchObject({ slug: 'refunds', seoTitle: null, title: 'Refund policy' });

    const invalid = await request(app)
      .put(`/admin/pages/${created.body.id}`)
      .set(...auth(organizerToken))
      .send({ seoDescription: 'x'.repeat(161) });
    expect(invalid.status).toBe(400);
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'seoDescription' })])
    );

    // Another organization cannot see or change it.
    expect(
      (
        await request(app)
          .get(`/admin/pages/${created.body.id}`)
          .set(...auth(otherToken))
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .put(`/admin/pages/${created.body.id}`)
          .set(...auth(otherToken))
          .send({ title: 'Hijacked' })
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/admin/pages/${created.body.id}`)
          .set(...auth(unassignedToken))
      ).status
    ).toBe(403);
  });

  it('requires authenticated administration access', async () => {
    expect((await request(app).get('/admin/pages')).status).toBe(401);
    expect(
      (await request(app).post('/admin/pages').send({ title: 'No', content: 'No' })).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/admin/pages')
          .set(...auth(unassignedToken))
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/admin/pages')
          .set(...auth(unassignedToken))
          .send({ title: 'No', content: 'No' })
      ).status
    ).toBe(403);
  });
});
