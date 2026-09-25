// Integration test for cancelling a ticketed event (EVE-13).
//
// Before this change, cancelling a TICKETED event told nobody and left every
// ticket VALID, so it still opened the door. This asserts the three things a
// cancellation must now do:
//   1. every live ticket holder is emailed (RSVP guests keep their own copy)
//   2. every VALID ticket is VOIDED — a REDEEMED one keeps its attendance record
//   3. the door refuses a ticket for a CANCELLED event, including one minted
//      by a webhook that landed after the cancellation
//
// Refunds are deliberately NOT covered: no refund runs on cancellation yet
// (blocked on who owes it), and the email copy must not promise one.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const NS = 'evecancel';
const ORGANIZER_EMAIL = `organizer@${NS}.test`;
const ADMIN_EMAIL = `admin@${NS}.test`;

// Capture cancellation emails instead of calling Resend.
const sendCancellationNotification = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../src/services/EmailService.js', () => ({
  default: {
    sendCancellationNotification,
    sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
    sendTicketEmail: jest.fn().mockResolvedValue(undefined),
    sendRsvpConfirmation: jest.fn().mockResolvedValue(undefined),
    sendRsvpReminder: jest.fn().mockResolvedValue(undefined),
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('Cancelling an event (EVE-13)', () => {
  let organizerToken;
  let adminToken;
  let orgId;
  let venueId;
  let seq = 0;

  const barcode = () => `JUMP-${NS.toUpperCase()}${String(++seq).padStart(6, '0')}`;

  beforeAll(async () => {
    adminToken = await staffToken({ email: ADMIN_EMAIL, role: 'ADMIN' });
    organizerToken = await staffToken({ email: ORGANIZER_EMAIL, role: 'ORGANIZER' });

    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'EVE-13 Cancellation Org' });
    orgId = orgRes.body.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');
    await joinOrgByToken(organizerToken, orgId, 'ORGANIZER');

    const venueRes = await request(app)
      .post(`/organizations/${orgId}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'EVE-13 Hall',
        address: '1 Cancel Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
      });
    expect(venueRes.status).toBe(201);
    venueId = venueRes.body.id;
  });

  afterAll(async () => {
    const events = await prisma.event.findMany({ where: { venueId }, select: { id: true } });
    const eventIds = events.map((e) => e.id);
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventRsvp.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await cleanupStaff([ORGANIZER_EMAIL, ADMIN_EMAIL]);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sendCancellationNotification.mockClear();
  });

  /** A published event with one tier. */
  async function publishedEvent(name, { admissionMode = 'TICKETED' } = {}) {
    const body = {
      venueId,
      name,
      date: '2027-11-05T19:00:00.000Z',
      capacity: 100,
      admissionMode,
    };
    if (admissionMode === 'TICKETED') {
      body.priceTiers = [{ name: 'GA', price: 25.0, quantityTotal: 100 }];
    }
    const createRes = await request(app)
      .post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send(body);
    expect(createRes.status).toBe(201);

    const publishRes = await request(app)
      .post(`/organizations/${orgId}/events/${createRes.body.id}/publish`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(publishRes.status).toBe(200);

    return createRes.body.id;
  }

  /** A paid order with `count` tickets for one buyer. */
  async function soldOrder(eventId, email, count = 1) {
    const tier = await prisma.priceTier.findFirstOrThrow({ where: { eventId } });
    const contact = await prisma.contact.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      update: {},
      create: { organizationId: orgId, email, firstName: 'Buyer', lastName: email.split('@')[0] },
    });
    const order = await prisma.order.create({
      data: {
        eventId,
        contactId: contact.id,
        orderRef: `${NS.toUpperCase()}-${++seq}-${Date.now()}`,
        totalAmount: 25.0 * count,
        subtotalAmount: 25.0 * count,
        quantity: count,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    const tickets = [];
    for (let i = 0; i < count; i++) {
      tickets.push(
        await prisma.ticket.create({
          data: {
            orderId: order.id,
            eventId,
            priceTierId: tier.id,
            contactId: contact.id,
            ticketNumber: ++seq,
            pricePaid: 25.0,
            barcode: barcode(),
          },
        })
      );
    }
    return { contact, order, tickets };
  }

  const cancel = (eventId) =>
    request(app)
      .post(`/organizations/${orgId}/events/${eventId}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);

  it('emails every ticket holder once and voids their VALID tickets', async () => {
    const eventId = await publishedEvent('EVE-13 Ticketed Cancel');
    const alice = await soldOrder(eventId, `alice@${NS}.test`, 2); // two tickets, one email
    const bob = await soldOrder(eventId, `bob@${NS}.test`, 1);

    const res = await cancel(eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    // 1 — notified, deduplicated by contact inside EmailService
    expect(sendCancellationNotification).toHaveBeenCalledTimes(1);
    const [notifiedEvent, notified] = sendCancellationNotification.mock.calls[0];
    expect(notifiedEvent.id).toBe(eventId);
    expect(notified).toHaveLength(3);
    expect(new Set(notified.map((t) => t.contact.email))).toEqual(
      new Set([alice.contact.email, bob.contact.email])
    );

    // 2 — every ticket voided
    const statuses = await prisma.ticket.findMany({
      where: { eventId },
      select: { status: true },
    });
    expect(statuses).toHaveLength(3);
    expect(statuses.every((t) => t.status === 'VOIDED')).toBe(true);
  });

  it('notifies a redeemed ticket holder but leaves the attendance record intact', async () => {
    const eventId = await publishedEvent('EVE-13 Redeemed At Cancel');
    const { tickets } = await soldOrder(eventId, `already-in@${NS}.test`, 1);
    const redeemedAt = new Date();
    await prisma.ticket.update({
      where: { id: tickets[0].id },
      data: { status: 'REDEEMED', redeemedAt },
    });

    expect((await cancel(eventId)).status).toBe(200);

    const [, notified] = sendCancellationNotification.mock.calls[0];
    expect(notified.map((t) => t.id)).toEqual([tickets[0].id]);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(after.status).toBe('REDEEMED');
    expect(after.redeemedAt).toEqual(redeemedAt);
  });

  it('is refused the second time, so nobody is notified twice', async () => {
    const eventId = await publishedEvent('EVE-13 Double Cancel');
    await soldOrder(eventId, `once@${NS}.test`, 1);

    expect((await cancel(eventId)).status).toBe(200);
    expect(sendCancellationNotification).toHaveBeenCalledTimes(1);

    const second = await cancel(eventId);
    expect(second.status).toBe(409);
    expect(sendCancellationNotification).toHaveBeenCalledTimes(1);
  });

  it('refuses a ticket to a cancelled event at the door', async () => {
    const eventId = await publishedEvent('EVE-13 Door Voided');
    const { tickets } = await soldOrder(eventId, `door-void@${NS}.test`, 1);
    await cancel(eventId);

    const res = await request(app)
      .post('/tickets/redeem')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ barcode: tickets[0].barcode });

    expect(res.status).toBe(409);
    // The event check runs first: "this event was cancelled" is a more useful
    // answer at the door than "this ticket was voided".
    expect(res.body.status).toBe('EVENT_CANCELLED');

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(after.status).toBe('VOIDED');
  });

  it('refuses a VALID ticket minted for a cancelled event after the fact', async () => {
    // The real failure mode: a Stripe webhook for a checkout that was already
    // in flight lands after the organizer cancelled, and mints VALID tickets.
    const eventId = await publishedEvent('EVE-13 Door Late Webhook');
    await cancel(eventId);
    const { tickets } = await soldOrder(eventId, `late@${NS}.test`, 1);
    expect(tickets[0].status).toBe('VALID');

    const jumpPayload = `jump://ticket?id=${tickets[0].id}&b=${tickets[0].barcode}&e=${eventId}`;
    const scan = await request(app)
      .post('/tickets/scan')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ payload: jumpPayload });
    expect(scan.status).toBe(409);
    expect(scan.body.status).toBe('EVENT_CANCELLED');

    const redeem = await request(app)
      .post('/tickets/redeem')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ barcode: tickets[0].barcode });
    expect(redeem.status).toBe(409);
    expect(redeem.body.status).toBe('EVENT_CANCELLED');

    const checkIn = await request(app)
      .post(`/admin/tickets/${tickets[0].id}/check-in`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Org', orgId);
    expect(checkIn.status).toBe(409);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } });
    expect(after.status).toBe('VALID'); // never redeemed
  });

  it('still cancels and notifies RSVPs on an RSVP event', async () => {
    const eventId = await publishedEvent('EVE-13 Rsvp Cancel', { admissionMode: 'RSVP' });
    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        email: `rsvp@${NS}.test`,
        firstName: 'Rsvp',
        lastName: 'Guest',
      },
    });
    await prisma.eventRsvp.create({ data: { eventId, contactId: contact.id, partySize: 2 } });

    expect((await cancel(eventId)).status).toBe(200);

    expect(sendCancellationNotification).toHaveBeenCalledTimes(1);
    const [, notified] = sendCancellationNotification.mock.calls[0];
    expect(notified.map((r) => r.contact.email)).toEqual([contact.email]);

    const rsvp = await prisma.eventRsvp.findFirstOrThrow({ where: { eventId } });
    expect(rsvp.status).toBe('CANCELLED');
    expect(rsvp.cancelledAt).not.toBeNull();
  });
});
