// Dispute Service (spec 037)
// Projects the Stripe Dispute lifecycle onto Jump's ledger: one `Dispute` row
// per Stripe dispute, resolved to exactly one Order through the order's
// PaymentTransaction (the same way RefundService.handleExternalRefund does),
// the money Stripe pulls back written as a `Refund` row so every existing
// money reader stays correct, the disputed tickets voided, and the organizer
// told.
//
// WHY the handlers look like this: Stripe redelivers `charge.dispute.*` events
// and does not guarantee order — `.closed` can arrive before
// `.funds_withdrawn`. Two rules make that safe:
//
//   1. Every event carries the whole dispute object, so a handler derives the
//      full desired state from the payload instead of applying a delta. Running
//      the same event twice is therefore a no-op.
//   2. `Dispute.lastEventAt` is monotonic: an event older than the newest one
//      already applied is recorded and ignored, so a late `.funds_withdrawn`
//      can never take money back out of an order whose dispute Jump won.

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import addOnService from './AddOnService.js';
import refundService from './RefundService.js';
import emailService from './EmailService.js';
import applicationDigestService from './ApplicationDigestService.js';
import { orderStatusFor } from './applicationOrderStatus.js';
import logger from '../utils/logger.js';

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const centsToMajor = (c) => round(Number(c || 0) / 100);
const REFUNDABLE_ORDER_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

class DisputeService {
  /** `charge.dispute.created | .updated | .funds_withdrawn | .funds_reinstated | .closed` */
  isDisputeEvent(event) {
    return typeof event?.type === 'string' && event.type.startsWith('charge.dispute.');
  }

  /**
   * Apply one verified `charge.dispute.*` event. Safe to call twice with the
   * same event and safe to call with events in any order.
   *
   * @param {Object} event - Stripe event (already signature-verified)
   * @returns {Promise<{ disputeId: string, applied: boolean }|null>}
   */
  async applyFromEvent(event) {
    const dispute = event?.data?.object;
    if (!dispute?.id) {
      logger.warn('Dispute webhook without a dispute object', { type: event?.type });
      return null;
    }

    const eventAt = new Date(Number(event.created || 0) * 1000);
    const existing = await prisma.dispute.findUnique({ where: { stripeDisputeId: dispute.id } });

    // The order never changes for a dispute, so a known dispute keeps its
    // resolution even if Stripe later sends a payload we could not resolve.
    const orderId = existing?.orderId ?? (await this._resolveOrderId(dispute));
    if (!orderId) {
      // Not ours (another platform's charge, or a payment Jump never recorded).
      // Loud, because a real dispute that lands here is money leaving with no
      // ledger entry — exactly what this service exists to prevent.
      logger.error('Dispute could not be resolved to an order', {
        event: 'dispute_unresolved',
        type: event.type,
        stripeDisputeId: dispute.id,
        charge: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
        paymentIntent: this._paymentIntentId(dispute),
      });
      return null;
    }

    if (existing && eventAt.getTime() < existing.lastEventAt.getTime()) {
      logger.info('Stale dispute event ignored', {
        event: 'dispute_event_stale',
        type: event.type,
        stripeDisputeId: dispute.id,
        eventAt,
        lastEventAt: existing.lastEventAt,
      });
      return { disputeId: existing.id, applied: false };
    }

    const derived = this._derive(dispute);
    const result = await prisma.$transaction((tx) =>
      this._apply(tx, { existing, orderId, dispute, derived, event, eventAt })
    );

    logger.info('Dispute applied', {
      event: 'dispute_applied',
      type: event.type,
      stripeDisputeId: dispute.id,
      orderId,
      state: derived.state,
      fundsWithdrawn: derived.fundsWithdrawn,
      amount: derived.amount,
      ticketsVoided: result.ticketsVoided,
      ticketsRestored: result.ticketsRestored,
      orderStatus: result.orderStatus,
    });

    // Outside the transaction, and only on a real transition, so a redelivered
    // event never re-sends the email.
    if (result.notify) {
      await this._notifyOrganizer(orderId, result.dispute, result.notify).catch((error) =>
        logger.error('Dispute notification failed', {
          event: 'dispute_notification_failed',
          stripeDisputeId: dispute.id,
          error: error.message,
        })
      );
    }

    return { disputeId: result.dispute.id, applied: true };
  }

  // ─── Derivation ───────────────────────────────────────

  /**
   * Order-independent facts read off the dispute object itself.
   *
   * `fundsWithdrawn` is the one that matters and it is deliberately not taken
   * from the event type: a lost dispute always has the money gone, a won one
   * always has it back, and while it is open the balance-transaction ledger on
   * the dispute says whether Stripe is holding it. An inquiry
   * (`warning_*` status) has no balance transactions at all — nothing has
   * moved, so nothing is voided.
   */
  _derive(dispute) {
    const status = String(dispute.status || '');
    const inquiry = status.startsWith('warning_');
    const state = status === 'won' || status === 'warning_closed' ? 'WON' : status === 'lost' ? 'LOST' : 'OPEN';
    const net = (dispute.balance_transactions || []).reduce((sum, bt) => sum + Number(bt.amount || 0), 0);
    const dueBy = dispute.evidence_details?.due_by;
    return {
      status,
      inquiry,
      state,
      fundsWithdrawn: state === 'LOST' ? true : state === 'WON' ? false : net < 0,
      amount: centsToMajor(dispute.amount),
      currency: String(dispute.currency || 'usd'),
      reason: dispute.reason || null,
      evidenceDueBy: dueBy ? new Date(Number(dueBy) * 1000) : null,
      openedAt: dispute.created ? new Date(Number(dispute.created) * 1000) : new Date(),
    };
  }

  _paymentIntentId(dispute) {
    return typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id ?? null;
  }

  /** PaymentTransaction → Order, the same resolution path as an external refund. */
  async _resolveOrderId(dispute) {
    let paymentIntentId = this._paymentIntentId(dispute);
    if (!paymentIntentId) {
      // Older payloads carry only the charge; Stripe is the source of truth for
      // which intent it belongs to.
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
      if (!chargeId) return null;
      try {
        const charge = await stripe.charges.retrieve(chargeId);
        paymentIntentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id ?? null;
      } catch (error) {
        logger.warn('Dispute charge lookup failed', { chargeId, error: error.message });
        return null;
      }
    }
    if (!paymentIntentId) return null;
    const payment = await prisma.paymentTransaction.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { orderId: true },
    });
    return payment?.orderId ?? null;
  }

  // ─── Projection ───────────────────────────────────────

  async _apply(tx, { existing, orderId, dispute, derived, event, eventAt }) {
    // Serialise against refunds and other dispute events on the same order.
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

    const common = {
      stripeStatus: derived.status,
      state: derived.state,
      inquiry: derived.inquiry,
      fundsWithdrawn: derived.fundsWithdrawn,
      reason: derived.reason,
      amount: derived.amount,
      currency: derived.currency,
      evidenceDueBy: derived.evidenceDueBy,
      closedAt: derived.state === 'OPEN' ? null : (existing?.closedAt ?? eventAt),
      lastEventAt: eventAt,
      lastEventType: event.type,
      lastEventId: event.id ?? null,
    };

    const row = await tx.dispute.upsert({
      where: { stripeDisputeId: dispute.id },
      create: {
        ...common,
        orderId,
        stripeDisputeId: dispute.id,
        stripeChargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null,
        stripePaymentIntentId: this._paymentIntentId(dispute),
        openedAt: derived.openedAt,
      },
      // `voidedTickets` / `closedAddOnIds` are owned by the handlers below.
      update: common,
    });

    const effect = derived.fundsWithdrawn
      ? await this._withdraw(tx, row)
      : await this._reinstate(tx, row);

    const orderStatus = await this._recomputeOrderStatus(tx, orderId);

    // Notify on a real transition only: a new dispute, or one that just closed.
    let notify = null;
    if (!existing) notify = 'opened';
    else if (existing.state !== derived.state && derived.state !== 'OPEN') notify = derived.state === 'WON' ? 'won' : 'lost';

    return { dispute: row, orderStatus, notify, ...effect };
  }

  /**
   * Stripe is holding the money. Project it as a Refund row (one per dispute,
   * enforced by the unique index) and take back what the buyer was sold.
   */
  async _withdraw(tx, row) {
    const amount = Number(row.amount);
    await tx.refund.upsert({
      where: { disputeId: row.id },
      create: {
        orderId: row.orderId,
        disputeId: row.id,
        amount,
        reason: `Chargeback${row.reason ? `: ${row.reason}` : ''}`,
        status: 'SUCCEEDED',
        initiatedBy: null,
      },
      // A dispute Jump lost after winning it (rare, but Stripe allows a
      // reopened inquiry) must count again.
      update: { status: 'SUCCEEDED', amount },
    });

    const order = await tx.order.findUnique({
      where: { id: row.orderId },
      select: { id: true, kind: true, totalAmount: true },
    });
    if (!order || order.kind === 'APPLICATION') return { ticketsVoided: 0, ticketsRestored: 0 };

    // Already taken care of by an earlier delivery of this dispute.
    const already = Array.isArray(row.voidedTickets) ? row.voidedTickets : [];
    if (already.length > 0) return { ticketsVoided: 0, ticketsRestored: 0 };

    // Void cheapest-first until the disputed amount is covered — the same rule
    // as an external partial refund, because Stripe does not say which line
    // the buyer disputed. A full chargeback therefore voids everything.
    const activeTickets = await tx.ticket.findMany({
      where: { orderId: order.id, status: { in: ['VALID', 'REDEEMED'] } },
      orderBy: { pricePaid: 'asc' },
      select: { id: true, status: true, pricePaid: true, priceTierId: true },
    });
    let remaining = amount;
    const voided = [];
    for (const ticket of activeTickets) {
      if (remaining <= 0) break;
      voided.push(ticket);
      remaining -= Number(ticket.pricePaid);
    }

    for (const ticket of voided) {
      await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'VOIDED' } });
    }
    const perTier = {};
    for (const ticket of voided) perTier[ticket.priceTierId] = (perTier[ticket.priceTierId] || 0) + 1;
    for (const [tierId, qty] of Object.entries(perTier)) {
      await tx.$executeRaw`UPDATE "PriceTier" SET "quantitySold" = "quantitySold" - ${qty} WHERE "id" = ${tierId}`;
    }

    // Add-on lines only when the chargeback took the whole order: a partial
    // dispute cannot say which line it was.
    let closedAddOnIds = [];
    if (amount + 1e-9 >= Number(order.totalAmount)) {
      const openLines = await tx.orderAddOn.findMany({ where: { orderId: order.id, refundedAt: null } });
      if (openLines.length > 0) {
        await tx.orderAddOn.updateMany({
          where: { id: { in: openLines.map((l) => l.id) } },
          data: { refundedAt: new Date() },
        });
        await addOnService.unsell(tx, openLines);
        closedAddOnIds = openLines.map((l) => l.id);
      }
    }

    await tx.dispute.update({
      where: { id: row.id },
      data: {
        voidedTickets: voided.map((t) => ({ id: t.id, status: t.status })),
        closedAddOnIds,
      },
    });

    return { ticketsVoided: voided.length, ticketsRestored: 0 };
  }

  /**
   * The money is back (dispute won, or an inquiry that never took it). Reverse
   * exactly what this dispute did and nothing else.
   */
  async _reinstate(tx, row) {
    await tx.refund.updateMany({
      where: { disputeId: row.id, status: 'SUCCEEDED' },
      // Not a Stripe refund failure: FAILED is how the ledger says "this
      // money-out did not stand", and it is what keeps the SUCCEEDED
      // aggregates (order net, analytics, tax report) correct.
      data: { status: 'FAILED', reason: 'Chargeback reversed: funds reinstated' },
    });

    const voided = Array.isArray(row.voidedTickets) ? row.voidedTickets : [];
    let restored = 0;
    for (const entry of voided) {
      if (!entry?.id) continue;
      // Only a ticket this dispute voided and that nothing else has touched.
      const ticket = await tx.ticket.findUnique({
        where: { id: entry.id },
        select: { id: true, status: true, priceTierId: true },
      });
      if (!ticket || ticket.status !== 'VOIDED') continue;
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: entry.status === 'REDEEMED' ? 'REDEEMED' : 'VALID' },
      });
      await tx.$executeRaw`UPDATE "PriceTier" SET "quantitySold" = "quantitySold" + 1 WHERE "id" = ${ticket.priceTierId}`;
      restored += 1;
    }

    const addOnIds = Array.isArray(row.closedAddOnIds) ? row.closedAddOnIds : [];
    if (addOnIds.length > 0) {
      const lines = await tx.orderAddOn.findMany({ where: { id: { in: addOnIds }, refundedAt: { not: null } } });
      if (lines.length > 0) {
        await tx.orderAddOn.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { refundedAt: null } });
        await addOnService.resell(tx, lines);
      }
    }

    if (voided.length > 0 || addOnIds.length > 0) {
      await tx.dispute.update({ where: { id: row.id }, data: { voidedTickets: [], closedAddOnIds: [] } });
    }

    return { ticketsVoided: 0, ticketsRestored: restored };
  }

  /**
   * Order.status from fresh ledger state. Jump deliberately does **not** add a
   * DISPUTED OrderStatus: money out is money out, the existing
   * REFUNDED / PARTIALLY_REFUNDED pair already means it, and a new enum value
   * would have to be taught to every consumer of PAID_ORDER_STATUSES. What
   * makes a chargeback legible instead is the `Dispute` row on the order (and
   * `Refund.disputeId` on the money-out line).
   */
  async _recomputeOrderStatus(tx, orderId) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, kind: true, status: true, totalAmount: true, applicationId: true },
    });
    // Never resurrect a PENDING / FAILED / CANCELLED order from a dispute.
    if (!order || !REFUNDABLE_ORDER_STATUSES.includes(order.status)) return order?.status ?? null;

    const [{ total: refundedRaw }] = await tx.$queryRaw`
      SELECT COALESCE(SUM("amount"), 0) AS total FROM "Refund"
      WHERE "orderId" = ${orderId} AND "status" = 'SUCCEEDED'::"RefundStatus"
    `;
    const refunded = Number(refundedRaw);
    const total = Number(order.totalAmount);

    if (order.kind === 'APPLICATION') {
      if (refunded > 0) {
        // Shares the one application projection (and its booth release).
        await refundService._recomputeApplicationOrderStatus(tx, orderId);
      } else if (order.applicationId) {
        const application = await tx.application.update({
          where: { id: order.applicationId },
          data: { paymentStatus: 'PAID' },
          select: { status: true, paymentStatus: true },
        });
        await tx.order.update({ where: { id: orderId }, data: { status: orderStatusFor(application) } });
      } else {
        await tx.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      }
      const after = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
      return after?.status ?? null;
    }

    const activeTickets = await tx.ticket.count({
      where: { orderId, status: { in: ['VALID', 'REDEEMED'] } },
    });
    const openAddOnLines = await tx.orderAddOn.count({ where: { orderId, refundedAt: null } });
    const [{ total: feesRetainedRaw }] = await tx.$queryRaw`
      SELECT COALESCE(SUM("feeAmount"), 0) AS total FROM "Refund"
      WHERE "orderId" = ${orderId} AND "status" = 'SUCCEEDED'::"RefundStatus"
    `;

    const status =
      refunded <= 0
        ? 'COMPLETED'
        : refunded + 1e-9 >= total && activeTickets === 0 && openAddOnLines === 0 && Number(feesRetainedRaw) <= 0
          ? 'REFUNDED'
          : 'PARTIALLY_REFUNDED';
    await tx.order.update({ where: { id: orderId }, data: { status } });
    return status;
  }

  // ─── Notification ─────────────────────────────────────

  /**
   * Tell the organizer. They otherwise find out from their payout, which is
   * the complaint this service answers.
   */
  async _notifyOrganizer(orderId, dispute, transition) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderRef: true,
        totalAmount: true,
        contact: { select: { firstName: true, lastName: true, email: true } },
        event: {
          select: {
            name: true,
            venue: { select: { organization: { select: { id: true, name: true, logoUrl: true } } } },
          },
        },
      },
    });
    const organization = order?.event?.venue?.organization;
    if (!organization) return;

    const recipients = await applicationDigestService.recipients(organization.id);
    if (recipients.length === 0) return;

    const money = `$${Number(dispute.amount).toFixed(2)}`;
    const buyer = [order.contact?.firstName, order.contact?.lastName].filter(Boolean).join(' ') || order.contact?.email || 'the buyer';
    const heading =
      transition === 'opened'
        ? `Chargeback opened on order ${order.orderRef}`
        : transition === 'won'
          ? `Chargeback reversed on order ${order.orderRef}`
          : `Chargeback lost on order ${order.orderRef}`;

    const lines = [
      transition === 'opened'
        ? `${buyer} disputed a ${money} card payment for ${order.event?.name ?? 'your event'}.`
        : transition === 'won'
          ? `The ${money} dispute on ${order.event?.name ?? 'your event'} was resolved in your favour. Stripe has returned the money.`
          : `The ${money} dispute on ${order.event?.name ?? 'your event'} was decided against you. Stripe has kept the money.`,
      '',
      `Order: ${order.orderRef}`,
      `Buyer: ${order.contact?.email ?? 'unknown'}`,
      dispute.reason ? `Stripe reason: ${dispute.reason}` : null,
      dispute.inquiry ? 'This is an inquiry, not yet a chargeback: no money has moved and the tickets still work.' : null,
      !dispute.inquiry && dispute.fundsWithdrawn ? `Stripe has withdrawn ${money} and the tickets on this order have been voided.` : null,
      transition === 'won' ? 'The tickets on this order have been restored.' : null,
      dispute.evidenceDueBy && transition === 'opened'
        ? `Evidence is due by ${dispute.evidenceDueBy.toISOString().slice(0, 10)} — respond in the Stripe Dashboard.`
        : null,
      '',
      'Jump records the dispute against the order; the response itself happens in Stripe.',
    ].filter((line) => line !== null);

    for (const to of recipients) {
      try {
        await emailService.sendApplicationMessage({
          to,
          subject: `${heading} — ${organization.name}`,
          body: lines.join('\n'),
          organization: { name: organization.name, logoUrl: organization.logoUrl },
        });
      } catch (error) {
        logger.error('Dispute email failed', { orderId, to, error: error.message });
      }
    }
    logger.info('Dispute notification sent', {
      event: 'dispute_notified',
      orderId,
      stripeDisputeId: dispute.stripeDisputeId,
      transition,
      recipients: recipients.length,
    });
  }

  // ─── Reconciliation ───────────────────────────────────

  /**
   * Both directions, for `npm run report:disputes` and the contract test.
   *
   * - `disputes` / `withMoneyOut`: every Dispute row, and how many of the ones
   *   holding money have their Refund projection.
   * - `missingProjection`: funds withdrawn with no SUCCEEDED Refund row — the
   *   drift this service exists to prevent.
   * - `orphanProjections`: a dispute Refund row whose dispute is gone or no
   *   longer holding money.
   * - `multiOrder`: a Stripe dispute mapped to more than one order (impossible
   *   by schema; counted so the claim is measured, not assumed).
   */
  async reconcile({ organizationId = null } = {}) {
    const where = organizationId
      ? { order: { event: { venue: { organizationId } } } }
      : {};
    const disputes = await prisma.dispute.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        stripeDisputeId: true,
        amount: true,
        state: true,
        fundsWithdrawn: true,
        refunds: { select: { id: true, amount: true, status: true } },
      },
    });

    const missingProjection = [];
    const orphanProjections = [];
    let withMoneyOut = 0;
    for (const d of disputes) {
      const live = d.refunds.filter((r) => r.status === 'SUCCEEDED');
      if (d.fundsWithdrawn) {
        withMoneyOut += 1;
        const matched = live.find((r) => Math.abs(Number(r.amount) - Number(d.amount)) < 0.005);
        if (!matched) missingProjection.push({ stripeDisputeId: d.stripeDisputeId, orderId: d.orderId, amount: Number(d.amount) });
      } else if (live.length > 0) {
        orphanProjections.push({ stripeDisputeId: d.stripeDisputeId, orderId: d.orderId, refundIds: live.map((r) => r.id) });
      }
    }

    // Other direction: Refund rows claiming a dispute that no longer exists.
    const danglingRefunds = await prisma.refund.count({
      where: { disputeId: { not: null }, dispute: { is: null } },
    });
    const orderIds = new Set(disputes.map((d) => d.orderId));

    return {
      disputes: disputes.length,
      orders: orderIds.size,
      withMoneyOut,
      missingProjection,
      orphanProjections,
      danglingRefunds,
      multiOrder: disputes.length - new Set(disputes.map((d) => d.stripeDisputeId)).size,
      clean: missingProjection.length === 0 && orphanProjections.length === 0 && danglingRefunds === 0,
    };
  }
}

export default new DisputeService();
