// Unit tests: the refund reconciliation classifier (EVE-10, OQ-R11).
//
// The report's job is to find an order that reads as fully refunded while the
// buyer's money is still held — the row the pre-fix per-ticket refund produced
// on any order carrying fees and tax. These assert the classifier against that
// exact shape, against the shapes it must NOT flag (a disclosed policy fee is
// money legitimately kept), and against both directions of the Stripe match.
//
// Pure module: no database, no Stripe, so it runs without Postgres.

import { classifyOrder, reconcileRefunds, summarize, cents, FINDINGS } from '../../src/services/refundAudit.js';

const succeeded = (amount, feeAmount = 0) => ({ amount, feeAmount, status: 'SUCCEEDED' });

describe('classifyOrder', () => {
  it('flags an order marked REFUNDED while part of the charge is still held', () => {
    // The OQ-R11 legacy shape: $100 listed + $15 fees and tax, only the listed
    // price went back, and the old status rule called that REFUNDED.
    const row = classifyOrder({
      orderRef: 'JMP-1',
      status: 'REFUNDED',
      totalAmount: 115,
      refunds: [succeeded(100)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBe(FINDINGS.MONEY_HELD_ON_REFUNDED);
    expect(row.unreturnedCents).toBe(1500);
    expect(row.unexplainedCents).toBe(1500);
    expect(row.expectedStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('flags a REFUNDED order with no refund row at all', () => {
    const row = classifyOrder({ orderRef: 'JMP-2', status: 'REFUNDED', totalAmount: 115, refunds: [] });

    expect(row.finding).toBe(FINDINGS.MONEY_HELD_ON_REFUNDED);
    expect(row.refundedCents).toBe(0);
  });

  it('passes an order whose whole charge went back', () => {
    const row = classifyOrder({
      orderRef: 'JMP-3',
      status: 'REFUNDED',
      totalAmount: 115,
      refunds: [succeeded(115)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBeNull();
    expect(row.expectedStatus).toBe('REFUNDED');
  });

  it('treats a disclosed policy fee as money legitimately kept, not a discrepancy', () => {
    // Spec 031: the organization keeps `Refund.feeAmount` and the order stays
    // PARTIALLY_REFUNDED so staff can still return it.
    const row = classifyOrder({
      orderRef: 'JMP-4',
      status: 'PARTIALLY_REFUNDED',
      totalAmount: 115,
      refunds: [succeeded(105, 10)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBeNull();
    expect(row.unreturnedCents).toBe(1000);
    expect(row.unexplainedCents).toBe(0);
    expect(row.expectedStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('flags a partial order that is actually settled in full', () => {
    const row = classifyOrder({
      orderRef: 'JMP-5',
      status: 'PARTIALLY_REFUNDED',
      totalAmount: 115,
      refunds: [succeeded(60), succeeded(55)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBe(FINDINGS.STALE_PARTIAL);
    expect(row.expectedStatus).toBe('REFUNDED');
  });

  it('keeps a part-refunded order with a live ticket as PARTIALLY_REFUNDED', () => {
    const row = classifyOrder({
      orderRef: 'JMP-6',
      status: 'PARTIALLY_REFUNDED',
      totalAmount: 230,
      refunds: [succeeded(115)],
      activeTicketCount: 1,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBeNull();
    expect(row.expectedStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('flags money back on an order whose status never mentions a refund', () => {
    // A dashboard refund or a chargeback: nothing in Jump reacts today (EVE-14).
    const row = classifyOrder({
      orderRef: 'JMP-7',
      status: 'COMPLETED',
      totalAmount: 115,
      refunds: [succeeded(115)],
      activeTicketCount: 1,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBe(FINDINGS.REFUND_ON_UNREFUNDED_ORDER);
  });

  it('flags more going back than was ever charged', () => {
    const row = classifyOrder({
      orderRef: 'JMP-8',
      status: 'REFUNDED',
      totalAmount: 115,
      refunds: [succeeded(115), succeeded(15)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.finding).toBe(FINDINGS.OVER_REFUNDED);
    expect(row.unreturnedCents).toBe(-1500);
  });

  it('counts only SUCCEEDED refunds as money back', () => {
    const row = classifyOrder({
      orderRef: 'JMP-9',
      status: 'REFUNDED',
      totalAmount: 115,
      refunds: [{ amount: 115, status: 'PENDING' }, { amount: 115, status: 'FAILED' }],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.refundedCents).toBe(0);
    expect(row.finding).toBe(FINDINGS.MONEY_HELD_ON_REFUNDED);
  });

  it('adds shares in integer cents, so an uneven split still balances', () => {
    // 3 refunds of a $10.10 line: 3.37 / 3.37 / 3.36. In floats these sum to
    // 10.099999999999998 and the order would never look fully repaid.
    const row = classifyOrder({
      orderRef: 'JMP-10',
      status: 'REFUNDED',
      totalAmount: 10.1,
      refunds: [succeeded(3.37), succeeded(3.37), succeeded(3.36)],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.refundedCents).toBe(1010);
    expect(row.unreturnedCents).toBe(0);
    expect(row.finding).toBeNull();
  });

  it('reads Prisma Decimal values, not just numbers', () => {
    // Prisma returns Decimal; `Number(...)` of its toString is what the report sees.
    const decimal = { toString: () => '115.00', valueOf: () => '115.00' };
    const row = classifyOrder({
      orderRef: 'JMP-11',
      status: 'REFUNDED',
      totalAmount: decimal,
      refunds: [succeeded({ toString: () => '115.00', valueOf: () => '115.00' })],
      activeTicketCount: 0,
      openAddOnLineCount: 0,
    });

    expect(row.chargedCents).toBe(11500);
    expect(row.finding).toBeNull();
  });
});

describe('reconcileRefunds', () => {
  it('matches a refund row to its Stripe refund', () => {
    const result = reconcileRefunds({
      dbRefunds: [{ orderRef: 'JMP-1', stripeRefundId: 're_1', amount: 115, status: 'SUCCEEDED' }],
      stripeRefunds: [{ id: 're_1', amount: 11500, status: 'succeeded' }],
    });

    expect(result.matchedCount).toBe(1);
    expect(result.missingInDb).toEqual([]);
    expect(result.missingInStripe).toEqual([]);
    expect(result.amountMismatches).toEqual([]);
  });

  it('reports a Stripe refund with no row on our side', () => {
    // A refund issued from the Stripe dashboard, or a dispute.
    const result = reconcileRefunds({
      dbRefunds: [],
      stripeRefunds: [{ id: 're_orphan', amount: 1500, status: 'succeeded' }],
    });

    expect(result.missingInDb).toHaveLength(1);
    expect(result.missingInDb[0].id).toBe('re_orphan');
  });

  it('reports a refund row with no Stripe refund, and says which kind', () => {
    const result = reconcileRefunds({
      dbRefunds: [
        { orderRef: 'JMP-1', stripeRefundId: null, amount: 10, status: 'SUCCEEDED' },
        { orderRef: 'JMP-2', stripeRefundId: 're_gone', amount: 10, status: 'SUCCEEDED' },
      ],
      stripeRefunds: [],
    });

    expect(result.missingInStripe.map((r) => r.reason)).toEqual(['no_stripe_refund_id', 'not_found_in_stripe']);
  });

  it('skips an offline refund instead of calling it missing', () => {
    const result = reconcileRefunds({
      dbRefunds: [{ orderRef: 'JMP-1', stripeRefundId: null, amount: 115, status: 'SUCCEEDED', manual: true }],
      stripeRefunds: [],
    });

    expect(result.offlineCount).toBe(1);
    expect(result.missingInStripe).toEqual([]);
  });

  it('catches an amount that drifted between the two sides', () => {
    const result = reconcileRefunds({
      dbRefunds: [{ orderRef: 'JMP-1', stripeRefundId: 're_1', amount: 100, status: 'SUCCEEDED' }],
      stripeRefunds: [{ id: 're_1', amount: 11500, status: 'succeeded' }],
    });

    expect(result.amountMismatches).toHaveLength(1);
    expect(result.amountMismatches[0]).toMatchObject({ dbAmountCents: 10000, stripeAmount: 11500 });
  });

  it('ignores a failed Stripe refund on both sides', () => {
    const result = reconcileRefunds({
      dbRefunds: [{ orderRef: 'JMP-1', stripeRefundId: 're_failed', amount: 115, status: 'FAILED' }],
      stripeRefunds: [{ id: 're_failed', amount: 11500, status: 'failed' }],
    });

    expect(result.matchedCount).toBe(0);
    expect(result.missingInDb).toEqual([]);
    expect(result.missingInStripe).toEqual([]);
  });
});

describe('summarize', () => {
  it('groups findings worst first and counts the clean rows', () => {
    const rows = [
      classifyOrder({ orderRef: 'a', status: 'REFUNDED', totalAmount: 115, refunds: [succeeded(115)] }),
      classifyOrder({ orderRef: 'b', status: 'REFUNDED', totalAmount: 115, refunds: [succeeded(100)] }),
      classifyOrder({ orderRef: 'c', status: 'PARTIALLY_REFUNDED', totalAmount: 115, refunds: [succeeded(115)] }),
    ];
    const summary = summarize(rows);

    expect(summary.total).toBe(3);
    expect(summary.clean).toBe(1);
    expect(summary.findings.map((g) => g.finding)).toEqual([FINDINGS.MONEY_HELD_ON_REFUNDED, FINDINGS.STALE_PARTIAL]);
  });
});

describe('cents', () => {
  it('rounds half-cent dollar values the way Stripe amounts are built', () => {
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents('115.00')).toBe(11500);
    expect(cents(undefined)).toBe(0);
    // Same conversion the live refund call uses (`stripeRefund.js`), so the
    // report and the charge can never disagree about what a dollar value is.
    expect(cents(1010 / 100)).toBe(1010);
  });
});
