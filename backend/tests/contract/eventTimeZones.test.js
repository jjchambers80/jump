// Spec 033 phase 1: every payload that carries an event date also carries the
// venue's IANA zone, so the client can render the show's wall clock instead of
// the viewer's. Before this, `Venue.timezone` was stored and validated but no
// payload outside event detail shipped it and nothing formatted with it.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

const DENVER = 'America/Denver';

describe('Event time zones contract (spec 033 phase 1)', () => {
  let adminToken;
  let orgId;
  let venueId;
  let eventId;
  let eventSlug;
  let tierId;
  let orderId;
  let ticketId;

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: 'admin@event-timezones.test' });

    const org = await prisma.organization.create({
      data: { name: 'Event Time Zones Org', status: 'ACTIVE' },
    });
    orgId = org.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');

    const venue = await prisma.venue.create({
      data: {
        organizationId: orgId,
        name: 'Mountain Time Hall',
        address: '1510 Clarkson St',
        city: 'Denver',
        state: 'CO',
        postalCode: '80218',
        timezone: DENVER,
        isPublic: true,
      },
    });
    venueId = venue.id;

    // 2026-11-09T03:00Z is 8:00 PM MST on 2026-11-08 at the venue, and
    // 10:00 PM EST the same evening for an Eastern viewer — the whole point.
    const event = await prisma.event.create({
      data: {
        venueId,
        name: 'Mountain Evening Show',
        date: new Date('2026-11-09T03:00:00.000Z'),
        capacity: 100,
        status: 'PUBLISHED',
        priceTiers: {
          create: [{ name: 'General', price: 20, quantityTotal: 50, displayOrder: 0, isActive: true }],
        },
      },
      include: { priceTiers: true },
    });
    eventId = event.id;
    eventSlug = event.slug;
    tierId = event.priceTiers[0].id;

    const contact = await prisma.contact.create({
      data: { organizationId: orgId, email: 'buyer@event-timezones.test', firstName: 'Tess', lastName: 'Zone' },
    });
    const order = await prisma.order.create({
      data: {
        eventId,
        contactId: contact.id,
        kind: 'TICKET',
        orderRef: 'JMP-TZ0001',
        quantity: 1,
        subtotalAmount: 20,
        platformFeeAmount: 0,
        processingFeeAmount: 0,
        taxAmount: 0,
        totalAmount: 20,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    orderId = order.id;
    const ticket = await prisma.ticket.create({
      data: {
        eventId,
        orderId,
        contactId: contact.id,
        priceTierId: tierId,
        ticketNumber: 1,
        barcode: 'TZBARCODE0001',
        pricePaid: 20,
        status: 'VALID',
      },
    });
    ticketId = ticket.id;
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.priceTier.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { venueId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('public event detail carries the venue zone', async () => {
    const res = await request(app).get(`/events/${eventSlug}`).expect(200);
    expect(res.body.venue.timezone).toBe(DENVER);
    // Drive-by from the same change: the venue literal used to set `slug` twice.
    expect(res.body.venue.slug).toBeTruthy();
  });

  it('the public event list carries it too, not just the detail payload', async () => {
    const res = await request(app).get('/events?limit=100').expect(200);
    const row = res.body.events.find((e) => e.id === eventId);
    expect(row).toBeDefined();
    expect(row.venue.timezone).toBe(DENVER);
  });

  it('the org event list carries it', async () => {
    const res = await request(app)
      .get(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .expect(200);
    const row = res.body.events.find((e) => e.id === eventId);
    expect(row.venue.timezone).toBe(DENVER);
  });

  it('order detail carries it on the event venue', async () => {
    const res = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .expect(200);
    expect(res.body.event.venue.timezone).toBe(DENVER);
  });

  it('the org-wide order list carries it as a flat eventTimezone', async () => {
    const res = await request(app)
      .get('/admin/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .expect(200);
    const row = res.body.data.find((o) => o.id === orderId);
    expect(row).toBeDefined();
    expect(row.eventTimezone).toBe(DENVER);
  });

  it('the admin ticket detail carries it on the nested event', async () => {
    const res = await request(app)
      .get(`/admin/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .expect(200);
    const ticket = res.body.ticket ?? res.body;
    expect(ticket.event.timezone).toBe(DENVER);
  });

  it('a venue with no explicit zone still reports the schema default, never null', async () => {
    const res = await request(app)
      .post(`/organizations/${orgId}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .send({ name: 'Defaulted Venue', address: '1 Default Way' })
      .expect(201);
    expect(res.body.timezone).toBe('America/New_York');
    await prisma.venue.delete({ where: { id: res.body.id } });
  });
});
