// Payment Service
// Handles Stripe payment updates and webhook processing
// Per FR-024, FR-028, FR-029, contracts/api.yaml
//
// NOTE: Stripe Checkout session creation is handled by OrderService.createOrder().
// This service handles post-payment webhook processing:
//   - checkout.session.completed → completeOrder + issue tickets + send email
//   - checkout.session.expired   → failOrder + release inventory

import { prisma } from '@jump/db';
import OrderService from './OrderService.js';
import TicketService from './TicketService.js';
import BuyerAuthService from './BuyerAuthService.js';
import { buyerVerifyUrl } from '../utils/storefrontUrl.js';
import EmailService from './EmailService.js';
import { recordPaymentStatus } from '../utils/metrics.js';
import logger from '../utils/logger.js';

class PaymentService {
  /**
   * Handle successful Stripe checkout completion.
   * Idempotent: if order is already COMPLETED, returns early.
   *
   * Flow:
   * 1. Look up order by stripeSessionId
   * 2. Skip if already COMPLETED (idempotent)
   * 3. Update PaymentTransaction → SUCCEEDED
   * 4. Create tickets for the order (TicketService)
   * 5. Mark order COMPLETED
   * 6. Send confirmation email (fire-and-forget)
   *
   * @param {string} stripeSessionId
   * @param {string|null} paymentIntentId
   */
  async handleCheckoutCompleted(stripeSessionId, paymentIntentId = null) {
    const order = await OrderService.getOrderByStripeSession(stripeSessionId);

    if (!order) {
      logger.warn('Webhook: order not found for session', { stripeSessionId });
      return;
    }

    // Idempotent: already processed
    if (order.status === 'COMPLETED') {
      logger.info('Webhook: order already completed (idempotent skip)', {
        orderId: order.id,
        stripeSessionId,
      });
      return;
    }

    if (order.status !== 'PENDING') {
      logger.warn('Webhook: order not in PENDING status, skipping', {
        orderId: order.id,
        currentStatus: order.status,
      });
      return;
    }

    // Update payment transaction
    await prisma.paymentTransaction.updateMany({
      where: { orderId: order.id },
      data: {
        status: 'SUCCEEDED',
        ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
      },
    });

    // Create tickets
    const tickets = await TicketService.createTicketsForOrder(order.id);

    // Mark order COMPLETED
    await OrderService.completeOrder(order.id);

    // Apply checkout opt-ins now that the payment (and so the email) is real
    await this._applyOptIns(order);

    recordPaymentStatus('succeeded');

    logger.info('Checkout completed — tickets issued', {
      orderId: order.id,
      orderRef: order.orderRef,
      ticketCount: tickets.length,
    });

    // Send confirmation email (fire-and-forget)
    try {
      const fullOrder = await OrderService.getOrderById(order.id);
      const manageTicketsUrl = await this._welcomeLinkForOrder(order.id);
      await EmailService.sendOrderConfirmation(fullOrder, tickets, { manageTicketsUrl });
    } catch (emailError) {
      logger.error('Failed to send order confirmation email', {
        orderId: order.id,
        error: emailError.message,
      });
      // Don't fail the webhook — email is non-critical
    }
  }

  /**
   * Apply the checkout opt-ins recorded on the order to its Contact.
   * Both only ever turn on: an account is never revoked by a later guest
   * checkout, and turning marketing off is the unsubscribe flow.
   * Never throws: opt-ins must not block ticket issuance.
   *
   * @param {{ id: string, contactId: string, optInAccount?: boolean, optInMarketing?: boolean }} order
   */
  async _applyOptIns(order) {
    if (!order.optInAccount && !order.optInMarketing) return;
    try {
      const contact = await prisma.contact.findUnique({
        where: { id: order.contactId },
        select: { accountCreatedAt: true, emailSubscribed: true },
      });
      if (!contact) return;
      const data = {
        ...(order.optInAccount && !contact.accountCreatedAt && { accountCreatedAt: new Date() }),
        ...(order.optInMarketing && !contact.emailSubscribed && { emailSubscribed: true }),
      };
      if (Object.keys(data).length === 0) return;
      await prisma.contact.update({ where: { id: order.contactId }, data });
      logger.info('Checkout opt-ins applied', {
        event: 'buyer_opt_ins_applied',
        orderId: order.id,
        contactId: order.contactId,
        ...data,
      });
    } catch (error) {
      logger.error('Failed to apply checkout opt-ins', { orderId: order.id, error: error.message });
    }
  }

  /**
   * Buyer-account welcome link for the confirmation email (spec 007 phase 2).
   * Issued only when the buyer opted into an account at checkout. The webhook
   * is already idempotent on order status, so this runs once per completion.
   * Never throws: a failed link must not block the confirmation email.
   *
   * @param {string} orderId
   * @returns {Promise<string|null>}
   */
  async _welcomeLinkForOrder(orderId) {
    try {
      const row = await prisma.order.findUnique({
        where: { id: orderId },
        select: { contact: { select: { id: true, organizationId: true, accountCreatedAt: true } } },
      });
      if (!row?.contact?.accountCreatedAt) return null;

      const { rawToken } = await BuyerAuthService.issueToken(row.contact, 'WELCOME');
      return await buyerVerifyUrl(row.contact.organizationId, rawToken);
    } catch (error) {
      logger.error('Failed to issue buyer welcome link', { orderId, error: error.message });
      return null;
    }
  }

  /**
   * Handle Stripe checkout session expiry or payment failure.
   * Idempotent: if order is already FAILED, returns early.
   *
   * @param {string} stripeSessionId
   * @param {string} reason
   */
  async handleCheckoutFailed(stripeSessionId, reason = 'Payment failed') {
    const order = await OrderService.getOrderByStripeSession(stripeSessionId);

    if (!order) {
      logger.warn('Webhook: order not found for failed session', { stripeSessionId });
      return;
    }

    // Idempotent: already processed
    if (order.status === 'FAILED') {
      logger.info('Webhook: order already failed (idempotent skip)', {
        orderId: order.id,
      });
      return;
    }

    // Update payment transaction
    await prisma.paymentTransaction.updateMany({
      where: { orderId: order.id },
      data: {
        status: 'FAILED',
        failureReason: reason,
      },
    });

    // Fail order and release inventory
    await OrderService.failOrder(order.id, reason);

    recordPaymentStatus('failed');

    logger.info('Checkout failed — inventory released', {
      orderId: order.id,
      reason,
    });
  }
}

export default new PaymentService();
