// Which Stripe account a call runs on (spec 047 D0-S, option C).
// Every charge for an organization with a connected account is a direct
// charge on that account; PaymentTransaction.stripeAccountId records it
// (null = Jump's platform account, every order before option C).

/**
 * Trailing request-options argument for a Stripe call on `stripeAccountId`:
 * `stripe.x.create(params, ...onAccount(id))`. Empty for the platform account,
 * so platform calls are byte-for-byte what they were before.
 * @param {string|null|undefined} stripeAccountId
 * @returns {Array<{ stripeAccount: string }>}
 */
export function onAccount(stripeAccountId) {
  return stripeAccountId ? [{ stripeAccount: stripeAccountId }] : [];
}

/**
 * Whether a webhook event from `eventAccount` (`event.account`, absent on the
 * platform endpoint) may act on a payment recorded on `paymentAccount`. One
 * organization's account must never complete, refund or dispute another's
 * order, and a platform event never touches a direct charge.
 */
export function sameAccount(paymentAccount, eventAccount) {
  return (paymentAccount || null) === (eventAccount || null);
}
