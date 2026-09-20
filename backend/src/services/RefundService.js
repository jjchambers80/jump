// Refund Service
// Handles full-order, per-ticket, per-add-on-line and application-order
// refunds via Stripe. Creates append-only Refund ledger records, voids
// tickets, restores inventory. Spec 024: application orders (kind
// APPLICATION) are refunded by amount — partial or full, no tickets, no
// capacity change — and an offline-paid one records a manual refund without
// a Stripe call.

import { prisma } from '@jump/db';
import { createStripeRefund } from './stripeRefund.js';
import addOnService from './AddOnService.js';
import logger from '../utils/logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler.js';
import { orderStatusFor } from './applicationOrderStatus.js';

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

class RefundService {
  /**
   * Refund an entire order: all tickets voided, full amount returned.
   * Application orders (spec 024) take an optional `amount` for a partial refund.
   *
   * @param {string} orderId
   * @param {{ amount?: number|null, reason?: string, initiatedBy?: string }} options
   * @returns {Promise<Object>} Refund record
   */
  async refundOrder(orderId, { amount = null, reason = null, initiatedBy = null } = {}) {
    const kindRow = await prisma.order.findUnique({
      where: { id: orderId },
      select: { kind: true },
    });
    if (!kindRow) throw new NotFoundError('Order not found');
    if (kindRow.kind === 'APPLICATION')
      return this._refundApplicationOrder(orderId, { amount, reason, initiatedBy });
    if (amount !== null && amount !== undefined)
      throw new ValidationError(
        'Ticket orders are refunded per ticket, per add-on line, or in full'
      );

    // Everything inside one transaction: lock, validate, create PENDING record, call Stripe, finalize
    const result = await prisma.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent refunds
      const [order] = await tx.$queryRaw`
        SELECT o.*, p."stripePaymentIntentId", p."status" AS "paymentStatus", p."stripeAccountId"
        FROM "Order" o
        LEFT JOIN "PaymentTransaction" p ON p."orderId" = o."id"
        WHERE o."id" = ${orderId}
        FOR UPDATE OF o
      `;

      if (!order) throw new NotFoundError('Order not found');

      if (order.status === 'REFUNDED') {
        throw new ConflictError('Order has already been fully refunded');
      }
      if (order.status !== 'COMPLETED' && order.status !== 'PARTIALLY_REFUNDED') {
        throw new ValidationError('Only completed orders can be refunded');
      }
      if (!order.stripePaymentIntentId || order.paymentStatus !== 'SUCCEEDED') {
        throw new ValidationError('No successful payment found for this order');
      }

      // Calculate already-refunded amount under lock
      const [{ total: alreadyRefundedRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0) AS total
        FROM "Refund"
        WHERE "orderId" = ${orderId} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      const alreadyRefunded = Number(alreadyRefundedRaw);

      const refundAmount = Number(order.totalAmount) - alreadyRefunded;
      if (refundAmount <= 0) {
        throw new ConflictError('No remaining amount to refund');
      }

      // Get refundable tickets
      const refundableTickets = await tx.ticket.findMany({
        where: {
          orderId,
          status: { in: ['VALID', 'REDEEMED'] },
        },
      });

      // Create PENDING refund record before calling Stripe
      const refundRecord = await tx.refund.create({
        data: {
          orderId,
          amount: refundAmount,
          reason,
          status: 'PENDING',
          initiatedBy,
        },
      });

      // Issue Stripe refund
      let stripeRefund;
      try {
        stripeRefund = await this._createStripeRefund(
          order.stripePaymentIntentId,
          refundAmount,
          reason,
          { connected: Boolean(order.stripeAccountId) }
        );
      } catch (err) {
        // Stripe failed — transaction rolls back, PENDING record disappears
        throw err;
      }

      // Update refund record with Stripe ID and mark SUCCEEDED
      await tx.$executeRaw`
        UPDATE "Refund" SET "stripeRefundId" = ${stripeRefund.id}, "status" = 'SUCCEEDED'::"RefundStatus"
        WHERE "id" = ${refundRecord.id}
      `;

      // Void all refundable tickets
      for (const ticket of refundableTickets) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'VOIDED' },
        });
      }

      // Restore inventory with FOR UPDATE lock on each tier
      const tierQuantities = {};
      for (const ticket of refundableTickets) {
        tierQuantities[ticket.priceTierId] = (tierQuantities[ticket.priceTierId] || 0) + 1;
      }
      for (const [tierId, qty] of Object.entries(tierQuantities)) {
        await tx.$executeRaw`
          UPDATE "PriceTier"
          SET "quantitySold" = "quantitySold" - ${qty}
          WHERE "id" = ${tierId}
        `;
      }

      // Add-on lines (spec 012): the full refund covers them; release their quantity
      const openAddOnLines = await tx.orderAddOn.findMany({ where: { orderId, refundedAt: null } });
      if (openAddOnLines.length > 0) {
        await tx.orderAddOn.updateMany({ where: { orderId, refundedAt: null }, data: { refundedAt: new Date() } });
        await addOnService.unsell(tx, openAddOnLines);
      }

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
      });

      return {
        refund: { ...refundRecord, stripeRefundId: stripeRefund.id, status: 'SUCCEEDED' },
        order,
        ticketsVoided: refundableTickets.length,
        refundAmount,
      };
    });

    logger.info('Full order refunded', {
      orderId,
      refundId: result.refund.id,
      amount: result.refundAmount,
      ticketsVoided: result.ticketsVoided,
    });

    return this._formatRefund(result.refund, result.order);
  }

  /**
   * Spec 024: amount-based refund of an application order. The review status
   * is untouched — withdraw separately to release the slot. Offline-paid
   * orders record the refund the organizer made outside Jump (`manual`).
   */
  async _refundApplicationOrder(
    orderId,
    { amount = null, reason = null, initiatedBy = null } = {}
  ) {
    const prepared = await prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw`
        SELECT o.*, p."stripePaymentIntentId", p."status" AS "paymentStatus", p."stripeAccountId", p."source" AS "paymentSource"
        FROM "Order" o
        LEFT JOIN "PaymentTransaction" p ON p."orderId" = o."id"
        WHERE o."id" = ${orderId}
        FOR UPDATE OF o
      `;
      if (!order) throw new NotFoundError('Order not found');
      const offline = order.paymentSource === 'OFFLINE';
      if (
        !['COMPLETED', 'PARTIALLY_REFUNDED'].includes(order.status) ||
        (!offline && (!order.stripePaymentIntentId || order.paymentStatus !== 'SUCCEEDED'))
      ) {
        throw new ConflictError('Only paid applications can be refunded');
      }
      const [{ total: alreadyRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0) AS total FROM "Refund" WHERE "orderId" = ${orderId} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      const remaining = round(Number(order.totalAmount) - Number(alreadyRaw));
      const value = amount == null ? remaining : round(Number(amount));
      if (!Number.isFinite(value) || value <= 0)
        throw new ValidationError('amount must be a positive number');
      if (value > remaining + 1e-9)
        throw new ValidationError(`amount cannot exceed the remaining ${remaining.toFixed(2)}`);

      if (offline) {
        const manual = await tx.refund.create({
          data: { orderId, amount: value, reason, status: 'SUCCEEDED', manual: true, initiatedBy },
        });
        await this._recomputeApplicationOrderStatus(tx, orderId);
        logger.info('Application refund recorded (offline)', {
          event: 'application_refund_manual',
          orderId,
          applicationId: order.applicationId,
          amount: value,
          initiatedBy,
        });
        return { refund: manual, order, done: true };
      }
      const pending = await tx.refund.create({
        data: { orderId, amount: value, reason, status: 'PENDING', initiatedBy },
      });
      return { refund: pending, order, done: false, value };
    });
    if (prepared.done) return this._formatRefund(prepared.refund, prepared.order);

    // Stripe outside the lock, like ApplicationPaymentService.refund did (spec 011).
    const { refund, order, value } = prepared;
    let stripeRefund;
    try {
      stripeRefund = await createStripeRefund({
        paymentIntentId: order.stripePaymentIntentId,
        amount: value,
        reason,
        connected: Boolean(order.stripeAccountId),
        metadata: { orderId, applicationId: order.applicationId },
      });
    } catch (error) {
      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
      throw error;
    }
    const finished = await prisma.$transaction(async (tx) => {
      const row = await tx.refund.update({
        where: { id: refund.id },
        data: { status: 'SUCCEEDED', stripeRefundId: stripeRefund.id },
      });
      await this._recomputeApplicationOrderStatus(tx, orderId);
      return row;
    });
    logger.info('Application refunded', {
      event: 'application_refunded',
      orderId,
      applicationId: order.applicationId,
      amount: value,
      stripeRefundId: stripeRefund.id,
      initiatedBy,
    });
    return this._formatRefund(finished, order);
  }

  /**
   * After a refund on an application order: Order.status and the
   * application's paymentStatus move to REFUNDED / PARTIALLY_REFUNDED together.
   */
  async _recomputeApplicationOrderStatus(tx, orderId) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
        applicationId: true,
        refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
      },
    });
    if (!order) return;
    const refunded = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    if (refunded <= 0) return;
    const paymentStatus =
      refunded + 1e-9 >= Number(order.totalAmount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (order.applicationId) {
      const application = await tx.application.update({
        where: { id: order.applicationId },
        data: { paymentStatus },
        select: { status: true, paymentStatus: true },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: orderStatusFor(application) },
      });
    } else {
      await tx.order.update({ where: { id: orderId }, data: { status: paymentStatus } });
    }
  }

  /**
   * Refund a single ticket: void ticket, partial refund.
   *
   * @param {string} ticketId
   * @param {{ reason?: string, initiatedBy?: string }} options
   * @returns {Promise<Object>} Refund record
   */
  /**
   * Refund one ticket. Staff callers pass nothing and the full `pricePaid`
   * goes back. A self-serve refund (spec 031) passes the policy's `feeAmount`:
   * the buyer gets `pricePaid − feeAmount`, the organization keeps the fee,
   * and the ticket is voided either way.
   */
  async refundTicket(ticketId, { reason = null, initiatedBy = null, feeAmount = 0 } = {}) {
    const fee = round(Number(feeAmount) || 0);
    if (fee < 0) throw new ValidationError('feeAmount cannot be negative');
    const result = await prisma.$transaction(async (tx) => {
      // Lock the ticket's order to prevent concurrent refunds
      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          order: {
            include: {
              payment: true,
              tickets: true,
            },
          },
          priceTier: { select: { isRefundable: true, name: true } },
        },
      });

      if (!ticket) throw new NotFoundError('Ticket not found');

      if (ticket.status === 'VOIDED') {
        throw new ConflictError('Ticket has already been voided/refunded');
      }
      if (ticket.status !== 'VALID' && ticket.status !== 'REDEEMED') {
        throw new ValidationError('Only valid or redeemed tickets can be refunded');
      }

      const order = ticket.order;

      // Lock the order row
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;

      if (order.status !== 'COMPLETED' && order.status !== 'PARTIALLY_REFUNDED') {
        throw new ValidationError('Order is not in a refundable state');
      }
      if (!order.payment || order.payment.status !== 'SUCCEEDED') {
        throw new ValidationError('No successful payment found');
      }

      const pricePaid = Number(ticket.pricePaid);
      if (fee > pricePaid) throw new ValidationError('feeAmount cannot exceed the ticket price');
      const refundAmount = round(pricePaid - fee);
      if (refundAmount <= 0) {
        throw new ValidationError('Ticket has no refundable amount');
      }

      // Check total refunded under lock
      const [{ total: alreadyRefundedRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0) AS total
        FROM "Refund"
        WHERE "orderId" = ${order.id} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      const alreadyRefunded = Number(alreadyRefundedRaw);

      if (alreadyRefunded + refundAmount > Number(order.totalAmount)) {
        throw new ValidationError('Refund would exceed order total');
      }

      // Create PENDING refund record before calling Stripe
      const refundRecord = await tx.refund.create({
        data: {
          orderId: order.id,
          ticketId: ticket.id,
          amount: refundAmount,
          feeAmount: fee,
          reason,
          status: 'PENDING',
          initiatedBy,
        },
      });

      // Issue Stripe refund
      let stripeRefund;
      try {
        stripeRefund = await this._createStripeRefund(
          order.payment.stripePaymentIntentId,
          refundAmount,
          reason,
          { connected: Boolean(order.payment.stripeAccountId) }
        );
      } catch (err) {
        throw err;
      }

      // Update refund record with Stripe ID and mark SUCCEEDED
      await tx.$executeRaw`
        UPDATE "Refund" SET "stripeRefundId" = ${stripeRefund.id}, "status" = 'SUCCEEDED'::"RefundStatus"
        WHERE "id" = ${refundRecord.id}
      `;

      // Void ticket
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'VOIDED' },
      });

      // Restore inventory with row-level lock
      await tx.$executeRaw`
        UPDATE "PriceTier"
        SET "quantitySold" = "quantitySold" - 1
        WHERE "id" = ${ticket.priceTierId}
      `;

      // Determine new order status from fresh DB state
      const activeTicketsAfter = await tx.ticket.count({
        where: {
          orderId: order.id,
          status: { in: ['VALID', 'REDEEMED'] },
        },
      });
      const openAddOnLines = await tx.orderAddOn.count({ where: { orderId: order.id, refundedAt: null } });
      // Spec 031: a retained fee is money still on the order, so the order stays
      // PARTIALLY_REFUNDED and staff can return the remainder with refundOrder.
      const [{ total: feesRetainedRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("feeAmount"), 0) AS total
        FROM "Refund"
        WHERE "orderId" = ${order.id} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      const allLinesClosed = activeTicketsAfter === 0 && openAddOnLines === 0;
      const newOrderStatus = allLinesClosed && Number(feesRetainedRaw) <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      await tx.order.update({
        where: { id: order.id },
        data: { status: newOrderStatus },
      });

      return {
        refund: { ...refundRecord, stripeRefundId: stripeRefund.id, status: 'SUCCEEDED' },
        order,
        refundAmount,
        newOrderStatus,
      };
    });

    logger.info('Ticket refunded', {
      ticketId,
      orderId: result.order.id,
      refundId: result.refund.id,
      amount: result.refundAmount,
      newOrderStatus: result.newOrderStatus,
    });

    return this._formatRefund(result.refund, result.order);
  }

  /**
   * Refund one add-on line (spec 012): the line's all-in amount, quantity
   * released, tickets untouched.
   *
   * @param {string} orderAddOnId
   * @param {{ reason?: string, initiatedBy?: string }} options
   */
  async refundAddOnLine(orderAddOnId, { reason = null, initiatedBy = null } = {}) {
    const result = await prisma.$transaction(async (tx) => {
      const line = await tx.orderAddOn.findUnique({
        where: { id: orderAddOnId },
        include: { addOn: { select: { name: true } }, order: { include: { payment: true } } },
      });
      if (!line) throw new NotFoundError('Add-on line not found');
      if (line.refundedAt) throw new ConflictError('Add-on line has already been refunded');

      const order = line.order;
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;

      if (order.status !== 'COMPLETED' && order.status !== 'PARTIALLY_REFUNDED') {
        throw new ValidationError('Order is not in a refundable state');
      }
      if (!order.payment || order.payment.status !== 'SUCCEEDED') {
        throw new ValidationError('No successful payment found');
      }

      const refundAmount = addOnService.serializeOrderLine(line).lineTotal;
      if (refundAmount <= 0) throw new ValidationError('Add-on line has no refundable amount');

      const [{ total: alreadyRefundedRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0) AS total
        FROM "Refund"
        WHERE "orderId" = ${order.id} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      if (Number(alreadyRefundedRaw) + refundAmount > Number(order.totalAmount) + 0.005) {
        throw new ValidationError('Refund would exceed order total');
      }

      const refundRecord = await tx.refund.create({
        data: { orderId: order.id, orderAddOnId: line.id, amount: refundAmount, reason, status: 'PENDING', initiatedBy },
      });

      const stripeRefund = await this._createStripeRefund(order.payment.stripePaymentIntentId, refundAmount, reason, {
        connected: Boolean(order.payment.stripeAccountId),
      });

      await tx.$executeRaw`
        UPDATE "Refund" SET "stripeRefundId" = ${stripeRefund.id}, "status" = 'SUCCEEDED'::"RefundStatus"
        WHERE "id" = ${refundRecord.id}
      `;
      await tx.orderAddOn.update({ where: { id: line.id }, data: { refundedAt: new Date() } });
      await addOnService.unsell(tx, [line]);

      const activeTickets = await tx.ticket.count({ where: { orderId: order.id, status: { in: ['VALID', 'REDEEMED'] } } });
      const openAddOnLines = await tx.orderAddOn.count({ where: { orderId: order.id, refundedAt: null } });
      const newOrderStatus = activeTickets === 0 && openAddOnLines === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await tx.order.update({ where: { id: order.id }, data: { status: newOrderStatus } });

      return { refund: { ...refundRecord, stripeRefundId: stripeRefund.id, status: 'SUCCEEDED' }, order, refundAmount, newOrderStatus };
    });

    logger.info('Add-on line refunded', {
      event: 'add_on_line_refunded',
      orderAddOnId,
      orderId: result.order.id,
      refundId: result.refund.id,
      amount: result.refundAmount,
      newOrderStatus: result.newOrderStatus,
    });

    return this._formatRefund(result.refund, result.order);
  }

  /**
   * Handle a Stripe-initiated refund (from dashboard or API outside Jump).
   * Reconciles local state with Stripe's refund event.
   *
   * @param {string} paymentIntentId
   * @param {Object} stripeRefund - Stripe refund object from webhook
   */
  async handleExternalRefund(paymentIntentId, stripeRefund) {
    // Check if we already recorded this refund
    const existing = await prisma.refund.findFirst({
      where: { stripeRefundId: stripeRefund.id },
    });
    if (existing) {
      logger.info('External refund already recorded (idempotent skip)', {
        stripeRefundId: stripeRefund.id,
      });
      return;
    }

    const payment = await prisma.paymentTransaction.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: {
        order: {
          include: { tickets: true },
        },
      },
    });

    if (!payment || !payment.order) {
      logger.warn('External refund: payment not found', { paymentIntentId });
      return;
    }

    const order = payment.order;
    const refundAmount = stripeRefund.amount / 100; // Stripe uses cents

    if (order.kind === 'APPLICATION') {
      // Spec 024: nothing to void; record the refund and move both statuses.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
        await tx.refund.create({
          data: {
            orderId: order.id,
            stripeRefundId: stripeRefund.id,
            amount: refundAmount,
            reason: stripeRefund.reason || 'external',
            status: 'SUCCEEDED',
            initiatedBy: null,
          },
        });
        await this._recomputeApplicationOrderStatus(tx, order.id);
      });
      logger.info('External application refund processed', {
        orderId: order.id,
        applicationId: order.applicationId,
        stripeRefundId: stripeRefund.id,
        amount: refundAmount,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Lock order row
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;

      // Calculate total refunded after this refund
      const [{ total: alreadyRefundedRaw }] = await tx.$queryRaw`
        SELECT COALESCE(SUM("amount"), 0) AS total
        FROM "Refund"
        WHERE "orderId" = ${order.id} AND "status" = 'SUCCEEDED'::"RefundStatus"
      `;
      const totalRefundedAfter = Number(alreadyRefundedRaw) + refundAmount;
      const isFullRefund = totalRefundedAfter >= Number(order.totalAmount);

      await tx.refund.create({
        data: {
          orderId: order.id,
          stripeRefundId: stripeRefund.id,
          amount: refundAmount,
          reason: stripeRefund.reason || 'Refunded via Stripe',
          status: 'SUCCEEDED',
          initiatedBy: null,
        },
      });

      // For external refunds, we can't know which specific ticket was refunded.
      // Void tickets proportionally: void enough to cover the refund amount.
      const activeTickets = await tx.ticket.findMany({
        where: {
          orderId: order.id,
          status: { in: ['VALID', 'REDEEMED'] },
        },
        orderBy: { pricePaid: 'asc' },
      });

      let amountToVoid = refundAmount;
      const ticketsToVoid = [];
      for (const ticket of activeTickets) {
        if (amountToVoid <= 0) break;
        ticketsToVoid.push(ticket);
        amountToVoid -= Number(ticket.pricePaid);
      }

      for (const ticket of ticketsToVoid) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'VOIDED' },
        });
      }

      // Restore inventory with row-level lock
      const tierQuantities = {};
      for (const ticket of ticketsToVoid) {
        tierQuantities[ticket.priceTierId] = (tierQuantities[ticket.priceTierId] || 0) + 1;
      }
      for (const [tierId, qty] of Object.entries(tierQuantities)) {
        await tx.$executeRaw`
          UPDATE "PriceTier"
          SET "quantitySold" = "quantitySold" - ${qty}
          WHERE "id" = ${tierId}
        `;
      }

      const newStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await tx.order.update({
        where: { id: order.id },
        data: { status: newStatus },
      });
    });

    logger.info('External refund processed', {
      orderId: order.id,
      stripeRefundId: stripeRefund.id,
      amount: refundAmount,
    });
  }

  /**
   * Get refund history for an order.
   *
   * @param {string} orderId
   * @returns {Promise<Object[]>}
   */
  async getRefundsForOrder(orderId) {
    const refunds = await prisma.refund.findMany({
      where: { orderId },
      include: {
        ticket: {
          select: { id: true, barcode: true, ticketNumber: true },
        },
        orderAddOn: { include: { addOn: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      feeAmount: Number(r.feeAmount ?? 0),
      reason: r.reason,
      status: r.status,
      stripeRefundId: r.stripeRefundId,
      ticket: r.ticket
        ? {
            id: r.ticket.id,
            barcode: r.ticket.barcode,
            ticketNumber: r.ticket.ticketNumber,
          }
        : null,
      addOn: r.orderAddOn ? { id: r.orderAddOn.id, name: r.orderAddOn.addOn?.name ?? null, quantity: r.orderAddOn.quantity } : null,
      initiatedBy: r.initiatedBy,
      manual: r.manual === true,
      createdAt: r.createdAt,
    }));
  }

  // ─── Internal ─────────────────────────────────────

  /**
   * @param {{ connected?: boolean }} [options] - `connected`: the charge was a
   *   destination charge (spec 010 phase 2). Stripe then pulls the organization's
   *   share back (`reverse_transfer`) and returns the platform's fee
   *   (`refund_application_fee`), both pro rata for partial amounts, so the
   *   buyer is made whole and the platform eats only Stripe's processing cost.
   */
  async _createStripeRefund(paymentIntentId, amount, reason, { connected = false } = {}) {
    return createStripeRefund({ paymentIntentId, amount, reason, connected });
  }

  _formatRefund(refund, order) {
    return {
      id: refund.id,
      orderId: refund.orderId,
      ticketId: refund.ticketId,
      orderAddOnId: refund.orderAddOnId ?? null,
      amount: Number(refund.amount),
      feeAmount: Number(refund.feeAmount ?? 0),
      reason: refund.reason,
      status: refund.status,
      stripeRefundId: refund.stripeRefundId,
      manual: refund.manual === true,
      orderRef: order.orderRef,
      createdAt: refund.createdAt,
    };
  }
}

export default new RefundService();
