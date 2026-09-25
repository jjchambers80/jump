// Unit tests: the amount RefundService actually returns, and the order status
// it actually writes, for an order that carries fees and tax (EVE-10 #1, #2).
//
// These drive the real RefundService bodies over an in-memory stand-in for
// Prisma. The defect under test is arithmetic and branching, not SQL, so the
// row locks are not modelled. tests/contract/refundCompleteness.test.js runs
// the same scenarios against a real Postgres in CI.

import { jest } from '@jest/globals';

// One ticket: $100 listed, $115 actually charged to the card.
const BASE = 100;
const TOTAL = 115;

/** Minimal in-memory Prisma double covering the calls the refund paths make. */
function makeDb({ ticketCount = 1, base = BASE, total = TOTAL, uneven = false } = {}) {
  // `uneven`: $10.00 of fees over the whole line, which does not divide evenly
  // by 3 tickets. Exercises the remainder allocation.
  const lineExtras = uneven ? 10 : (total - base) * ticketCount;
  const order = {
    id: 'order_1',
    orderRef: 'JMP-1',
    status: 'COMPLETED',
    totalAmount: base * ticketCount + lineExtras,
    stripePaymentIntentId: 'pi_1',
    paymentStatus: 'SUCCEEDED',
    stripeAccountId: null,
    kind: 'TICKET',
    applicationId: null,
  };
  const tickets = Array.from({ length: ticketCount }, (_, i) => ({
    id: `ticket_${i + 1}`,
    orderId: order.id,
    priceTierId: 'tier_1',
    ticketNumber: i + 1,
    pricePaid: base,
    status: 'VALID',
  }));
  // The per-line fee and tax breakdown a real checkout writes: $15 per ticket
  // on top of the $100 listed price.
  const items = [
    {
      priceTierId: 'tier_1',
      quantity: ticketCount,
      unitPrice: base,
      platformFee: lineExtras,
      processingFee: 0,
      tax: 0,
    },
  ];
  const refunds = [];
  const payment = { stripePaymentIntentId: 'pi_1', status: 'SUCCEEDED', stripeAccountId: null };

  const sum = (field) =>
    refunds.filter((r) => r.status === 'SUCCEEDED').reduce((t, r) => t + Number(r[field] ?? 0), 0);

  const tx = {
    $queryRaw: async (strings) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "Order" o')) return [{ ...order }];
      if (sql.includes('SUM("feeAmount")')) return [{ total: sum('feeAmount') }];
      if (sql.includes('SUM("amount")')) return [{ total: sum('amount') }];
      throw new Error(`unmodelled $queryRaw: ${sql}`);
    },
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE "Refund"')) {
        const row = refunds.find((r) => r.id === values[1]);
        if (row) Object.assign(row, { stripeRefundId: values[0], status: 'SUCCEEDED' });
      }
      return 1;
    },
    ticket: {
      findUnique: async ({ where }) => {
        const t = tickets.find((x) => x.id === where.id);
        if (!t) return null;
        return { ...t, order: { ...order, payment, tickets, items }, priceTier: { isRefundable: true, name: 'GA' } };
      },
      findMany: async ({ where }) =>
        tickets.filter((t) => t.orderId === where.orderId && where.status.in.includes(t.status)),
      update: async ({ where, data }) => Object.assign(tickets.find((t) => t.id === where.id), data),
      count: async ({ where }) =>
        tickets.filter((t) => t.orderId === where.orderId && where.status.in.includes(t.status)).length,
    },
    refund: {
      create: async ({ data }) => {
        const row = { id: `refund_${refunds.length + 1}`, createdAt: new Date(), ...data };
        refunds.push(row);
        return row;
      },
    },
    orderAddOn: { count: async () => 0, findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    order: { update: async ({ data }) => Object.assign(order, data) },
  };

  return {
    order,
    tickets,
    refunds,
    refundedTotal: () => sum('amount'),
    tx,
  };
}

const refundsCreate = jest.fn(async ({ amount }) => ({ id: `re_${amount}`, amount, status: 'succeeded' }));

// One stable Prisma facade; `reset()` swaps the state behind it, because the
// service binds the `prisma` import once at module load.
let db = makeDb();
const reset = (opts) => {
  db = makeDb(opts);
  return db;
};

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    order: { findUnique: async () => ({ kind: db.order.kind }) },
    $transaction: async (fn) => fn(db.tx),
  },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: { refunds: { create: refundsCreate } },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: refundService } = await import('../../src/services/RefundService.js');

beforeEach(() => refundsCreate.mockClear());

describe('per-ticket refund on an order that carries fees and tax', () => {
  it('returns the full amount charged for that ticket, not just the base price', async () => {
    reset();

    await refundService.refundTicket('ticket_1', { initiatedBy: 'staff' });

    // The buyer was charged $115 for this one ticket. All of it must come back.
    expect(db.refundedTotal()).toBeCloseTo(TOTAL, 2);
    expect(refundsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 11500 }));
  });

  it('does not mark the order REFUNDED while any money is still held', async () => {
    reset({ ticketCount: 2 });

    await refundService.refundTicket('ticket_1', { initiatedBy: 'staff' });

    expect(db.order.status).toBe('PARTIALLY_REFUNDED');
    expect(db.refundedTotal()).toBeLessThan(Number(db.order.totalAmount));
  });

  it('marks the order REFUNDED only once the whole charge is back', async () => {
    reset({ ticketCount: 2 });

    await refundService.refundTicket('ticket_1', { initiatedBy: 'staff' });
    await refundService.refundTicket('ticket_2', { initiatedBy: 'staff' });

    expect(db.refundedTotal()).toBeCloseTo(TOTAL * 2, 2);
    expect(db.order.status).toBe('REFUNDED');
  });

  it('keeps a retained policy fee out of the buyer refund and off the order total', async () => {
    reset();

    // Spec 031 self-serve refund: the org keeps $10.
    await refundService.refundTicket('ticket_1', { initiatedBy: 'buyer', feeAmount: 10 });

    expect(db.refundedTotal()).toBeCloseTo(TOTAL - 10, 2);
    // $10 of the buyer's money is still held, so staff can still return it.
    expect(db.order.status).toBe('PARTIALLY_REFUNDED');
  });
});

describe('the two staff refund paths agree', () => {
  it('refunding every ticket returns the same total as refunding the order', async () => {
    reset({ ticketCount: 2 });
    await refundService.refundTicket('ticket_1', { initiatedBy: 'staff' });
    await refundService.refundTicket('ticket_2', { initiatedBy: 'staff' });
    const viaTickets = db.refundedTotal();

    reset({ ticketCount: 2 });
    await refundService.refundOrder('order_1', { initiatedBy: 'staff' });
    const viaOrder = db.refundedTotal();

    expect(viaTickets).toBeCloseTo(viaOrder, 2);
    expect(viaTickets).toBeCloseTo(TOTAL * 2, 2);
  });

  it('splits a line whose fees do not divide evenly without losing a cent', async () => {
    // $10.00 of fees across 3 tickets: 3.33 / 3.34 / 3.33, never 3×3.33.
    reset({ ticketCount: 3, uneven: true });
    const charged = Number(db.order.totalAmount);

    for (const t of db.tickets) await refundService.refundTicket(t.id, { initiatedBy: 'staff' });

    expect(db.refundedTotal()).toBeCloseTo(charged, 2);
    expect(db.order.status).toBe('REFUNDED');
  });

  it('never returns more than the card was charged', async () => {
    reset({ ticketCount: 2 });

    await refundService.refundTicket('ticket_1', { initiatedBy: 'staff' });
    await refundService.refundTicket('ticket_2', { initiatedBy: 'staff' });
    await expect(refundService.refundOrder('order_1', { initiatedBy: 'staff' })).rejects.toThrow();

    const cents = refundsCreate.mock.calls.reduce((t, [args]) => t + args.amount, 0);
    expect(cents).toBe(Math.round(TOTAL * 2 * 100));
  });
});
