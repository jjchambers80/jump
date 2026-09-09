// Refund Service
// Handles full-order and per-ticket refunds via Stripe
// Creates append-only Refund ledger records, voids tickets, restores inventory

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler.js';

class RefundService {
  /**
   * Refund an entire order: all tickets voided, full amount returned.
   *
   * @param {string} orderId
   * @param {{ reason?: string, initiatedBy?: string }} options
   * @returns {Promise<Object>} Refund record
   */
  async refundOrder(orderId, { reason = null, initiatedBy = null } = {}) {
    // Everything inside one transaction: lock, validate, create PENDING record, call Stripe, finalize
    const result = await prisma.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent refunds
      const [order] = await tx.$queryRaw`
        SELECT o.*, p."stripePaymentIntentId", p."status" AS "paymentStatus"
        FROM "Order" o
        LEFT JOIN "PaymentTransaction" p ON p."orderId" = o."id"
        WHERE o."id" = ${orderId}
        FOR UPDATE
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
          reason
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
   * Refund a single ticket: void ticket, partial refund.
   *
   * @param {string} ticketId
   * @param {{ reason?: string, initiatedBy?: string }} options
   * @returns {Promise<Object>} Refund record
   */
  async refundTicket(ticketId, { reason = null, initiatedBy = null } = {}) {
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

      const refundAmount = Number(ticket.pricePaid);
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
          reason
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
      const newOrderStatus = activeTicketsAfter === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

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
   * Handle a Stripe-initiated refund (from dashboard or API outside Jump).
   * Reconciles local state with Stripe's refund event.
   *
   * @param {string} paymentIntentId
   * @param {Object} stripeRefund - Stripe refund object from webhook
   */
  async handleExternalRefund(paymentIntentId, stripeRefund) {
    // Check if we already recorded this refund
    const existing = await prisma.refund.findUnique({
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
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
      initiatedBy: r.initiatedBy,
      createdAt: r.createdAt,
    }));
  }

  // ─── Internal ─────────────────────────────────────

  async _createStripeRefund(paymentIntentId, amount, reason) {
    try {
      return await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // Stripe uses cents
        ...(reason && { reason: 'requested_by_customer' }),
        metadata: { source: 'jump-platform' },
      });
    } catch (err) {
      logger.error('Stripe refund failed', {
        paymentIntentId,
        amount,
        error: err.message,
      });
      throw new ValidationError(`Stripe refund failed: ${err.message}`);
    }
  }

  _formatRefund(refund, order) {
    return {
      id: refund.id,
      orderId: refund.orderId,
      ticketId: refund.ticketId,
      amount: Number(refund.amount),
      reason: refund.reason,
      status: refund.status,
      stripeRefundId: refund.stripeRefundId,
      orderRef: order.orderRef,
      createdAt: refund.createdAt,
    };
  }
}

export default new RefundService();
