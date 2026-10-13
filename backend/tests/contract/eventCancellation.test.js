// Spec 054-A/B: cancelling a paid event stops the money. ADMIN + step-up only
// (refund-all also needs orders.refund); the cancellation records every paid
// order for the sweep, which emails each buyer once (MANUAL: no refund); open
// checkouts are expired and their holds released; a checkout paid after the
// cancel is refunded instead of issuing tickets and its buyer told; a
// cancelled event's tickets never scan; the public page stays up.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff, reauthHeader } from '../helpers/staff.js';

const sentEmails = [];
const stripeCalls = { expired: [], refunds: [] };
let lateSessionId = null;

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { data: { id: 'mock' }, error: null }; }) } },
}));

jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let counter = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn(async (params) => {
            counter++;
            return { id: `cs_cancel_${Date.now()}_${counter}`, url: 'https://checkout.stripe.com/pay/x', metadata: params.metadata };
          }),
          retrieve: jest.fn(async (id) => ({ id, metadata: {} })),
          // A session already paid cannot be expired: Stripe refuses it.
          expire: jest.fn(async (id) => {
            stripeCalls.expired.push(id);
            if (id === lateSessionId) throw new Error('Only Checkout Sessions with a status of open can be expired');
            return { id, status: 'expired' };
          }),
        },
      },
      refunds: {
        create: jest.fn(async (params, options) => {
          counter++;
          stripeCalls.refunds.push({ params, options });
          return { id: `re_cancel_${counter}`, amount: params.amount, status: 'succeeded' };
        }),
      },
      webhooks: { constructEvent: jest.fn() },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentService } = await import('../../src/services/PaymentService.js');
const { default: ticketService } = await import('../../src/services/TicketService.js');
const { default: eventCancellationService } = await import('../../src/services/EventCancellationService.js');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

const TAG = `evt-cancel-${Date.now()}`;
const contact = (n) => ({ email: `buyer${n}@${TAG}.test`, firstName: `Buyer${n}`, lastName: 'Test' });

describe('Cancelling a paid event (spec 054-A)', () => {
  let adminToken;
  let organizerToken;
  let org;
  let event;
  let tier;
  const orders = {};
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  const auth = (t) => ['Authorization', `Bearer ${t}`];
  const cancelPath = () => `/organizations/${org.id}/events/${event.id}/cancel`;

  const order = async (n) => {
    const res = await request(app).post('/orders').send({ eventId: event.id, items: [{ priceTierId: tier.id, quantity: 1 }], contact: contact(n) });
    expect(res.status).toBe(201);
    return prisma.order.findUnique({ where: { id: res.body.orderId } });
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T23:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 50 } });

    orders.paid = await order(1);
    await paymentService.handleCheckoutCompleted(orders.paid.stripeSessionId, 'pi_paid');
    orders.open = await order(2);
    orders.late = await order(3);
    lateSessionId = orders.late.stripeSessionId;
  });

  afterAll(async () => {
    await prisma.eventCancellation.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.refund.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('refuses ORGANIZER (events.cancel is ADMIN by default), a missing step-up, bad bodies and REFUND_ALL without orders.refund', async () => {
    expect((await request(app).post(cancelPath()).set(...auth(organizerToken)).set(...(await reauthHeader(organizerToken))).send({})).status).toBe(403);
    const noProof = await request(app).post(cancelPath()).set(...auth(adminToken)).send({});
    expect(noProof.status).toBe(401);
    expect(noProof.body.code).toBe('REAUTH_REQUIRED');
    const proof = await reauthHeader(adminToken);
    expect((await request(app).post(cancelPath()).set(...auth(adminToken)).set(...proof).send({ mode: 'LATER' })).status).toBe(400);
    expect((await request(app).post(cancelPath()).set(...auth(adminToken)).set(...proof).send({ notify: false })).status).toBe(400);
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: { 'orders.refund': false }, ORGANIZER: {}, disabled: [] } };
    try {
      expect((await request(app).post(cancelPath()).set(...auth(adminToken)).set(...proof).send({ mode: 'REFUND_ALL' })).status).toBe(403);
    } finally {
      permissionService.clearCache();
    }
    expect((await prisma.event.findUnique({ where: { id: event.id } })).status).toBe('PUBLISHED');
  });

  it('cancels: records the paid order, expires open checkouts and releases their holds', async () => {
    const before = await prisma.priceTier.findUnique({ where: { id: tier.id } });
    const res = await request(app).post(cancelPath()).set(...auth(adminToken)).set(...(await reauthHeader(adminToken))).send({ mode: 'MANUAL', message: 'Venue flooded' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const cancellation = await prisma.eventCancellation.findUnique({ where: { eventId: event.id }, include: { items: true } });
    expect(cancellation).toMatchObject({ mode: 'MANUAL', message: 'Venue flooded', completedAt: null });
    expect(cancellation.items.map((i) => [i.orderId, i.status])).toEqual([[orders.paid.id, 'PENDING']]);

    expect(stripeCalls.expired.sort()).toEqual([orders.open.stripeSessionId, orders.late.stripeSessionId].sort());
    expect((await prisma.order.findUnique({ where: { id: orders.open.id } })).status).toBe('FAILED');
    // The paid session Stripe would not expire stays PENDING for its webhook.
    expect((await prisma.order.findUnique({ where: { id: orders.late.id } })).status).toBe('PENDING');
    const after = await prisma.priceTier.findUnique({ where: { id: tier.id } });
    expect(after.quantityReserved).toBe(before.quantityReserved - 1);

    expect((await request(app).post(cancelPath()).set(...auth(adminToken)).set(...(await reauthHeader(adminToken))).send({})).status).toBe(409);
  });

  it('MANUAL: the sweep refunds nothing, emails the buyer once with the store note, then closes the cancellation', async () => {
    sentEmails.length = 0;
    const refundsBefore = stripeCalls.refunds.length;
    await eventCancellationService.sweep();
    await eventCancellationService.sweep();
    expect(stripeCalls.refunds.length).toBe(refundsBefore);
    const item = await prisma.eventCancellationItem.findUnique({ where: { orderId: orders.paid.id } });
    expect(item).toMatchObject({ status: 'SKIPPED', skippedReason: 'MANUAL_MODE' });
    expect(item.notifiedAt).not.toBeNull();
    const buyerMail = sentEmails.filter((m) => m.to.includes(contact(1).email));
    expect(buyerMail).toHaveLength(1);
    expect(buyerMail[0].subject).toContain('Event Cancelled');
    expect(buyerMail[0].text).toContain('will contact you about your order');
    expect(buyerMail[0].text).toContain('Venue flooded');
    expect(buyerMail[0].text).not.toContain('Refunded $');
    expect((await prisma.eventCancellation.findUnique({ where: { eventId: event.id } })).completedAt).not.toBeNull();
    // One staff summary, to the organization's members.
    expect(sentEmails.filter((m) => String(m.subject).startsWith('Refunds complete')).length).toBeGreaterThan(0);
  });

  it('refunds a checkout paid after the cancel instead of issuing usable tickets or a confirmation', async () => {
    sentEmails.length = 0;
    await paymentService.handleCheckoutCompleted(orders.late.stripeSessionId, 'pi_late');
    const late = await prisma.order.findUnique({ where: { id: orders.late.id }, include: { tickets: true } });
    expect(late.status).toBe('REFUNDED');
    expect(late.tickets.every((t) => t.status === 'VOIDED')).toBe(true);
    expect(stripeCalls.refunds.at(-1).params).toMatchObject({ payment_intent: 'pi_late' });
    expect(sentEmails.some((m) => String(m.subject).includes('Order Confirmed'))).toBe(false);
    const item = await prisma.eventCancellationItem.findUnique({ where: { orderId: orders.late.id } });
    expect(item).toMatchObject({ status: 'REFUNDED', attempts: 1 });
    expect(Number(item.refundedAmount)).toBe(Number(late.totalAmount));
    // Told it was refunded, whatever the cancellation's mode.
    const told = sentEmails.filter((m) => m.to.includes(contact(3).email));
    expect(told).toHaveLength(1);
    expect(told[0].text).toContain(`Refunded $${Number(late.totalAmount).toFixed(2)}`);
    expect(item.notifiedAt).not.toBeNull();
  });

  it("refuses to scan or check in a cancelled event's tickets", async () => {
    const ticket = await prisma.ticket.findFirst({ where: { orderId: orders.paid.id } });
    expect(ticket.status).toBe('VALID');
    await expect(ticketService.redeemByBarcode(ticket.barcode)).rejects.toMatchObject({ redemptionStatus: 'EVENT_CANCELLED' });
    await expect(ticketService.adminCheckIn(ticket.id)).rejects.toMatchObject({ redemptionStatus: 'EVENT_CANCELLED' });
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status).toBe('VALID');
  });

  it('keeps the public event page with cancelled: true', async () => {
    const res = await request(app).get(`/events/${event.id}`);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });
});
