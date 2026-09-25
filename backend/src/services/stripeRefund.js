// Shared Stripe refund call (spec 010 phase 2 / spec 011 phase 2).
// Used by RefundService (orders, tickets) and ApplicationPaymentService.
// Throws ValidationError with Stripe's message so API callers see why.

import stripe from '../config/stripe.js';
import { ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Namespace every key so a Jump key can never collide with one from another
 * integration on the same Stripe account.
 */
export function refundIdempotencyKey(scope) {
  return `jump:refund:${scope}`.slice(0, 255);
}

/**
 * @param {{ paymentIntentId: string, amount: number, idempotencyKey: string, reason?: string|null, connected?: boolean, metadata?: object }} input
 *   `amount` in dollars. `connected`: the charge was a destination charge, so
 *   Stripe pulls the organization's share back (`reverse_transfer`) and returns
 *   the platform fee (`refund_application_fee`), both pro rata for partial amounts.
 *
 *   `idempotencyKey` is REQUIRED and deliberately has no default. The dangerous
 *   window is: Stripe refunds the money, then our transaction rolls back or the
 *   process dies before the Refund row commits. An operator retries and — with
 *   no key — the customer is refunded twice, with nothing in our ledger saying
 *   so. With the key, Stripe replays the first refund object instead of
 *   creating a second. Keys must therefore be derived from the *operation*
 *   (this ticket, this add-on line, this order's remaining balance), not from a
 *   row id that a rollback would discard. See `RefundService` for each scope.
 *
 *   Note the 24 h limit: Stripe expires idempotency keys after a day, so this
 *   protects against retries and double-clicks, not against a refund reissued
 *   a week later. The database checks (`alreadyRefunded`, refund-exceeds-total)
 *   cover that longer window.
 */
export async function createStripeRefund({
  paymentIntentId,
  amount,
  idempotencyKey,
  reason = null,
  connected = false,
  metadata = {},
}) {
  if (!idempotencyKey) {
    // Loud rather than lenient: a refund path added without a key is a
    // double-refund waiting for its first retry.
    throw new Error('createStripeRefund requires an idempotencyKey');
  }
  try {
    return await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // Stripe uses cents
        ...(reason && { reason: 'requested_by_customer' }),
        ...(connected && { reverse_transfer: true, refund_application_fee: true }),
        metadata: { source: 'jump-platform', ...metadata },
      },
      { idempotencyKey }
    );
  } catch (err) {
    logger.error('Stripe refund failed', { paymentIntentId, amount, idempotencyKey, error: err.message });
    throw new ValidationError(`Stripe refund failed: ${err.message}`);
  }
}
