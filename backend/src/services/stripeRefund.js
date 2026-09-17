// Shared Stripe refund call (spec 010 phase 2 / spec 011 phase 2).
// Used by RefundService (orders, tickets) and ApplicationPaymentService.
// Throws ValidationError with Stripe's message so API callers see why.

import stripe from '../config/stripe.js';
import { ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * @param {{ paymentIntentId: string, amount: number, reason?: string|null, connected?: boolean, metadata?: object }} input
 *   `amount` in dollars. `connected`: the charge was a destination charge, so
 *   Stripe pulls the organization's share back (`reverse_transfer`) and returns
 *   the platform fee (`refund_application_fee`), both pro rata for partial amounts.
 */
export async function createStripeRefund({ paymentIntentId, amount, reason = null, connected = false, metadata = {} }) {
  try {
    return await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100), // Stripe uses cents
      ...(reason && { reason: 'requested_by_customer' }),
      ...(connected && { reverse_transfer: true, refund_application_fee: true }),
      metadata: { source: 'jump-platform', ...metadata },
    });
  } catch (err) {
    logger.error('Stripe refund failed', { paymentIntentId, amount, error: err.message });
    throw new ValidationError(`Stripe refund failed: ${err.message}`);
  }
}
