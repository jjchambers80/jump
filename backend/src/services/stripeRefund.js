// Shared Stripe refund call (spec 010 phase 2 / spec 011 phase 2).
// Used by RefundService (orders, tickets) and ApplicationPaymentService.
// Throws ValidationError with Stripe's message so API callers see why.

import stripe from '../config/stripe.js';
import { ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Integer cents from a dollar amount. The `Number.EPSILON` nudge pulls an exact
 * half-cent (1.005, stored as 1.00499999…) up instead of down.
 *
 * This is the ONLY place dollars become cents in the refund path: both the
 * amount sent to Stripe and the amount baked into the idempotency key use it.
 * Two roundings would be a bug, not a duplication — `Math.round(1.005 * 100)`
 * is 100 while `cents(1.005)` is 101, so a second rounding would let one key
 * stand for two different Stripe amounts and Stripe would reject the later,
 * legitimate refund with a 400 for the next 24h.
 */
export const cents = (value) => Math.round((Number(value) + Number.EPSILON) * 100);

/**
 * Stripe error types that mean the refund definitively did NOT happen: the
 * request reached Stripe and Stripe rejected it. Anything else — a connection
 * reset, a proxy timeout, a 5xx — leaves the outcome unknown, so the caller
 * must assume the money may already have moved.
 */
const DEFINITIVE_REJECTIONS = new Set([
  'StripeInvalidRequestError',
  'StripeCardError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeIdempotencyError',
  'StripeRateLimitError',
]);

/**
 * @param {{
 *   paymentIntentId: string,
 *   amount: number,
 *   reason?: string|null,
 *   connected?: boolean,
 *   metadata?: object,
 *   idempotencyKey?: string|null,
 * }} input
 *   `amount` in dollars. `connected`: the charge was a destination charge, so
 *   Stripe pulls the organization's share back (`reverse_transfer`) and returns
 *   the platform fee (`refund_application_fee`), both pro rata for partial amounts.
 *
 *   `idempotencyKey` must be derived from state that survives a failed attempt
 *   (the order/ticket id plus the amounts), never from a row the retry
 *   recreates — build it with `refundIdempotencyKey` below. Stripe then
 *   collapses a retry onto the first refund instead of issuing a second one.
 *
 *   On failure the thrown ValidationError carries `outcomeUnknown`: true when
 *   the request may have created a refund anyway (connection/timeout/5xx),
 *   false when Stripe definitively rejected it.
 */
export async function createStripeRefund({
  paymentIntentId,
  amount,
  reason = null,
  connected = false,
  metadata = {},
  idempotencyKey = null,
}) {
  try {
    return await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: cents(amount), // same rounding the idempotency key uses
        ...(reason && { reason: 'requested_by_customer' }),
        ...(connected && { reverse_transfer: true, refund_application_fee: true }),
        metadata: { source: 'jump-platform', ...metadata },
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );
  } catch (err) {
    const outcomeUnknown = !DEFINITIVE_REJECTIONS.has(err?.type);
    logger.error('Stripe refund failed', {
      paymentIntentId,
      amount,
      idempotencyKey,
      stripeErrorType: err?.type,
      outcomeUnknown,
      error: err.message,
    });
    const error = new ValidationError(`Stripe refund failed: ${err.message}`);
    error.outcomeUnknown = outcomeUnknown;
    throw error;
  }
}

/**
 * A refund idempotency key that is stable across a retry of the *same* logical
 * refund and different for a genuinely new one.
 *
 * `scope` identifies what is being refunded (`order:<id>`, `ticket:<id>`,
 * `addon:<id>`). `amount` is this refund's dollar amount. `alreadyRefunded` is
 * the order's SUCCEEDED refund total read under the same lock — it is what
 * separates "the admin is retrying the $250 that just failed" (already-refunded
 * unchanged, same key, Stripe returns the first refund) from "the admin is
 * refunding another $250 on purpose" (already-refunded moved, new key, Stripe
 * issues a second refund).
 *
 * Stripe keys expire after 24h; a retry later than that can still double-refund
 * and is caught by the Orders/Stripe reconciliation, not here.
 */
export function refundIdempotencyKey(scope, amount, alreadyRefunded = 0) {
  return `refund:${scope}:${cents(amount)}:after:${cents(alreadyRefunded)}`;
}
