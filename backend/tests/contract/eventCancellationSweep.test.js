// Spec 054-B: the refund sweep of a cancelled paid event (REFUND_ALL). Each
// paid order is refunded once and its buyer emailed once, even with two sweeps
// running at the same time; an open dispute, a staff refund and a crash after
// the refund are recorded, not refunded again; a Stripe failure is retried
// with backoff, then left FAILED; one staff summary closes the cancellation.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff, reauthHeader } from '../helpers/staff.js';

const sentEmails = [];
const refundCalls = [];
let counter = 0;

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { data: { id: 'mock' }, error: null }; }) } },
}));

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn(async (params) => ({ id: `cs_sweep_${Date.now()}_${++counter}`, url: 'https://checkout.stripe.com/pay/x', metadata: params.metadata })),
        retrieve: jest.fn(async (id) => ({ id, metadata: {} })),
        expire: jest.fn(async (id) => ({ id, status: 'expired' })),
      },
    },
    refunds: {
      create: jest.fn(async (params, options) => {
        refundCalls.push({ params, options });
        // The connected account has no balance left for this one.
        if (params.payment_intent === 'pi_sweep_broke') throw new Error('Insufficient funds in Stripe account');
        return { id: `re_sweep_${++counter}`, amount: params.amount, status: 'succeeded' };
      }),
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentService } = await import('../../src/services/PaymentService.js');
const { default: refundService } = await import('../../src/services/RefundService.js');
const { default: eventCancellationService } = await import('../../src/services/EventCancellationService.js');

const TAG = `evt-sweep-${Date.now()}`;
const contact = (n) => ({ email: `buyer${n}@${TAG}.test`, firstName: `Buyer${n}`, lastName: 'Test' });
const minutesFromNow = (m) => () => new Date(Date.now() + m * 60 * 1000);

describe('Refund sweep of a cancelled paid event (spec 054-B)', () => {
  let adminToken;
  let org;
  let event;
  let tier;
  const orders = {};
  const emails = [`admin@${TAG}.test`];
  const item = (key) => prisma.eventCancellationItem.findUnique({ where: { orderId: orders[key].id } });
  const mailTo = (n) => sentEmails.filter((m) => m.to.includes(contact(n).email));
  const refundsFor = (key) => refundCalls.filter((c) => c.params.payment_intent === `pi_sweep_${key}`);

  const paidOrder = async (n, key) => {
    const res = await request(app).post('/orders').send({ eventId: event.id, items: [{ priceTierId: tier.id, quantity: 1 }], contact: contact(n) });
    expect(res.status).toBe(201);
    const order = await prisma.order.findUnique({ where: { id: res.body.orderId } });
    await paymentService.handleCheckoutCompleted(order.stripeSessionId, `pi_sweep_${key}`);
    orders[key] = order;
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, email: `store@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T23:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 50 } });

    await paidOrder(1, 'ok');
    await paidOrder(2, 'disputed');
    await paidOrder(3, 'staff');
    await paidOrder(4, 'crashed');
    await paidOrder(5, 'broke');

    await prisma.dispute.create({
      data: {
        orderId: orders.disputed.id, stripeDisputeId: `dp_${TAG}`, amount: 20, stripeStatus: 'needs_response', state: 'OPEN',
        openedAt: new Date(), lastEventAt: new Date(), lastEventType: 'charge.dispute.created',
      },
    });
    // Staff refunded this one in Orders before the event was cancelled.
    await refundService.refundOrder(orders.staff.id, { reason: 'Asked for it' });
  });

  afterAll(async () => {
    await prisma.eventCancellation.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.dispute.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
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

  it('cancels with REFUND_ALL: one PENDING item per paid order, the cancellation open', async () => {
    const res = await request(app)
      .post(`/organizations/${org.id}/events/${event.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set(...(await reauthHeader(adminToken)))
      .send({ mode: 'REFUND_ALL', message: 'The venue flooded.' });
    expect(res.status).toBe(200);
    const cancellation = await prisma.eventCancellation.findUnique({ where: { eventId: event.id }, include: { items: true } });
    expect(cancellation).toMatchObject({ mode: 'REFUND_ALL', completedAt: null });
    // The staff-refunded order is REFUNDED, so it is not a paid order any more.
    expect(cancellation.items.map((i) => i.orderId).sort()).toEqual([orders.ok.id, orders.disputed.id, orders.crashed.id, orders.broke.id].sort());
    expect(cancellation.items.every((i) => i.status === 'PENDING')).toBe(true);
  });

  it('a crash after the refund but before it was recorded: the re-run records it and refunds nothing twice', async () => {
    // As if an earlier sweep refunded this order, then died before writing the item.
    await refundService.refundOrder(orders.crashed.id, { reason: 'Event cancelled' });
    await prisma.eventCancellationItem.update({ where: { orderId: orders.crashed.id }, data: { attempts: 1, updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    expect(refundsFor('crashed')).toHaveLength(1);
  });

  it('two sweeps at once: every order is refunded once and its buyer emailed once', async () => {
    sentEmails.length = 0;
    await Promise.all([eventCancellationService.sweep(), eventCancellationService.sweep()]);

    expect(refundsFor('ok')).toHaveLength(1);
    expect(refundsFor('ok')[0].options).toMatchObject({ idempotencyKey: expect.stringContaining(`order:${orders.ok.id}:full`) });
    expect(await item('ok')).toMatchObject({ status: 'REFUNDED', attempts: 1 });
    expect(Number((await item('ok')).refundedAmount)).toBe(Number(orders.ok.totalAmount));
    expect((await prisma.order.findUnique({ where: { id: orders.ok.id } })).status).toBe('REFUNDED');
    const okMail = mailTo(1);
    expect(okMail).toHaveLength(1);
    expect(okMail[0].text).toContain(`We've refunded $${Number(orders.ok.totalAmount).toFixed(2)}`);
    expect(okMail[0].text).toContain('5–10 business days');
    expect(okMail[0].text).toContain('The venue flooded.');
    expect(okMail[0].reply_to).toBe(`store@${TAG}.test`);

    // The dispute flow owns disputed money: no refund, the buyer still hears the event is off.
    expect(refundsFor('disputed')).toHaveLength(0);
    expect(await item('disputed')).toMatchObject({ status: 'SKIPPED', skippedReason: 'OPEN_DISPUTE' });
    expect(mailTo(2)).toHaveLength(1);
    expect(mailTo(2)[0].text).not.toContain('Refunded $');

    // Refunded by the earlier, crashed attempt: recorded, not refunded again.
    expect(refundsFor('crashed')).toHaveLength(1);
    expect(await item('crashed')).toMatchObject({ status: 'REFUNDED' });
    expect(mailTo(4)).toHaveLength(1);

    // Stripe refused: kept PENDING for a retry, nobody emailed yet.
    expect(refundsFor('broke')).toHaveLength(1);
    expect(await item('broke')).toMatchObject({ status: 'PENDING', attempts: 1, error: expect.stringContaining('Insufficient funds') });
    expect(mailTo(5)).toHaveLength(0);
    expect((await prisma.eventCancellation.findUnique({ where: { eventId: event.id } })).completedAt).toBeNull();
  });

  it('retries a failed refund after its backoff, then leaves it FAILED and sends one staff summary', async () => {
    // Inside the backoff: not retried.
    await eventCancellationService.sweep();
    expect(refundsFor('broke')).toHaveLength(1);

    await eventCancellationService.sweep({ now: minutesFromNow(2) });
    expect(refundsFor('broke')).toHaveLength(2);
    expect(await item('broke')).toMatchObject({ status: 'PENDING', attempts: 2 });

    sentEmails.length = 0;
    await eventCancellationService.sweep({ now: minutesFromNow(5) });
    expect(refundsFor('broke')).toHaveLength(3);
    expect(await item('broke')).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(mailTo(5)).toHaveLength(0);

    const cancellation = await prisma.eventCancellation.findUnique({ where: { eventId: event.id } });
    expect(cancellation.completedAt).not.toBeNull();
    const summary = sentEmails.filter((m) => m.to.includes(emails[0]));
    expect(summary).toHaveLength(1);
    expect(summary[0].subject).toBe(`Refunds need attention — ${event.name}`);
    expect(summary[0].text).toContain('Refunded: 2 orders');
    expect(summary[0].text).toContain('1 open dispute');
    expect(summary[0].text).toContain(`Refund failed: 1. Retry them or refund them in Orders: ${orders.broke.orderRef}`);

    // Nothing left: further sweeps do nothing and send nothing.
    sentEmails.length = 0;
    await eventCancellationService.sweep({ now: minutesFromNow(30) });
    expect(refundsFor('broke')).toHaveLength(3);
    expect(sentEmails).toHaveLength(0);
  });
});
