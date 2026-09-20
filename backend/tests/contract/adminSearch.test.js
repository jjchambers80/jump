// Contract tests for the administration header search (spec 029).

import request from 'supertest';
import { createHash } from 'node:crypto';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const RUN = `${process.pid}-${Date.now()}`;
const TAG = `admin-search-ct-${RUN}`;
const TERM = `Needle${process.pid}`;
const emails = [
  `admin@${TAG}.test`,
  `organizer@${TAG}.test`,
  `sysadmin@${TAG}.test`,
  `memberless@${TAG}.test`,
  `unassigned@${TAG}.test`,
];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (value) => createHash('sha256').update(value).digest('hex');

function search(token, q = TERM) {
  const req = request(app).get(`/admin/search?q=${encodeURIComponent(q)}`);
  return token ? req.set(...auth(token)) : req;
}

describe('Administration search contract', () => {
  let organization;
  let otherOrganization;
  let venue;
  let event;
  let contact;
  let order;
  let file;
  let adminToken;
  let organizerToken;
  let sysAdminToken;
  let memberlessToken;
  let unassignedToken;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});

    [adminToken, organizerToken, sysAdminToken, memberlessToken, unassignedToken] =
      await Promise.all([
        staffToken({ email: emails[0], role: 'ADMIN' }),
        staffToken({ email: emails[1], role: 'ORGANIZER' }),
        staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' }),
        staffToken({ email: emails[3], role: 'ORGANIZER' }),
        staffToken({ email: emails[4], role: 'UNASSIGNED' }),
      ]);

    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');

    venue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: `${TERM} Hall`,
        address: '1 Main Street',
      },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TERM} Festival`,
        date: new Date('2027-06-21T18:00:00.000Z'),
        capacity: 100,
        status: 'PUBLISHED',
      },
    });
    const tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'General', price: 20, quantityTotal: 100 },
    });
    contact = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        email: `needle-buyer@${TAG}.test`,
        firstName: TERM,
        lastName: 'Buyer',
      },
    });
    order = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: 'NEEDLE-ORDER-001',
        stripeSessionId: `cs_${TAG}_needle`,
        totalAmount: 20,
        subtotalAmount: 20,
        orgReceives: 20,
        quantity: 1,
        status: 'COMPLETED',
        paidAt: new Date('2027-06-01T12:00:00.000Z'),
        payment: {
          create: {
            stripePaymentIntentId: `pi_${TAG}_needle`,
            amount: 20,
            status: 'SUCCEEDED',
          },
        },
      },
    });
    await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        priceTierId: tier.id,
        contactId: contact.id,
        ticketNumber: 1,
        pricePaid: 20,
        barcode: 'JUMP-NEEDLE-001',
      },
    });

    const form = await prisma.applicationForm.create({
      data: {
        eventId: event.id,
        kind: 'FREE',
        name: 'Vendors',
        slug: 'vendors',
        status: 'OPEN',
      },
    });
    const profile = await prisma.applicantProfile.create({
      data: {
        organizationId: organization.id,
        contactId: contact.id,
        businessName: `${TERM} Studio`,
      },
    });
    await prisma.application.createMany({
      data: [
        {
          formId: form.id,
          eventId: event.id,
          organizationId: organization.id,
          contactId: contact.id,
          profileId: profile.id,
          status: 'SUBMITTED',
          statusTokenHash: sha(`${TAG}-submitted`),
          submittedAt: new Date('2027-05-01T12:00:00.000Z'),
        },
        {
          formId: form.id,
          eventId: event.id,
          organizationId: organization.id,
          contactId: contact.id,
          profileId: profile.id,
          status: 'DRAFT',
          statusTokenHash: sha(`${TAG}-draft`),
        },
      ],
    });

    await prisma.page.create({
      data: {
        organizationId: organization.id,
        title: `${TERM} FAQ`,
        slug: 'needle-faq',
        content: '<p>Answers</p>',
      },
    });
    const blog = await prisma.blog.create({
      data: { organizationId: organization.id, title: 'News', handle: 'news' },
    });
    await prisma.blogPost.create({
      data: {
        organizationId: organization.id,
        blogId: blog.id,
        title: `${TERM} announcement`,
        handle: 'needle-announcement',
        content: '<p>News</p>',
        authorName: 'Admin',
      },
    });
    file = await prisma.file.upsert({
      where: { hash: sha(`${TAG}-file`) },
      update: {},
      create: {
        hash: sha(`${TAG}-file`),
        mimeType: 'application/pdf',
        sizeBytes: 10,
        originalName: 'needle-guide.pdf',
      },
    });
    await prisma.storeFile.create({
      data: {
        organizationId: organization.id,
        fileId: file.id,
        name: `${TERM} guide`,
        extension: 'pdf',
      },
    });

    const capVenue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: 'Capacity Test Hall',
        address: '3 Main Street',
      },
    });
    await prisma.event.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        venueId: capVenue.id,
        name: `CapMatch ${index + 1}`,
        date: new Date(`2027-08-${String(index + 1).padStart(2, '0')}T18:00:00.000Z`),
        capacity: 10,
      })),
    });

    const otherVenue = await prisma.venue.create({
      data: {
        organizationId: otherOrganization.id,
        name: `${TERM} Foreign Hall`,
        address: '2 Main Street',
      },
    });
    await prisma.event.create({
      data: {
        venueId: otherVenue.id,
        name: `${TERM} Foreign Festival`,
        date: new Date('2027-07-21T18:00:00.000Z'),
        capacity: 50,
      },
    });
  });

  afterAll(async () => {
    for (const org of [organization, otherOrganization].filter(Boolean)) {
      await prisma.ticket
        .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
        .catch(() => {});
      await prisma.paymentTransaction
        .deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } })
        .catch(() => {});
      await prisma.order
        .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
        .catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicantProfile
        .deleteMany({ where: { organizationId: org.id } })
        .catch(() => {});
      await prisma.applicationForm
        .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
        .catch(() => {});
      await prisma.priceTier
        .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
        .catch(() => {});
      await prisma.event
        .deleteMany({ where: { venue: { organizationId: org.id } } })
        .catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    }
    if (file) await prisma.file.deleteMany({ where: { id: file.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('requires a staff session and an organizer role', async () => {
    expect((await search(null)).status).toBe(401);
    expect((await search(unassignedToken)).status).toBe(403);
  });

  it.each([undefined, '', 'x', ' '.repeat(3), 'x'.repeat(201)])(
    'rejects a missing or out-of-range query %#',
    async (query) => {
      const response =
        query === undefined
          ? await request(app).get('/admin/search').set(...auth(adminToken))
          : await search(adminToken, query);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'ValidationError',
        message: 'Validation failed',
        details: [{ field: 'q', message: 'q must be 2–200 characters' }],
      });
    }
  );

  it('returns all resource types in fixed group order with navigable rows', async () => {
    const response = await search(adminToken, `  ${TERM.toLowerCase()}  `);
    expect(response.status).toBe(200);
    expect(response.body.query).toBe(TERM.toLowerCase());
    expect(response.body.total).toBe(9);
    expect(response.body.data.map((row) => row.type)).toEqual([
      'EVENT',
      'VENUE',
      'CUSTOMER',
      'ORDER',
      'TICKET',
      'APPLICATION',
      'PAGE',
      'BLOG_POST',
      'FILE',
    ]);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'EVENT',
          id: event.id,
          title: `${TERM} Festival`,
          href: `/admin/events/${event.id}/edit?orgId=${organization.id}`,
        }),
        expect.objectContaining({
          type: 'CUSTOMER',
          id: contact.id,
          href: `/admin/customers/${contact.id}`,
        }),
        expect.objectContaining({
          type: 'ORDER',
          id: order.id,
          href: `/admin/orders/${order.id}`,
        }),
      ])
    );
    expect(response.body.data.filter((row) => row.type === 'APPLICATION')).toHaveLength(1);
  });

  it('matches exact Stripe identifiers and returns a safe empty response for no matches', async () => {
    const stripe = await search(adminToken, `pi_${TAG}_needle`);
    expect(stripe.status).toBe(200);
    expect(stripe.body.data).toEqual([
      expect.objectContaining({ type: 'ORDER', id: order.id }),
    ]);

    const empty = await search(adminToken, 'nothing-can-match-this');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ query: 'nothing-can-match-this', total: 0, data: [] });
  });

  it('caps each resource group at the documented database limit', async () => {
    const response = await search(adminToken, 'CapMatch');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.data.every((row) => row.type === 'EVENT')).toBe(true);
  });

  it('scopes members, returns empty for memberless staff, and honors SYSTEM_ADMIN scope', async () => {
    const member = await search(organizerToken);
    expect(member.status).toBe(200);
    expect(member.body.data.some((row) => row.title.includes('Foreign'))).toBe(false);

    const memberless = await search(memberlessToken);
    expect(memberless.status).toBe(200);
    expect(memberless.body).toEqual({ query: TERM, total: 0, data: [] });

    const unscoped = await search(sysAdminToken);
    expect(unscoped.body.data.some((row) => row.title === `${TERM} Foreign Festival`)).toBe(true);

    const otherOnly = await request(app)
      .get(`/admin/search?q=${TERM}`)
      .set(...auth(sysAdminToken))
      .set('X-Jump-Org', otherOrganization.id);
    expect(otherOnly.status).toBe(200);
    expect(otherOnly.body.data.map((row) => row.title)).toEqual([
      `${TERM} Foreign Festival`,
      `${TERM} Foreign Hall`,
    ]);
  });
});
