// Contract tests for the admin Event Details aggregate (spec 037 phase 1).
// GET /organizations/:orgId/events/:eventId/overview — one request for the
// read-only event page: money, tickets, add-ons, application forms, map.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = `evt-overview-${Date.now()}`;
const STAFF_EMAIL = `${TAG}-organizer@test.local`;
const OUTSIDER_EMAIL = `${TAG}-outsider@test.local`;

describe('Event overview API', () => {
  let organization;
  let otherOrganization;
  let venue;
  let event;
  let rsvpEvent;
  let tier;
  let form;
  let appTier;
  let map;
  let organizerToken;
  let outsiderToken;

  beforeAll(async () => {
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    organizerToken = await staffToken({ email: STAFF_EMAIL, role: 'ORGANIZER' });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    outsiderToken = await staffToken({ email: OUTSIDER_EMAIL, role: 'ORGANIZER' });
    await joinOrgByToken(outsiderToken, otherOrganization.id, 'ORGANIZER');

    venue = await prisma.venue.create({
      data: { organizationId: organization.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 100 },
    });
    tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 50, quantitySold: 3 },
    });
    rsvpEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Meetup`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 0, admissionMode: 'RSVP', rsvpLimit: 10 },
    });

    const buyer = await prisma.contact.create({
      data: { organizationId: organization.id, email: `buyer@${TAG}.test`, firstName: 'Buyer', lastName: 'One' },
    });
    const order = await prisma.order.create({
      data: {
        eventId: event.id, contactId: buyer.id, orderRef: `${TAG}-1`, totalAmount: 66, subtotalAmount: 60,
        orgReceives: 60, quantity: 3, status: 'COMPLETED',
      },
    });
    // A pending checkout is not money collected.
    await prisma.order.create({
      data: { eventId: event.id, contactId: buyer.id, orderRef: `${TAG}-2`, totalAmount: 22, quantity: 1, status: 'PENDING' },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.ticket.create({
        data: {
          orderId: order.id, eventId: event.id, priceTierId: tier.id, contactId: buyer.id, pricePaid: 20,
          ticketNumber: 900000 + i, barcode: `${TAG}-${i}`, status: i === 0 ? 'REDEEMED' : 'VALID',
        },
      });
    }
    await prisma.refund.create({ data: { orderId: order.id, amount: 10, status: 'SUCCEEDED' } });

    form = await prisma.applicationForm.create({
      data: { eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-vendors`, status: 'OPEN' },
    });
    appTier = await prisma.applicationTier.create({
      data: { formId: form.id, name: '10x10', price: 100, quantityTotal: 4, quantityApproved: 1 },
    });
    const states = ['SUBMITTED', 'SUBMITTED', 'APPROVED', 'APPROVED', 'DRAFT'];
    for (let i = 0; i < states.length; i += 1) {
      const contact = await prisma.contact.create({
        data: { organizationId: organization.id, email: `vendor-${i}@${TAG}.test`, firstName: 'Vendor', lastName: 'V' },
      });
      const profile = await prisma.applicantProfile.create({
        data: { organizationId: organization.id, contactId: contact.id, businessName: `${TAG} Vendor ${i}` },
      });
      await prisma.application.create({
        data: {
          eventId: event.id, organizationId: organization.id, formId: form.id, tierId: appTier.id,
          contactId: contact.id, profileId: profile.id, status: states[i],
          paymentStatus: i === 2 ? 'PAID' : i === 3 ? 'PAYMENT_DUE' : 'CARD_ON_FILE',
          statusTokenHash: `${TAG}-hash-${i}`,
        },
      });
    }

    map = await prisma.floorMap.create({
      data: { organizationId: organization.id, eventId: event.id, name: 'Hall A', status: 'PUBLISHED', width: 50, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() },
    });
    await prisma.booth.createMany({
      data: [
        { mapId: map.id, label: 'A1', x: 0, y: 0, w: 8, h: 8, tierId: appTier.id, status: 'SOLD' },
        { mapId: map.id, label: 'A2', x: 10, y: 0, w: 8, h: 8, tierId: appTier.id },
        { mapId: map.id, label: 'A3', x: 20, y: 0, w: 8, h: 8 },
      ],
    });

    const guest = await prisma.contact.create({
      data: { organizationId: organization.id, email: `guest@${TAG}.test`, firstName: 'Guest', lastName: 'G' },
    });
    await prisma.eventRsvp.create({ data: { eventId: rsvpEvent.id, contactId: guest.id, partySize: 3 } });
  });

  afterAll(async () => {
    await prisma.booth.deleteMany({ where: { mapId: map.id } });
    await prisma.floorMap.deleteMany({ where: { id: map.id } });
    await prisma.eventRsvp.deleteMany({ where: { eventId: rsvpEvent.id } });
    await prisma.refund.deleteMany({ where: { order: { eventId: event.id } } });
    await prisma.ticket.deleteMany({ where: { eventId: event.id } });
    await prisma.order.deleteMany({ where: { eventId: event.id } });
    await prisma.application.deleteMany({ where: { eventId: event.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } });
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } });
    await prisma.priceTier.deleteMany({ where: { eventId: event.id } });
    await prisma.event.deleteMany({ where: { id: { in: [event.id, rsvpEvent.id] } } });
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } });
    await cleanupStaff([STAFF_EMAIL, OUTSIDER_EMAIL]);
  });

  const get = (eventId, token = organizerToken, orgId = organization.id) =>
    request(app).get(`/organizations/${orgId}/events/${eventId}/overview`).set('Authorization', `Bearer ${token}`);

  it('requires auth', async () => {
    const res = await request(app).get(`/organizations/${organization.id}/events/${event.id}/overview`);
    expect(res.status).toBe(401);
  });

  it('refuses a member of another organization', async () => {
    expect((await get(event.id, outsiderToken)).status).toBe(403);
  });

  it('404s an event of another organization', async () => {
    await joinOrgByToken(organizerToken, otherOrganization.id, 'ORGANIZER');
    const res = await get(event.id, organizerToken, otherOrganization.id);
    expect(res.status).toBe(404);
  });

  it('returns the event with its venue zone, money, tickets, forms and map', async () => {
    const res = await get(event.id);
    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.event).toMatchObject({ id: event.id, admissionMode: 'TICKETED' });
    expect(body.event.venue.timezone).toBe('America/New_York');
    expect(body.event.priceTiers).toHaveLength(1);

    // Only the COMPLETED order counts; the refund comes off net.
    expect(body.money).toMatchObject({ gross: 66, orgReceives: 60, refunded: 10, net: 56 });
    expect(body.money.tickets).toEqual({ orders: 1, gross: 66 });
    expect(body.tickets).toEqual({ issued: 3, checkedIn: 1, voided: 0 });
    expect(body.rsvp).toBeNull();

    expect(body.applications.forms).toHaveLength(1);
    const f = body.applications.forms[0];
    // DRAFT applications are never counted.
    expect(f.counts).toMatchObject({ SUBMITTED: 2, APPROVED: 2, WAITLISTED: 0 });
    expect(f.total).toBe(4);
    expect(f.approvedSettled).toBe(1);
    expect(f.approvedAwaitingPayment).toBe(1);
    expect(f.paid).toBe(true);
    expect(f.tiers[0]).toMatchObject({ name: '10x10', price: 100, quantityTotal: 4, booths: 2 });

    expect(body.map).toMatchObject({ id: map.id, status: 'PUBLISHED', boothTotal: 3, unassignedBooths: 1 });
    expect(body.map.booths).toMatchObject({ SOLD: 1, AVAILABLE: 2 });
  });

  it('reports RSVPs instead of tickets for an RSVP event', async () => {
    const res = await get(rsvpEvent.id);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toBeNull();
    expect(res.body.rsvp).toEqual({ going: 1, headcount: 3, cancelled: 0, remaining: 7 });
    expect(res.body.event.rsvpRemaining).toBe(7);
    expect(res.body.map).toBeNull();
    expect(res.body.applications.forms).toEqual([]);
  });

  it('returns the workspace header facts', async () => {
    const res = await request(app)
      .get(`/organizations/${organization.id}/events/${event.id}/workspace`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: event.id,
      admissionMode: 'TICKETED',
      mapId: map.id,
      formCount: 1,
      toReview: 2,
      venue: { timezone: 'America/New_York' },
    });
    const outsider = await request(app)
      .get(`/organizations/${organization.id}/events/${event.id}/workspace`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(outsider.status).toBe(403);
  });
});
