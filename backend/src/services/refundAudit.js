// Refund reconciliation, in both directions. PURE — no database, no Stripe.
//
// Two questions, and matching totals answers neither of them:
//
//   1. Does every order's status agree with the money that actually went back?
//      An order marked REFUNDED while part of the charge is still held is a
//      buyer who has been told they were repaid and was not — and, before the
//      fix in `RefundService`, the supported way to return the rest was shut
//      (409 "already been fully refunded"). That is the class of row this
//      module exists to find.
//   2. Does every refund map to exactly one Stripe refund, and every Stripe
//      refund to exactly one `Refund` row? A refund issued from the Stripe
//      dashboard, or a dispute Stripe took back on its own, exists on one side
//      only.
//
// Integer minor units everywhere. `Refund.amount` is what went back to the
// buyer; `Refund.feeAmount` is the disclosed policy fee the organization kept
// (spec 031), which is money legitimately not returned — so it is reported
// separately rather than counted as a discrepancy.

/** Decimal | string | number dollars → integer cents. */
export function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

export const FINDINGS = {
  /** status REFUNDED, but the buyer does not have all of the charge back. */
  MONEY_HELD_ON_REFUNDED: 'MONEY_HELD_ON_REFUNDED',
  /** Every line closed and the charge fully back, but status says otherwise. */
  STALE_PARTIAL: 'STALE_PARTIAL',
  /** More went back than was ever charged. */
  OVER_REFUNDED: 'OVER_REFUNDED',
  /** Money went back on an order whose status does not mention a refund. */
  REFUND_ON_UNREFUNDED_ORDER: 'REFUND_ON_UNREFUNDED_ORDER',
};

const REFUND_STATUSES = new Set(['REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * Classify one order against its refunds.
 *
 * `expectedStatus` reproduces the rule in `RefundService` exactly — REFUNDED
 * only when no line is open *and* the whole charge is back — so a row with a
 * finding is a row the current code would not produce.
 *
 * @param {{
 *   id?: string, orderRef?: string, status: string, totalAmount: number|string,
 *   refunds: Array<{ amount: number|string, feeAmount?: number|string, status?: string }>,
 *   activeTicketCount?: number, openAddOnLineCount?: number,
 * }} order
 * @returns {{
 *   id: string|undefined, orderRef: string|undefined, status: string,
 *   chargedCents: number, refundedCents: number, retainedFeeCents: number,
 *   unreturnedCents: number, unexplainedCents: number,
 *   expectedStatus: string|null, finding: string|null,
 * }}
 */
export function classifyOrder(order) {
  const succeeded = (order.refunds ?? []).filter((r) => (r.status ?? 'SUCCEEDED') === 'SUCCEEDED');
  const chargedCents = cents(order.totalAmount);
  const refundedCents = succeeded.reduce((sum, r) => sum + cents(r.amount), 0);
  const retainedFeeCents = succeeded.reduce((sum, r) => sum + cents(r.feeAmount), 0);

  // Money that is not with the buyer, and the part of it nothing accounts for.
  const unreturnedCents = chargedCents - refundedCents;
  const unexplainedCents = unreturnedCents - retainedFeeCents;

  const linesClosed = (order.activeTicketCount ?? 0) === 0 && (order.openAddOnLineCount ?? 0) === 0;
  const expectedStatus =
    refundedCents === 0 && retainedFeeCents === 0
      ? null // no money moved back; this module makes no claim about the status
      : linesClosed && unreturnedCents <= 0
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

  let finding = null;
  if (refundedCents > chargedCents) {
    finding = FINDINGS.OVER_REFUNDED;
  } else if (order.status === 'REFUNDED' && unreturnedCents > 0) {
    finding = FINDINGS.MONEY_HELD_ON_REFUNDED;
  } else if (refundedCents > 0 && !REFUND_STATUSES.has(order.status)) {
    finding = FINDINGS.REFUND_ON_UNREFUNDED_ORDER;
  } else if (order.status === 'PARTIALLY_REFUNDED' && expectedStatus === 'REFUNDED') {
    finding = FINDINGS.STALE_PARTIAL;
  }

  return {
    id: order.id,
    orderRef: order.orderRef,
    status: order.status,
    chargedCents,
    refundedCents,
    retainedFeeCents,
    unreturnedCents,
    unexplainedCents,
    expectedStatus,
    finding,
  };
}

/**
 * Match `Refund` rows against Stripe refund objects, counting both ways.
 *
 * A `manual: true` row is an offline refund (cheque, cash) that never had a
 * Stripe call, so it is excluded from the Stripe side rather than reported as
 * missing.
 *
 * @param {{
 *   dbRefunds: Array<{ id?: string, orderRef?: string, stripeRefundId?: string|null, amount: number|string, status?: string, manual?: boolean }>,
 *   stripeRefunds: Array<{ id: string, amount: number, status?: string }>,
 * }} input
 * @returns {{ matchedCount: number, missingInStripe: Array, missingInDb: Array, amountMismatches: Array, offlineCount: number }}
 */
export function reconcileRefunds({ dbRefunds = [], stripeRefunds = [] }) {
  const stripeById = new Map(
    stripeRefunds.filter((r) => (r.status ?? 'succeeded') === 'succeeded').map((r) => [r.id, r])
  );
  const seen = new Set();
  const missingInStripe = [];
  const amountMismatches = [];
  let matchedCount = 0;
  let offlineCount = 0;

  for (const row of dbRefunds) {
    if ((row.status ?? 'SUCCEEDED') !== 'SUCCEEDED') continue;
    if (row.manual) {
      offlineCount += 1;
      continue;
    }
    const match = row.stripeRefundId ? stripeById.get(row.stripeRefundId) : undefined;
    if (!match) {
      missingInStripe.push({ ...row, reason: row.stripeRefundId ? 'not_found_in_stripe' : 'no_stripe_refund_id' });
      continue;
    }
    seen.add(match.id);
    matchedCount += 1;
    if (cents(row.amount) !== match.amount) {
      amountMismatches.push({ ...row, stripeAmount: match.amount, dbAmountCents: cents(row.amount) });
    }
  }

  // The other direction: a dashboard refund or a dispute nobody recorded.
  const missingInDb = [...stripeById.values()].filter((r) => !seen.has(r.id));

  return { matchedCount, missingInStripe, missingInDb, amountMismatches, offlineCount };
}

/** Group classified rows by finding, most serious first. */
export function summarize(rows) {
  const order = [
    FINDINGS.MONEY_HELD_ON_REFUNDED,
    FINDINGS.OVER_REFUNDED,
    FINDINGS.REFUND_ON_UNREFUNDED_ORDER,
    FINDINGS.STALE_PARTIAL,
  ];
  const byFinding = new Map(order.map((f) => [f, []]));
  let clean = 0;
  for (const row of rows) {
    if (!row.finding) {
      clean += 1;
      continue;
    }
    byFinding.get(row.finding).push(row);
  }
  return {
    total: rows.length,
    clean,
    findings: order.map((finding) => ({ finding, rows: byFinding.get(finding) })).filter((g) => g.rows.length > 0),
  };
}
