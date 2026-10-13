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
import ContactOptInService from './ContactOptInService.js';
import { buyerVerifyUrl } from '../utils/storefrontUrl.js';
import EmailService from './EmailService.js';
import { recordPaymentStatus } from '../utils/metrics.js';
import logger from '../utils/logger.js';
import { sameAccount } from './stripeAccount.js';

/**
 * Spec 047 D0-S: a webhook may only settle an order whose payment was created
 * on the account the event came from (`event.account`; null = platform).
 */
function accountRefused(order, account, stripeSessionId) {
  const expected = order.payment?.stripeAccountId ?? null;
  if (sameAccount(expected, account)) return false;
  logger.error('Webhook refused: Stripe account does not match the order payment', {
    event: 'stripe_webhook_account_mismatch',
    orderId: order.id,
    stripeSessionId,
    expectedAccount: expected,
    eventAccount: account || null,
  });
  return true;
}

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
   * @param {string|null} [account] - `event.account` (null = platform account)
   */
  async handleCheckoutCompleted(stripeSessionId, paymentIntentId = null, account = null) {
    const order = await OrderService.getOrderByStripeSession(stripeSessionId);

    if (!order) {
      logger.warn('Webhook: order not found for session', { stripeSessionId });
      return;
    }
    if (accountRefused(order, account, stripeSessionId)) return;

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

    // Spec 054: the event was cancelled while this checkout was open (its
    // session could not be expired in time). Refund it at once instead of
    // sending tickets for an event that is not happening.
    if (order.event?.status === 'CANCELLED') {
      await this._refundLatePayment(order);
      return;
    }

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
   * Refund a payment that completed after its event was cancelled, and record
   * it on the event's cancellation. Never throws: the webhook has already
   * settled the order, so a failed refund is left FAILED on the cancellation
   * for staff (and the 054-B sweep) to retry rather than redelivered.
   */
  async _refundLatePayment(order) {
    const RefundService = (await import('./RefundService.js')).default;
    const cancellation = await prisma.eventCancellation.findUnique({ where: { eventId: order.eventId }, select: { id: true } });
    let item;
    try {
      const result = await RefundService.refundOrder(order.id, { reason: 'Event cancelled before the payment completed' });
      item = { status: 'REFUNDED', refundedAmount: result.amount, error: null };
      logger.info('Late payment for a cancelled event refunded', { event: 'cancelled_event_late_payment_refunded', orderId: order.id, eventId: order.eventId });
    } catch (error) {
      item = { status: 'FAILED', error: error.message };
      logger.error('Could not refund a late payment for a cancelled event', { orderId: order.id, eventId: order.eventId, error: error.message });
    }
    if (!cancellation) return;
    await prisma.eventCancellationItem.upsert({
      where: { orderId: order.id },
      update: { ...item, attempts: { increment: 1 } },
      create: { cancellationId: cancellation.id, orderId: order.id, attempts: 1, ...item },
    });
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
      // One implementation for checkout and apply-form opt-ins (spec 024 phase 3),
      // with marketing provenance (spec 023 LR-07).
      await ContactOptInService.apply(prisma, order.contactId, { account: order.optInAccount, marketing: order.optInMarketing, source: 'CHECKOUT' });
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
   * @param {string|null} [account] - `event.account` (null = platform account)
   */
  async handleCheckoutFailed(stripeSessionId, reason = 'Payment failed', account = null) {
    const order = await OrderService.getOrderByStripeSession(stripeSessionId);

    if (!order) {
      logger.warn('Webhook: order not found for failed session', { stripeSessionId });
      return;
    }
    if (accountRefused(order, account, stripeSessionId)) return;

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
