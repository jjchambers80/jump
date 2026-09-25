// Contract tests: self-serve refund policy on POST /buyer/me/tickets/:id/refund
// and the refundPolicy block on GET /buyer/me/tickets (spec 031 phase 2).

import { jest } from '@jest/globals';
import request from 'supertest';

const refundsCreate = jest.fn(async ({ payment_intent, amount }) => ({ id: `re_${Date.now()}_${amount}`, payment_intent, amount, status: 'succeeded' }));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: { checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } }, refunds: { create: refundsCreate } },
}));
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { default: refundService } = await import('../../src/services/RefundService.js');

const TAG = 'refund-policy-ct';
const HOUR = 3600 * 1000;

describe('Self-serve refund policy', () => {
  let org;
  let event;
  let tier;
  let contact;
  let session;
  let seq = 0;

  const setPolicy = (data) => prisma.organization.update({ where: { id: org.id }, data });

  async function makeTicket({ pricePaid = 20, tierOverride = null, eventOverride = null } = {}) {
    seq += 1;
    const t = tierOverride || tier;
    const e = eventOverride || event;
    const order = await prisma.order.create({
      data: {
        eventId: e.id, contactId: contact.id, orderRef: `${TAG}-${seq}`, totalAmount: pricePaid, subtotalAmount: pricePaid, quantity: 1, status: 'COMPLETED',
        items: { create: [{ priceTierId: t.id, quantity: 1, unitPrice: pricePaid }] },
        payment: { create: { stripePaymentIntentId: `pi_${TAG}_${seq}`, amount: pricePaid, currency: 'usd', status: 'SUCCEEDED' } },
      },
    });
    return prisma.ticket.create({
      data: { orderId: order.id, eventId: e.id, priceTierId: t.id, contactId: contact.id, ticketNumber: seq, pricePaid, barcode: `JUMP-${TAG}-${seq}`, status: 'VALID' },
    });
  }

  const refund = (ticket) => request(app).post(`/buyer/me/tickets/${ticket.id}/refund`).set('Authorization', `Bearer ${session}`);
  const tickets = () => request(app).get('/buyer/me/tickets').set('Authorization', `Bearer ${session}`);

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: 'V', address: '1' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: 'E', date: new Date(Date.now() + 72 * HOUR), capacity: 50, status: 'PUBLISHED' } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 50, quantitySold: 10, isRefundable: true } });
    contact = await prisma.contact.create({ data: { organizationId: org.id, email: `buyer@${TAG}.test`, firstName: 'B', lastName: 'B', accountCreatedAt: new Date() } });
    session = buyerAuthService.signSession({ contactId: contact.id, organizationId: org.id, email: contact.email });
  });

  afterAll(async () => {
    const where = { event: { venue: { organizationId: org.id } } };
    await prisma.refund.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.ticket.deleteMany({ where }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: where } }).catch(() => {});
    await prisma.order.deleteMany({ where }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  });

  beforeEach(() => refundsCreate.mockClear());

  it('defaults reproduce the old behaviour: full refund any time before the event', async () => {
    const ticket = await makeTicket();
    const list = await tickets();
    const row = list.body.data.find((t) => t.id === ticket.id);
    expect(row.refundPolicy).toMatchObject({ eligible: true, reason: null, fee: 0, refundAmount: 20 });
    expect(new Date(row.refundPolicy.deadline)).toEqual(event.date);

    const res = await refund(ticket);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 20, feeAmount: 0, status: 'SUCCEEDED' });
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
      // EVE-3: the per-ticket idempotency key, so a retried refund replays
      // the first one instead of paying the buyer twice.
      { idempotencyKey: `jump:refund:ticket:${ticket.id}` }
    );
  });

  it('refuses when the organization turned self-serve refunds off', async () => {
    await setPolicy({ selfServeRefundsEnabled: false });
    const ticket = await makeTicket();
    expect((await tickets()).body.data.find((t) => t.id === ticket.id).refundPolicy).toMatchObject({ eligible: false, reason: 'DISABLED' });
    const res = await refund(ticket);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not offer self-service refunds/);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status).toBe('VALID');
    await setPolicy({ selfServeRefundsEnabled: true });
  });

  it('refuses inside the cutoff window and reports the deadline', async () => {
    await setPolicy({ selfServeRefundCutoffHours: 96 }); // event is 72 h out → window already closed
    const ticket = await makeTicket();
    const row = (await tickets()).body.data.find((t) => t.id === ticket.id);
    expect(row.refundPolicy).toMatchObject({ eligible: false, reason: 'WINDOW_CLOSED' });
    expect(new Date(row.refundPolicy.deadline)).toEqual(new Date(event.date.getTime() - 96 * HOUR));
    const res = await refund(ticket);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/refund window/);
    await setPolicy({ selfServeRefundCutoffHours: 24 });
    expect((await refund(ticket)).status).toBe(200);
    await setPolicy({ selfServeRefundCutoffHours: null });
  });

  it('keeps a fixed fee: Stripe refunds the net, the Refund row records both, a later staff refund returns the rest', async () => {
    await setPolicy({ selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 2.5 });
    const ticket = await makeTicket();
    const row = (await tickets()).body.data.find((t) => t.id === ticket.id);
    expect(row.refundPolicy).toMatchObject({ eligible: true, fee: 2.5, refundAmount: 17.5 });

    const res = await refund(ticket);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 17.5, feeAmount: 2.5 });
    expect(res.body.reason).toMatch(/2\.50 fee retained/);
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1750 }),
      // EVE-3: the per-ticket idempotency key, so a retried refund replays
      // the first one instead of paying the buyer twice.
      { idempotencyKey: `jump:refund:ticket:${ticket.id}` }
    );
    const stored = await prisma.refund.findFirst({ where: { ticketId: ticket.id } });
    expect(Number(stored.amount)).toBe(17.5);
    expect(Number(stored.feeAmount)).toBe(2.5);
    const voided = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(voided.status).toBe('VOIDED');
    // The retained fee is money still on the order, so it is not REFUNDED yet …
    const order = await prisma.order.findUnique({ where: { id: voided.orderId } });
    expect(order.status).toBe('PARTIALLY_REFUNDED');

    // … and staff can return it through a full-order refund of the remainder.
    const rest = await refundService.refundOrder(voided.orderId, { reason: 'goodwill', initiatedBy: 'staff' });
    expect(rest.amount).toBe(2.5);
    expect((await prisma.order.findUnique({ where: { id: voided.orderId } })).status).toBe('REFUNDED');
    await setPolicy({ selfServeRefundFeeType: 'NONE', selfServeRefundFeeValue: null });
  });

  it('applies a percent fee rounded to cents and refuses a fee that leaves nothing', async () => {
    await setPolicy({ selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 12.5 });
    const ticket = await makeTicket({ pricePaid: 19.99 });
    const res = await refund(ticket);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 17.49, feeAmount: 2.5 });

    await setPolicy({ selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 50 });
    const cheap = await makeTicket({ pricePaid: 10 });
    expect((await tickets()).body.data.find((t) => t.id === cheap.id).refundPolicy).toMatchObject({ eligible: false, reason: 'ZERO' });
    expect((await refund(cheap)).status).toBe(400);
    await setPolicy({ selfServeRefundFeeType: 'NONE', selfServeRefundFeeValue: null });
  });

  it('staff ticket refunds ignore the policy and return the full price', async () => {
    await setPolicy({ selfServeRefundsEnabled: false, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 5 });
    const ticket = await makeTicket();
    const res = await refundService.refundTicket(ticket.id, { reason: 'staff', initiatedBy: 'staff' });
    expect(res).toMatchObject({ amount: 20, feeAmount: 0 });
    await setPolicy({ selfServeRefundsEnabled: true, selfServeRefundFeeType: 'NONE', selfServeRefundFeeValue: null });
  });

  it('a non-refundable tier and a voided ticket are still refused', async () => {
    const fixed = await prisma.priceTier.create({ data: { eventId: event.id, name: 'Fixed', price: 20, quantityTotal: 5, quantitySold: 1, isRefundable: false } });
    const ticket = await makeTicket({ tierOverride: fixed });
    expect((await tickets()).body.data.find((t) => t.id === ticket.id).refundPolicy).toMatchObject({ eligible: false, reason: 'TIER' });
    expect((await refund(ticket)).status).toBe(400);

    const ok = await makeTicket();
    expect((await refund(ok)).status).toBe(200);
    const again = await refund(ok);
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/Only valid tickets/);
  });
});
