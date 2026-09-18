// Jump subscription billing (spec 022 phase 2).
// Lives in Jump's own Stripe account (the same STRIPE_SECRET_KEY as the
// transactions platform); only the webhook endpoint and its signing secret are
// separate. BILLING_ENABLED=true inserts the subscribe step into /signup and
// opens Settings › Plan; without JUMP_STARTER_PRICE_ID it stays off.

import logger from '../utils/logger.js';

let warned = false;

export function billingEnabled() {
  if (String(process.env.BILLING_ENABLED || '').toLowerCase() !== 'true') return false;
  if (!process.env.JUMP_STARTER_PRICE_ID) {
    if (!warned) {
      warned = true;
      logger.warn('BILLING_ENABLED is true but JUMP_STARTER_PRICE_ID is not set; billing stays off');
    }
    return false;
  }
  return true;
}

/** Free trial length offered at signup. */
export function trialDays() {
  const n = Number(process.env.BILLING_TRIAL_DAYS);
  return Number.isInteger(n) && n >= 0 ? n : 30;
}

export function starterPriceId() {
  return process.env.JUMP_STARTER_PRICE_ID || null;
}

/** Stripe subscription statuses that count as "on the paid plan". */
export const PAID_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);
