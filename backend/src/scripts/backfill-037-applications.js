/**
 * Spec 037 phase 5 (vendor apply-then-choose), decision D6: move in-flight
 * PAID-form applications onto the new flow.
 *
 *   DRAFT stuck at the card / pay step        → SUBMITTED + NOT_DUE (no card needed)
 *   SUBMITTED / WAITLISTED with a saved card  → NOT_DUE; the card is kept and offered at selection
 *   APPROVED with a slot, unpaid (PAYMENT_DUE) → AWAITING_SELECTION: the category (tierId) stays,
 *                                                the slot stays when the form reserves on approval,
 *                                                held add-ons and a held booth are released,
 *                                                an open pay-now Checkout is expired
 *   PENDING application orders with no successful payment → CANCELLED (reopened at selection)
 *
 * Never touched: anything where money moved (PAID / refunded / a SUCCEEDED
 * payment row / a COMPLETED order, waived balances included), FREE forms,
 * rejected / withdrawn rows, rows already on the new flow, and PROCESSING rows
 * (a charge in flight — reported; run the script again once it settles).
 *
 * Idempotent: a moved row is in a new-flow state, so a second run finds
 * nothing to do. Emails are not sent; opt-ins recorded on a DRAFT are applied
 * (spec 024 phase 3: they apply when the application first reaches SUBMITTED).
 *
 * Usage (dry run unless DRY_RUN=false, like db:backfill:event-descriptions):
 *   cd backend && npm run db:backfill:037-applications
 *   cd backend && DRY_RUN=false npm run db:backfill:037-applications
 * Run it right after the phase 5 deploy (both migrations applied).
 */

import 'dotenv/config';
import { prisma } from '@jump/db';
import addOnService from '../services/AddOnService.js';
import boothService from '../services/BoothService.js';
import contactOptInService from '../services/ContactOptInService.js';
import applicationPaymentService from '../services/ApplicationPaymentService.js';
import { orderStatusFor } from '../services/applicationOrderStatus.js';

const MONEY_MOVED = new Set(['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const SETTLED_ORDER = new Set(['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const NEW_FLOW = new Set(['NOT_DUE', 'AWAITING_SELECTION']);

const ROW_SELECT = {
  id: true,
  status: true,
  paymentStatus: true,
  capacitySlot: true,
  tierId: true,
  submittedAt: true,
  createdAt: true,
  stripePaymentMethodId: true,
  stripeCheckoutSessionId: true,
  selectionHeldUntil: true,
  form: { select: { kind: true, name: true, reserveOnApproval: true } },
  event: { select: { name: true } },
  profile: { select: { businessName: true } },
  order: { select: { id: true, orderRef: true, status: true, payment: { select: { status: true } } } },
};

/**
 * Pure decision for one application (no database): what the move does.
 * @returns {{ action: 'SKIP'|'DRAFT_TO_SUBMITTED'|'TO_NOT_DUE'|'TO_AWAITING_SELECTION'|'REPORT', reason: string, cancelOrder?: boolean, keepSlot?: boolean }}
 */
export function planApplicationMove(row) {
  if (row.form?.kind !== 'PAID') return { action: 'SKIP', reason: 'FREE form' };
  const order = row.order;
  if (
    MONEY_MOVED.has(row.paymentStatus) ||
    (order && SETTLED_ORDER.has(order.status)) ||
    order?.payment?.status === 'SUCCEEDED'
  ) {
    return { action: 'SKIP', reason: 'Money has moved (paid, refunded or waived)' };
  }
  if (NEW_FLOW.has(row.paymentStatus) || row.selectionHeldUntil) return { action: 'SKIP', reason: 'Already on apply-then-choose' };
  if (['REJECTED', 'WITHDRAWN'].includes(row.status)) return { action: 'SKIP', reason: `${row.status.toLowerCase()}` };
  if (row.paymentStatus === 'PROCESSING') return { action: 'REPORT', reason: 'A charge is in flight; run again once it settles' };
  const cancelOrder = Boolean(order && order.status !== 'CANCELLED');

  if (row.status === 'DRAFT') {
    return { action: 'DRAFT_TO_SUBMITTED', reason: `DRAFT at ${row.paymentStatus} → SUBMITTED without a card step`, cancelOrder };
  }
  if (['SUBMITTED', 'WAITLISTED'].includes(row.status)) {
    return {
      action: 'TO_NOT_DUE',
      reason: `${row.status} at ${row.paymentStatus} → NOT_DUE${row.stripePaymentMethodId ? ' (saved card kept)' : ''}`,
      cancelOrder,
    };
  }
  if (row.status === 'APPROVED') {
    if (!row.tierId) return { action: 'REPORT', reason: 'Approved without a category; assign one by hand' };
    if (row.paymentStatus !== 'PAYMENT_DUE') return { action: 'REPORT', reason: `Unexpected approved state ${row.paymentStatus}` };
    const keepSlot = row.form.reserveOnApproval !== false;
    return {
      action: 'TO_AWAITING_SELECTION',
      reason: `APPROVED at PAYMENT_DUE → AWAITING_SELECTION (${keepSlot ? 'slot kept' : 'slot released'})`,
      cancelOrder,
      keepSlot,
    };
  }
  return { action: 'REPORT', reason: `Unexpected state ${row.status} / ${row.paymentStatus}` };
}

/** Apply one planned move inside a transaction, re-reading the row under a lock. */
async function applyMove(applicationId) {
  const expireSession = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
    const row = await tx.application.findUnique({ where: { id: applicationId }, select: ROW_SELECT });
    const plan = row ? planApplicationMove(row) : { action: 'SKIP' };
    if (!['DRAFT_TO_SUBMITTED', 'TO_NOT_DUE', 'TO_AWAITING_SELECTION'].includes(plan.action)) return null;

    const data = {};
    if (plan.action === 'DRAFT_TO_SUBMITTED') {
      Object.assign(data, { status: 'SUBMITTED', submittedAt: row.submittedAt ?? row.createdAt, paymentStatus: 'NOT_DUE', stripeCheckoutSessionId: null });
    } else if (plan.action === 'TO_NOT_DUE') {
      Object.assign(data, { paymentStatus: 'NOT_DUE', stripeCheckoutSessionId: null });
    } else {
      // Add-ons reserved with the approval slot go back (they are chosen again at selection).
      if (row.capacitySlot === 'RESERVED' && row.order && row.order.status !== 'CANCELLED') {
        const lines = await tx.orderAddOn.findMany({ where: { orderId: row.order.id }, select: { addOnId: true, quantity: true } });
        if (lines.length) await addOnService.release(tx, lines);
      }
      let capacitySlot = row.capacitySlot;
      if (!plan.keepSlot && capacitySlot === 'RESERVED') {
        await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0) WHERE "id" = ${row.tierId}`;
        capacitySlot = 'NONE';
      }
      // A HELD booth goes back; a booth staff placed (SOLD) stays the vendor's space.
      await boothService.releaseHoldOnFailure(applicationId, { tx });
      Object.assign(data, { paymentStatus: 'AWAITING_SELECTION', capacitySlot, selectionHeldUntil: null, stripeCheckoutSessionId: null });
    }
    const updated = await tx.application.update({ where: { id: applicationId }, data, select: { status: true, paymentStatus: true, order: { select: { id: true } } } });
    // Order.status from the same mapping as every other write (NOT_DUE / AWAITING_SELECTION → CANCELLED).
    if (updated.order) await tx.order.update({ where: { id: updated.order.id }, data: { status: orderStatusFor(updated) } });
    if (plan.action === 'DRAFT_TO_SUBMITTED') await contactOptInService.applyForApplication(tx, applicationId);
    return row.stripeCheckoutSessionId;
  });
  // An open Checkout for the old amount must not complete (best effort; test-mode Stripe in prod).
  if (expireSession) await applicationPaymentService.expireCheckoutSession(expireSession).catch(() => {});
}

/**
 * @param {{ dryRun?: boolean, log?: (msg: string) => void, applicationIds?: string[]|null }} [opts]
 *   `applicationIds` scopes the run (tests); default every application.
 * @returns {Promise<{ checked: number, planned: Record<string, number>, moved: number, reported: number }>}
 */
export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log, applicationIds = null } = {}) {
  log(`[037-applications] Apply-then-choose backfill — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  const rows = await prisma.application.findMany({
    where: { form: { kind: 'PAID' }, ...(applicationIds ? { id: { in: applicationIds } } : {}) },
    select: ROW_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const planned = {};
  let moved = 0;
  let reported = 0;
  for (const row of rows) {
    const plan = planApplicationMove(row);
    planned[plan.action] = (planned[plan.action] ?? 0) + 1;
    if (plan.action === 'SKIP') continue;
    const who = `${row.profile?.businessName ?? '?'} · ${row.event?.name ?? '?'} · ${row.form.name}`;
    const order = row.order ? ` · order ${row.order.orderRef} ${row.order.status}${plan.cancelOrder ? ' → CANCELLED' : ''}` : '';
    log(`  ${plan.action.padEnd(22)} ${row.id}  ${who}${order}\n      ${plan.reason}`);
    if (plan.action === 'REPORT') {
      reported += 1;
      continue;
    }
    if (!dryRun) {
      await applyMove(row.id);
      moved += 1;
    }
  }
  log('');
  log(`[037-applications] Checked ${rows.length} PAID-form application(s): ${Object.entries(planned).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  log(`[037-applications] ${dryRun ? 'Would move' : 'Moved'} ${dryRun ? rows.length - (planned.SKIP ?? 0) - reported : moved}; needs a look: ${reported}`);
  if (dryRun && rows.length - (planned.SKIP ?? 0) - reported > 0) log('  → Run with DRY_RUN=false to write.');
  return { checked: rows.length, planned, moved, reported };
}

// Run when invoked directly (not imported), like the other backfill scripts.
import { fileURLToPath } from 'url';
import path from 'path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[037-applications] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
