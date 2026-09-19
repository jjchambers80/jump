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
      content: '<p>Our story</p>',
      isVisible: false,
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
