import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({ default: {} }));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'customer-timeline-contract';
const emails = [
  `author@${TAG}.test`,
  `other@${TAG}.test`,
  `admin@${TAG}.test`,
  `foreign@${TAG}.test`,
];
const auth = (token) => ['Authorization', `Bearer ${token}`];

async function cleanupFixtureData(orgIds) {
  if (!orgIds.length) return;
  const orderWhere = { event: { venue: { organizationId: { in: orgIds } } } };
  await prisma.refund.deleteMany({ where: { order: orderWhere } }).catch(() => {});
  await prisma.paymentTransaction.deleteMany({ where: { order: orderWhere } }).catch(() => {});
  await prisma.order.deleteMany({ where: orderWhere }).catch(() => {});
  await prisma.contactComment
    .deleteMany({ where: { organizationId: { in: orgIds } } })
    .catch(() => {});
  await prisma.eventRsvp.deleteMany({
    where: { event: { venue: { organizationId: { in: orgIds } } } },
  });
  await prisma.contact.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
  await prisma.event
    .deleteMany({ where: { venue: { organizationId: { in: orgIds } } } })
    .catch(() => {});
  await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
}

async function fixture(name) {
  const organization = await prisma.organization.create({ data: { name: `${TAG} ${name}` } });
  const venue = await prisma.venue.create({
    data: { organizationId: organization.id, name: `${name} venue`, address: '1 Test St' },
  });
  const event = await prisma.event.create({
    data: { venueId: venue.id, name: `${name} event`, date: new Date('2027-01-01'), capacity: 10 },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId: organization.id,
      email: `${name.toLowerCase()}@${TAG}.test`,
      firstName: name,
      lastName: 'Buyer',
    },
  });
  const order = await prisma.order.create({
    data: {
      eventId: event.id,
      contactId: contact.id,
      orderRef: `${TAG}-${name}`,
      totalAmount: 10,
      subtotalAmount: 10,
      quantity: 1,
      status: 'COMPLETED',
      paidAt: new Date('2026-01-02T00:00:00Z'),
      payment: {
        create: { amount: 10, status: 'SUCCEEDED', createdAt: new Date('2026-01-02T00:00:00Z') },
      },
    },
  });
  return { organization, venue, event, contact, order };
}

describe('customer timeline and comments contract', () => {
  let own;
  let foreign;
  let authorToken;
  let otherToken;
  let adminToken;
  let foreignToken;
  let authorId;

  beforeAll(async () => {
    const old = await prisma.organization.findMany({
      where: { name: { startsWith: TAG } },
      select: { id: true },
    });
    await cleanupFixtureData(old.map(({ id }) => id));
    await cleanupStaff(emails);
    own = await fixture('Own');
    foreign = await fixture('Foreign');
    authorToken = await staffToken({ email: emails[0], role: 'ORGANIZER', name: 'Comment Author' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER', name: 'Other Organizer' });
    adminToken = await staffToken({ email: emails[2], role: 'ADMIN', name: 'Org Admin' });
    foreignToken = await staffToken({ email: emails[3], role: 'ADMIN', name: 'Foreign Admin' });
    authorId = jwt.decode(authorToken).sub;
    await Promise.all([
      joinOrgByToken(authorToken, own.organization.id, 'ORGANIZER'),
      joinOrgByToken(otherToken, own.organization.id, 'ORGANIZER'),
      joinOrgByToken(adminToken, own.organization.id, 'ADMIN'),
      joinOrgByToken(foreignToken, foreign.organization.id, 'ADMIN'),
    ]);
  });

  afterAll(async () => {
    const orgIds = [own?.organization.id, foreign?.organization.id].filter(Boolean);
    await cleanupFixtureData(orgIds);
    await cleanupStaff(emails);
  });

  it('creates a trimmed plain-text comment and returns it in the timeline', async () => {
    const created = await request(app)
      .post(`/admin/customers/${own.contact.id}/comments`)
      .set(...auth(authorToken))
      .send({ body: '  Called the buyer  ' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      contactId: own.contact.id,
      organizationId: own.organization.id,
      authorUserId: authorId,
      body: 'Called the buyer',
      kind: 'COMMENT',
    });
    await prisma.eventRsvp.create({
      data: {
        eventId: own.event.id,
        contactId: own.contact.id,
        partySize: 2,
        status: 'CANCELLED',
        cancelledAt: new Date('2026-01-04T00:00:00Z'),
      },
    });

    const timeline = await request(app)
      .get(`/admin/customers/${own.contact.id}/timeline`)
      .set(...auth(authorToken));
    expect(timeline.status).toBe(200);
    expect(timeline.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: created.body.id,
          type: 'COMMENT',
          body: 'Called the buyer',
        }),
        expect.objectContaining({ type: 'ORDER_PAID', orderId: own.order.id }),
        expect.objectContaining({
          type: 'RSVP_CREATED',
          partySize: 2,
          event: expect.objectContaining({ id: own.event.id }),
        }),
        expect.objectContaining({ type: 'RSVP_CANCELLED', partySize: 2 }),
      ])
    );
  });

  it.each([
    [{}, 400],
    [{ body: '   ' }, 400],
    [{ body: '<script>alert(1)</script>' }, 400],
    [{ body: 'x'.repeat(2001) }, 400],
    [{ body: 'ok', unexpected: true }, 400],
  ])('validates comment input %#', async (body, status) => {
    const response = await request(app)
      .post(`/admin/customers/${own.contact.id}/comments`)
      .set(...auth(authorToken))
      .send(body);
    expect(response.status).toBe(status);
  });

  it('records an email change as an attributed system event', async () => {
    const changed = `changed@${TAG}.test`;
    const update = await request(app)
      .patch(`/admin/customers/${own.contact.id}`)
      .set(...auth(adminToken))
      .send({ email: changed });
    expect(update.status).toBe(200);

    const timeline = await request(app)
      .get(`/admin/customers/${own.contact.id}/timeline`)
      .set(...auth(adminToken));
    expect(timeline.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'EMAIL_CHANGED',
          body: expect.stringContaining(changed),
          author: expect.objectContaining({ email: emails[2] }),
        }),
      ])
    );
  });

  it('allows only the author or an ADMIN to delete a comment', async () => {
    const first = await request(app)
      .post(`/admin/customers/${own.contact.id}/comments`)
      .set(...auth(authorToken))
      .send({ body: 'Ownership test' });

    const denied = await request(app)
      .delete(`/admin/customers/${own.contact.id}/comments/${first.body.id}`)
      .set(...auth(otherToken));
    expect(denied.status).toBe(403);

    const byAdmin = await request(app)
      .delete(`/admin/customers/${own.contact.id}/comments/${first.body.id}`)
      .set(...auth(adminToken));
    expect(byAdmin.status).toBe(204);

    const second = await request(app)
      .post(`/admin/customers/${own.contact.id}/comments`)
      .set(...auth(authorToken))
      .send({ body: 'Author deletion test' });
    const byAuthor = await request(app)
      .delete(`/admin/customers/${own.contact.id}/comments/${second.body.id}`)
      .set(...auth(authorToken));
    expect(byAuthor.status).toBe(204);
  });

  it('hides comments and timelines across organizations', async () => {
    const comment = await prisma.contactComment.create({
      data: {
        contactId: own.contact.id,
        organizationId: own.organization.id,
        authorUserId: authorId,
        body: 'Private',
      },
    });
    expect(
      (
        await request(app)
          .get(`/admin/customers/${own.contact.id}/timeline`)
          .set(...auth(foreignToken))
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/admin/customers/${own.contact.id}/comments/${comment.id}`)
          .set(...auth(foreignToken))
      ).status
    ).toBe(404);
  });

  it('uses an opaque cursor without duplicates', async () => {
    await prisma.contactComment.createMany({
      data: ['A', 'B', 'C'].map((body, index) => ({
        contactId: own.contact.id,
        organizationId: own.organization.id,
        authorUserId: authorId,
        body: `Page ${body}`,
        createdAt: new Date(`2026-02-0${index + 1}T00:00:00Z`),
      })),
    });
    const first = await request(app)
      .get(`/admin/customers/${own.contact.id}/timeline?limit=2`)
      .set(...auth(authorToken));
    const second = await request(app)
      .get(
        `/admin/customers/${own.contact.id}/timeline?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`
      )
      .set(...auth(authorToken));

    expect(first.status).toBe(200);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(new Set([...first.body.data, ...second.body.data].map(({ id }) => id)).size).toBe(4);
  });

  it('cascades comments when the contact is deleted', async () => {
    const doomed = await prisma.contact.create({
      data: {
        organizationId: own.organization.id,
        email: `doomed@${TAG}.test`,
        firstName: 'Doomed',
        lastName: 'Buyer',
      },
    });
    const comment = await prisma.contactComment.create({
      data: {
        contactId: doomed.id,
        organizationId: own.organization.id,
        authorUserId: authorId,
        body: 'Delete with contact',
      },
    });
    await prisma.contact.delete({ where: { id: doomed.id } });
    expect(await prisma.contactComment.findUnique({ where: { id: comment.id } })).toBeNull();
  });
});
