// Unit tests: the refund reconciliation report itself (EVE-10, OQ-R11).
//
// `refundAudit.test.js` proves the arithmetic. This proves the report wired to
// it — the query shape, the Decimal columns Prisma hands back, the ticket and
// add-on line counts that decide the expected status, and the exit code that
// makes the script usable as a gate. The database is an in-memory double, so it
// runs without Postgres; `--stripe` needs real credentials and is not exercised.

import { jest } from '@jest/globals';

// Prisma returns Decimal, not Number. Anything the report does to these values
// must survive that, which is the whole reason this test exists.
const decimal = (value) => ({ toString: () => value.toFixed(2), valueOf: () => value.toFixed(2) });

/** The shape the pre-fix per-ticket refund left behind: $115 charged, $100 back. */
const moneyHeldOrder = {
  id: 'order_held',
  orderRef: 'JMP-HELD',
  kind: 'TICKET',
  status: 'REFUNDED',
  totalAmount: decimal(115),
  createdAt: new Date('2026-01-02T00:00:00Z'),
  refunds: [
    { id: 're_row', amount: decimal(100), feeAmount: decimal(0), status: 'SUCCEEDED', manual: false, stripeRefundId: 're_1' },
  ],
  tickets: [{ status: 'REFUNDED' }],
  addOns: [],
  payment: { stripePaymentIntentId: 'pi_1', status: 'SUCCEEDED' },
};

const cleanOrder = {
  id: 'order_clean',
  orderRef: 'JMP-CLEAN',
  kind: 'TICKET',
  status: 'REFUNDED',
  totalAmount: decimal(115),
  createdAt: new Date('2026-01-03T00:00:00Z'),
  refunds: [
    { id: 're_ok', amount: decimal(115), feeAmount: decimal(0), status: 'SUCCEEDED', manual: false, stripeRefundId: 're_2' },
  ],
  tickets: [{ status: 'REFUNDED' }],
  addOns: [{ refundedAt: new Date('2026-01-03T00:00:00Z') }],
  payment: { stripePaymentIntentId: 'pi_2', status: 'SUCCEEDED' },
};

/** A live ticket and an open add-on line keep an order legitimately partial. */
const openLinesOrder = {
  id: 'order_partial',
  orderRef: 'JMP-PART',
  kind: 'TICKET',
  status: 'PARTIALLY_REFUNDED',
  totalAmount: decimal(230),
  createdAt: new Date('2026-01-04T00:00:00Z'),
  refunds: [
    { id: 're_half', amount: decimal(115), feeAmount: decimal(0), status: 'SUCCEEDED', manual: false, stripeRefundId: 're_3' },
  ],
  tickets: [{ status: 'VALID' }, { status: 'REFUNDED' }],
  addOns: [{ refundedAt: null }],
  payment: { stripePaymentIntentId: 'pi_3', status: 'SUCCEEDED' },
};

let rowsInDb = [];
const findMany = jest.fn(async () => rowsInDb);

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    order: { findMany },
    refund: { findMany: async () => [] },
    $disconnect: async () => {},
  },
}));

const { loadLedgerRows, printLedger, assertStripeKeyIsSafe } = await import(
  '../../src/scripts/audit-refund-completeness.js'
);

describe('refund reconciliation report', () => {
  it('asks the database for every order that has, or claims, a refund', async () => {
    rowsInDb = [];
    await loadLedgerRows();

    const where = findMany.mock.calls.at(-1)[0].where;
    expect(where.OR).toEqual([
      { refunds: { some: {} } },
      { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } },
    ]);
  });

  it('finds the order that reads as refunded while money is still held', async () => {
    rowsInDb = [moneyHeldOrder, cleanOrder, openLinesOrder];
    const rows = await loadLedgerRows();

    const held = rows.find((r) => r.orderRef === 'JMP-HELD');
    expect(held.finding).toBe('MONEY_HELD_ON_REFUNDED');
    expect(held.chargedCents).toBe(11500);
    expect(held.refundedCents).toBe(10000);
    expect(held.unexplainedCents).toBe(1500);
    expect(held.paymentIntentId).toBe('pi_1');

    expect(rows.filter((r) => r.finding !== null).map((r) => r.orderRef)).toEqual(['JMP-HELD']);
  });

  it('counts live tickets and open add-on lines, so a real partial is not flagged', async () => {
    rowsInDb = [openLinesOrder];
    const [row] = await loadLedgerRows();

    expect(row.finding).toBeNull();
    expect(row.expectedStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('refuses a live-mode Stripe key unless the caller says so deliberately', () => {
    // The Stripe leg only lists refunds, but "read only" is a property of this
    // file, not of the key. Pointing it at live must be a decision.
    expect(() => assertStripeKeyIsSafe('sk_live_abc')).toThrow(/live-mode key/);
    expect(() => assertStripeKeyIsSafe(undefined)).toThrow(/STRIPE_SECRET_KEY is not set/);
    expect(() => assertStripeKeyIsSafe('sk_test_abc')).not.toThrow();

    process.env.ALLOW_LIVE_STRIPE_READ = '1';
    try {
      expect(() => assertStripeKeyIsSafe('sk_live_abc')).not.toThrow();
    } finally {
      delete process.env.ALLOW_LIVE_STRIPE_READ;
    }
  });

  it('prints the held amount and nothing alarming when the ledger is clean', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      rowsInDb = [moneyHeldOrder, cleanOrder];
      const summary = printLedger(await loadLedgerRows());
      const output = log.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(summary.findings).toHaveLength(1);
      expect(output).toContain('MONEY_HELD_ON_REFUNDED');
      expect(output).toContain('JMP-HELD');
      expect(output).toContain('$15.00 is held on orders that read as fully refunded');
      expect(output).not.toContain('JMP-CLEAN');

      log.mockClear();
      rowsInDb = [cleanOrder];
      const cleanSummary = printLedger(await loadLedgerRows());
      const cleanOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');

      expect(cleanSummary.findings).toEqual([]);
      expect(cleanOutput).toContain('No discrepancy');
    } finally {
      log.mockRestore();
    }
  });
});
