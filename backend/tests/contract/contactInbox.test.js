// Contract tests for the contact-message inbox (spec 042): list, filter,
// search, read state, delete, organization isolation.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'contact-inbox-ct';
const emails = [`organizer@${TAG}.test`, `admin@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Contact inbox contract (spec 042)', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let adminToken;
  let otherToken;
  let page;
  let older;
  let newer;
  let theirs;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    adminToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    otherToken = await staffToken({ email: emails[2], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
    page = await prisma.page.create({
      data: { organizationId: organization.id, title: 'Contact', slug: 'contact', content: '<p>x</p>' },
    });
    older = await prisma.contactInquiry.create({
      data: {
        organizationId: organization.id,
        pageId: page.id,
        name: 'Ada',
        email: 'ada@example.com',
        subject: 'Booths',
        message: 'Power at the booths?',
        emailedAt: new Date(),
        createdAt: new Date('2026-10-01T10:00:00Z'),
      },
    });
    newer = await prisma.contactInquiry.create({
      data: {
        organizationId: organization.id,
        name: 'Grace',
        email: 'grace@example.com',
        message: 'Parking?',
        emailError: 'refused',
        createdAt: new Date('2026-10-01T11:00:00Z'),
      },
    });
    theirs = await prisma.contactInquiry.create({
      data: { organizationId: otherOrganization.id, name: 'X', email: 'x@example.com', message: 'Other org' },
    });
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('lists messages newest first with page titles and the unread count', async () => {
    const res = await request(app).get('/admin/contact-inquiries').set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.inquiries.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.inquiries[1]).toMatchObject({
      name: 'Ada',
      page: { id: page.id, title: 'Contact' },
      readAt: null,
    });
    expect(res.body.inquiries[0]).toMatchObject({ page: null, emailError: 'refused' });
    expect(res.body.pagination).toMatchObject({ page: 1, total: 2, totalPages: 1 });
  });

  it('searches and keeps other organizations out', async () => {
    const res = await request(app).get('/admin/contact-inquiries?q=parking').set(...auth(organizerToken));
    expect(res.body.inquiries.map((i) => i.id)).toEqual([newer.id]);
    const other = await request(app).get('/admin/contact-inquiries').set(...auth(otherToken));
    expect(other.body.inquiries.map((i) => i.id)).toEqual([theirs.id]);
    const cross = await request(app)
      .patch(`/admin/contact-inquiries/${theirs.id}`)
      .set(...auth(organizerToken))
      .send({ read: true });
    expect(cross.status).toBe(404);
  });

  it('marks messages read and unread, and filters unread', async () => {
    const read = await request(app)
      .patch(`/admin/contact-inquiries/${older.id}`)
      .set(...auth(organizerToken))
      .send({ read: true });
    expect(read.status).toBe(200);
    expect(read.body.readAt).toEqual(expect.any(String));

    const unread = await request(app).get('/admin/contact-inquiries?status=unread').set(...auth(organizerToken));
    expect(unread.body.inquiries.map((i) => i.id)).toEqual([newer.id]);
    expect(unread.body.unreadCount).toBe(1);
    const badge = await request(app).get('/admin/contact-inquiries/unread-count').set(...auth(organizerToken));
    expect(badge.body).toEqual({ unreadCount: 1 });

    const again = await request(app)
      .patch(`/admin/contact-inquiries/${older.id}`)
      .set(...auth(organizerToken))
      .send({ read: false });
    expect(again.body.readAt).toBeNull();

    const bad = await request(app)
      .patch(`/admin/contact-inquiries/${older.id}`)
      .set(...auth(organizerToken))
      .send({ read: 'yes' });
    expect(bad.status).toBe(400);
  });

  it('lets only ADMIN delete', async () => {
    const denied = await request(app).delete(`/admin/contact-inquiries/${newer.id}`).set(...auth(organizerToken));
    expect(denied.status).toBe(403);
    const ok = await request(app).delete(`/admin/contact-inquiries/${newer.id}`).set(...auth(adminToken));
    expect(ok.status).toBe(204);
    expect(await prisma.contactInquiry.findUnique({ where: { id: newer.id } })).toBeNull();
  });
});
