// Contract tests: a refunded order must not read as REFUNDED while money is
// still held, and the two staff refund paths must return the same total
// (EVE-10 findings #1 and #2).
//
// The pre-existing refund fixtures all set totalAmount === pricePaid, i.e. an
// order with no fees and no tax. Every order Jump actually takes has both, so
// these tests build a realistic one: $100 base + $15 fees/tax = $115 charged.

import { jest } from '@jest/globals';

const refundsCreate = jest.fn(async ({ payment_intent, amount }) => ({
  id: `re_${Date.now()}_${amount}`,
  payment_intent,
  amount,
  status: 'succeeded',
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: { checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } }, refunds: { create: refundsCreate } },
}));
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { prisma } = await import('@jump/db');
const { default: refundService } = await import('../../src/services/RefundService.js');

const TAG = 'refund-completeness-ct';

// One ticket: $100 listed, $115 actually charged to the card.
const BASE = 100;
const PLATFORM_FEE = 5;
const PROCESSING_FEE = 4;
const TAX = 6;
const FEES_AND_TAX = PLATFORM_FEE + PROCESSING_FEE + TAX;
const TOTAL = BASE + FEES_AND_TAX;

describe('Refund completeness against the amount actually charged', () => {
  let org;
  let event;
  let tier;
  let contact;
  let seq = 0;

  /** An order whose totalAmount includes fees and tax, like a real checkout. */
  async function makeOrder({ tickets = 1 } = {}) {
    seq += 1;
    const subtotal = BASE * tickets;
    const total = TOTAL * tickets;
    const order = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG}-${seq}`,
        totalAmount: total,
        subtotalAmount: subtotal,
        platformFeeAmount: PLATFORM_FEE * tickets,
        processingFeeAmount: PROCESSING_FEE * tickets,
        taxAmount: TAX * tickets,
        quantity: tickets,
        status: 'COMPLETED',
        // The per-line fee and tax columns the real checkout writes — what
        // `ticketAmountPaid` reads to work out the all-in per-ticket amount.
        items: {
          create: [
            {
              priceTierId: tier.id,
              quantity: tickets,
              unitPrice: BASE,
              platformFee: PLATFORM_FEE * tickets,
              processingFee: PROCESSING_FEE * tickets,
              tax: TAX * tickets,
            },
          ],
        },
        payment: {
          create: {
            stripePaymentIntentId: `pi_${TAG}_${seq}`,
            amount: total,
            currency: 'usd',
            status: 'SUCCEEDED',
          },
        },
      },
    });
    const rows = [];
    for (let i = 0; i < tickets; i += 1) {
      seq += 1;
      rows.push(
        await prisma.ticket.create({
          data: {
            orderId: order.id,
            eventId: event.id,
            priceTierId: tier.id,
            contactId: contact.id,
            ticketNumber: seq,
            pricePaid: BASE,
            barcode: `JUMP-${TAG}-${seq}`,
            status: 'VALID',
          },
        })
      );
    }
    return { order, tickets: rows };
  }

  const refundedTotal = async (orderId) => {
    const rows = await prisma.refund.findMany({ where: { orderId, status: 'SUCCEEDED' } });
    return rows.reduce((sum, r) => sum + Number(r.amount), 0);
  };
  const statusOf = async (orderId) =>
    (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } })).status;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: 'V', address: '1' } });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: 'E',
        date: new Date(Date.now() + 72 * 3600 * 1000),
        capacity: 200,
        status: 'PUBLISHED',
      },
    });
    tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: BASE, quantityTotal: 200, quantitySold: 100, isRefundable: true },
    });
    contact = await prisma.contact.create({
      data: { organizationId: org.id, email: `buyer@${TAG}.test`, firstName: 'B', lastName: 'B' },
    });
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
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  });

  beforeEach(() => refundsCreate.mockClear());

  // ── Finding #1 ────────────────────────────────────────────────────────────

  it('does not mark an order REFUNDED while fees and tax are still held', async () => {
    const { order, tickets } = await makeOrder();

    await refundService.refundTicket(tickets[0].id, { initiatedBy: 'staff' });

    const refunded = await refundedTotal(order.id);
    expect(refunded).toBeLessThan(TOTAL);
    // The order still holds $15. It must not claim to be fully refunded.
    expect(await statusOf(order.id)).toBe('PARTIALLY_REFUNDED');
  });

  it('leaves the remaining fees and tax recoverable through refundOrder', async () => {
    const { order, tickets } = await makeOrder();

    await refundService.refundTicket(tickets[0].id, { initiatedBy: 'staff' });
    // Staff notice the shortfall and return the rest. This must not 409.
    await refundService.refundOrder(order.id, { initiatedBy: 'staff' });

    expect(await refundedTotal(order.id)).toBeCloseTo(TOTAL, 2);
    expect(await statusOf(order.id)).toBe('REFUNDED');
  });

  // ── Finding #2 ────────────────────────────────────────────────────────────

  it('refunding every ticket individually returns the same total as refunding the order', async () => {
    const perTicket = await makeOrder({ tickets: 2 });
    const wholeOrder = await makeOrder({ tickets: 2 });

    for (const ticket of perTicket.tickets) {
      await refundService.refundTicket(ticket.id, { initiatedBy: 'staff' });
    }
    await refundService.refundOrder(wholeOrder.order.id, { initiatedBy: 'staff' });

    const viaTickets = await refundedTotal(perTicket.order.id);
    const viaOrder = await refundedTotal(wholeOrder.order.id);

    expect(viaTickets).toBeCloseTo(viaOrder, 2);
    expect(viaTickets).toBeCloseTo(TOTAL * 2, 2);
    expect(await statusOf(perTicket.order.id)).toBe('REFUNDED');
  });

  it('never refunds more than the card was charged', async () => {
    const { order, tickets } = await makeOrder({ tickets: 2 });

    for (const ticket of tickets) {
      await refundService.refundTicket(ticket.id, { initiatedBy: 'staff' });
    }
    // Both tickets are gone and the full amount is back — nothing left to take.
    await expect(refundService.refundOrder(order.id, { initiatedBy: 'staff' })).rejects.toThrow();

    const cents = refundsCreate.mock.calls.reduce((sum, [args]) => sum + args.amount, 0);
    expect(cents).toBe(Math.round(TOTAL * 2 * 100));
    expect(await refundedTotal(order.id)).toBeCloseTo(TOTAL * 2, 2);
  });
});
