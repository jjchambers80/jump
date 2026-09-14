// Payment configuration (spec 010 phase 1)
// Which optional Stripe payment methods an organization may switch on, and the
// statement descriptor rules Stripe enforces on card charges.

// Stripe caps the full card descriptor (prefix + "* " + suffix) at 22 characters.
export const STATEMENT_DESCRIPTOR_MAX = 22;
// Stripe joins the platform prefix and the dynamic suffix with "* ".
export const STATEMENT_DESCRIPTOR_JOINER = '* ';

/**
 * Optional Stripe payment methods organizations can offer at checkout, keyed by
 * Stripe's `payment_method_types` value. `capability` is the platform-account
 * capability that must be `active` before the method can be sent to Checkout.
 * Cards (with Apple Pay / Google Pay on the hosted page) are always on and are
 * not listed here. ACH, crypto and BNPL beyond this list are deliberately out
 * (see specs/010-payments-settings/plan.md §2.3, §5.6).
 */
export const PAYMENT_METHOD_ALLOWLIST = [
  {
    type: 'link',
    label: 'Link',
    group: 'wallets',
    capability: 'link_payments',
    help: 'One-click checkout with a saved Stripe Link account.',
  },
  {
    type: 'cashapp',
    label: 'Cash App Pay',
    group: 'more',
    capability: 'cashapp_payments',
    help: 'Buyers pay from their Cash App balance or linked card.',
  },
  {
    type: 'affirm',
    label: 'Affirm',
    group: 'more',
    capability: 'affirm_payments',
    help: 'Buyers pay in instalments; you receive the full amount.',
  },
  {
    type: 'klarna',
    label: 'Klarna',
    group: 'more',
    capability: 'klarna_payments',
    help: 'Buyers pay in instalments; you receive the full amount.',
  },
  {
    type: 'afterpay_clearpay',
    label: 'Afterpay',
    group: 'more',
    capability: 'afterpay_clearpay_payments',
    help: 'Buyers pay in instalments; you receive the full amount.',
  },
];

export const PAYMENT_METHOD_TYPES = new Set(PAYMENT_METHOD_ALLOWLIST.map((m) => m.type));

/** Card brands and wallets Stripe Checkout offers with the `card` type. Display only. */
export const ALWAYS_ON_METHODS = {
  cards: ['visa', 'mastercard', 'amex', 'discover', 'diners', 'jcb'],
  wallets: ['apple_pay', 'google_pay'],
};
