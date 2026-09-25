/**
 * Refund reconciliation report. READ ONLY — no row is written, no Stripe object
 * is created, captured, refunded or modified.
 *
 * Two directions, because matching totals is not reconciliation:
 *
 *   Ledger side (always runs, database only)
 *     Every order that has a refund, or claims one in its status, is checked
 *     against the money that actually went back. The row this exists to find is
 *     an order marked REFUNDED while part of the charge is still held: the
 *     buyer has been told they were repaid and was not. Before the fix in
 *     `RefundService` (REFUNDED now means the money is back, not that every
 *     line is closed), a per-ticket staff refund on an order carrying fees and
 *     tax produced exactly that row — and then refused to return the remainder
 *     with 409 "already been fully refunded".
 *
 *   Stripe side (--stripe)
 *     Every `Refund` row is matched to a Stripe refund and every Stripe refund
 *     back to a `Refund` row, so a dashboard refund, a dispute Stripe took back
 *     on its own, or an amount that drifted shows up on whichever side is
 *     missing it. Counted both ways.
 *
 * Usage:
 *   cd backend && npm run report:refunds
 *   cd backend && npm run report:refunds -- --stripe            # add the Stripe comparison
 *   cd backend && npm run report:refunds -- --stripe --since=2026-01-01
 *   cd backend && npm run report:refunds -- --json              # machine-readable
 *
 * Against production, where DATABASE_URL points at an internal host:
 *   railway ssh --service backend "node backend/src/scripts/audit-refund-completeness.js"
 *
 * Exit code is 1 when anything was found, so it can gate a deploy or a merge.
 *
 * A live-mode Stripe key is refused unless ALLOW_LIVE_STRIPE_READ=1 is set
 * explicitly. The Stripe calls here are list reads only, but "read only" is a
 * property of this file, not of the key — the guard makes the choice deliberate.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { prisma } from '@jump/db';
import { classifyOrder, reconcileRefunds, summarize, cents, FINDINGS } from '../services/refundAudit.js';

const args = process.argv.slice(2);
const WANT_STRIPE = args.includes('--stripe');
const AS_JSON = args.includes('--json');
const SINCE = (() => {
  const raw = args.find((a) => a.startsWith('--since='))?.slice('--since='.length);
  if (raw) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error(`--since must be YYYY-MM-DD, got "${raw}"`);
    return parsed;
  }
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
})();

const usd = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;

const EXPLAIN = {
  [FINDINGS.MONEY_HELD_ON_REFUNDED]:
    'Marked REFUNDED with part of the charge still held. The buyer is owed this money and has been told they are not.',
  [FINDINGS.OVER_REFUNDED]: 'More went back than was ever charged.',
  [FINDINGS.REFUND_ON_UNREFUNDED_ORDER]:
    'Money went back but the order status does not say so — an out-of-band Stripe refund or a dispute.',
  [FINDINGS.STALE_PARTIAL]: 'Every line is closed and the whole charge is back, but the status still says partial.',
};

export async function loadLedgerRows() {
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ refunds: { some: {} } }, { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] } }],
    },
    select: {
      id: true,
      orderRef: true,
      kind: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      refunds: { select: { id: true, amount: true, feeAmount: true, status: true, manual: true, stripeRefundId: true } },
      tickets: { select: { status: true } },
      addOns: { select: { refundedAt: true } },
      payment: { select: { stripePaymentIntentId: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return orders.map((order) => ({
    ...classifyOrder({
      id: order.id,
      orderRef: order.orderRef,
      status: order.status,
      totalAmount: order.totalAmount,
      refunds: order.refunds,
      activeTicketCount: order.tickets.filter((t) => t.status === 'VALID' || t.status === 'REDEEMED').length,
      openAddOnLineCount: order.addOns.filter((a) => a.refundedAt === null).length,
    }),
    kind: order.kind,
    createdAt: order.createdAt,
    paymentIntentId: order.payment?.stripePaymentIntentId ?? null,
    refunds: order.refunds,
  }));
}

export function assertStripeKeyIsSafe(key) {
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set — drop --stripe or set a test-mode key.');
  if (key.startsWith('sk_live') && process.env.ALLOW_LIVE_STRIPE_READ !== '1') {
    throw new Error(
      'STRIPE_SECRET_KEY is a live-mode key. This report only lists refunds, but rerun with ' +
        'ALLOW_LIVE_STRIPE_READ=1 to say so deliberately.'
    );
  }
}

async function stripeComparison(rows) {
  assertStripeKeyIsSafe(process.env.STRIPE_SECRET_KEY);
  const { stripe } = await import('../config/stripe.js');

  // Direction 1: every Refund row we hold → a Stripe refund on that intent.
  const perOrder = [];
  for (const row of rows) {
    const dbRefunds = row.refunds.map((r) => ({ ...r, orderRef: row.orderRef }));
    if (dbRefunds.every((r) => r.manual)) continue;
    if (!row.paymentIntentId) {
      perOrder.push({
        orderRef: row.orderRef,
        result: reconcileRefunds({ dbRefunds, stripeRefunds: [] }),
        note: 'order has no Stripe payment intent',
      });
      continue;
    }
    const list = await stripe.refunds.list({ payment_intent: row.paymentIntentId, limit: 100 });
    perOrder.push({ orderRef: row.orderRef, result: reconcileRefunds({ dbRefunds, stripeRefunds: list.data }) });
  }

  // Direction 2: every refund Stripe has since --since → a Refund row we hold.
  const known = new Set(
    (await prisma.refund.findMany({ where: { stripeRefundId: { not: null } }, select: { stripeRefundId: true } })).map(
      (r) => r.stripeRefundId
    )
  );
  const unknownInStripe = [];
  let stripeSeen = 0;
  for await (const refund of stripe.refunds.list({ limit: 100, created: { gte: Math.floor(SINCE.getTime() / 1000) } })) {
    stripeSeen += 1;
    if (refund.status !== 'succeeded') continue;
    if (!known.has(refund.id)) {
      unknownInStripe.push({ id: refund.id, amount: refund.amount, charge: refund.charge, created: refund.created });
    }
  }

  return { perOrder, stripeSeen, unknownInStripe };
}

export function printLedger(rows) {
  const summary = summarize(rows);
  console.log(`\nLedger side — ${summary.total} order(s) with a refund or a refund status, ${summary.clean} clean.`);

  if (summary.findings.length === 0) {
    console.log('No discrepancy: every refund status matches the money that went back.');
    return summary;
  }

  for (const group of summary.findings) {
    console.log(`\n${group.finding} — ${group.rows.length} order(s)`);
    console.log(EXPLAIN[group.finding]);
    console.log(
      `\n  ${'Order'.padEnd(16)} ${'Kind'.padEnd(12)} ${'Status'.padEnd(20)} ${'Charged'.padStart(10)} ${'Refunded'.padStart(10)} ${'Kept fee'.padStart(10)} ${'Unexplained'.padStart(12)} Expected`
    );
    console.log(`  ${'-'.repeat(108)}`);
    for (const row of group.rows) {
      console.log(
        `  ${String(row.orderRef).padEnd(16)} ${String(row.kind).padEnd(12)} ${row.status.padEnd(20)} ` +
          `${usd(row.chargedCents).padStart(10)} ${usd(row.refundedCents).padStart(10)} ` +
          `${usd(row.retainedFeeCents).padStart(10)} ${usd(row.unexplainedCents).padStart(12)} ${row.expectedStatus ?? '—'}`
      );
    }
  }

  const owed = summary.findings
    .filter((g) => g.finding === FINDINGS.MONEY_HELD_ON_REFUNDED)
    .flatMap((g) => g.rows)
    .reduce((sum, r) => sum + Math.max(0, r.unreturnedCents), 0);
  if (owed > 0) {
    console.log(`\n${usd(owed)} is held on orders that read as fully refunded. Return it in Stripe, then re-run.`);
  }
  return summary;
}

function printStripe(comparison) {
  const missingInStripe = comparison.perOrder.flatMap((o) => o.result.missingInStripe);
  const mismatches = comparison.perOrder.flatMap((o) => o.result.amountMismatches);
  const matched = comparison.perOrder.reduce((sum, o) => sum + o.result.matchedCount, 0);
  const offline = comparison.perOrder.reduce((sum, o) => sum + o.result.offlineCount, 0);

  console.log(
    `\nStripe side — ${matched} refund(s) matched, ${offline} offline row(s) skipped, ` +
      `${comparison.stripeSeen} Stripe refund(s) seen since ${SINCE.toISOString().slice(0, 10)}.`
  );
  if (missingInStripe.length === 0 && mismatches.length === 0 && comparison.unknownInStripe.length === 0) {
    console.log('Both directions balance: every refund row maps to one Stripe refund and back.');
    return { missingInStripe, mismatches, unknownInStripe: comparison.unknownInStripe };
  }

  for (const row of missingInStripe) {
    console.log(`  Refund row with no Stripe refund: ${row.orderRef} ${usd(cents(row.amount))} (${row.reason})`);
  }
  for (const row of mismatches) {
    console.log(
      `  Amount drift: ${row.orderRef} ${row.stripeRefundId} db ${usd(row.dbAmountCents)} vs Stripe ${usd(row.stripeAmount)}`
    );
  }
  for (const row of comparison.unknownInStripe) {
    console.log(
      `  Stripe refund with no Refund row: ${row.id} ${usd(row.amount)} on ${row.charge} ` +
        `(${new Date(row.created * 1000).toISOString().slice(0, 10)}) — dashboard refund or dispute`
    );
  }
  return { missingInStripe, mismatches, unknownInStripe: comparison.unknownInStripe };
}

export async function main() {
  const rows = await loadLedgerRows();
  const comparison = WANT_STRIPE ? await stripeComparison(rows) : null;

  if (AS_JSON) {
    console.log(JSON.stringify({ since: SINCE.toISOString(), ledger: summarize(rows), stripe: comparison }, null, 2));
  } else {
    const summary = printLedger(rows);
    if (comparison) printStripe(comparison);
    if (!WANT_STRIPE) console.log('\nStripe not compared. Re-run with --stripe for the other direction.');
    console.log();
    if (summary.findings.length > 0) process.exitCode = 1;
  }

  if (comparison) {
    const broken =
      comparison.unknownInStripe.length > 0 ||
      comparison.perOrder.some((o) => o.result.missingInStripe.length > 0 || o.result.amountMismatches.length > 0);
    if (broken) process.exitCode = 1;
  }

  await prisma.$disconnect();
}

// Only when run as a script — `loadLedgerRows` is imported by
// tests/unit/refundAuditReport.test.js, which must not open a connection.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error.message ?? error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
