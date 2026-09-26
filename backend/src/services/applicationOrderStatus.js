// Spec 024: the one mapping from an application's fine-grained state to the
// coarse money state of its order. Every write that changes `status` or
// `paymentStatus` goes through ApplicationService._transition, which writes
// the mapped value to Order.status in the same transaction, so the two never
// drift.

/** Payment statuses in which money has moved and the review outcome no longer cancels the order. */
export const MONEY_MOVED = new Set(['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']);

const BY_PAYMENT_STATUS = {
  AWAITING_CARD: 'PENDING',
  CARD_ON_FILE: 'PENDING',
  PROCESSING: 'PENDING',
  PAYMENT_DUE: 'PENDING',
  PAID: 'COMPLETED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  // A PAID-form application at NOT_REQUIRED is a waived balance: settled, total 0.
  NOT_REQUIRED: 'COMPLETED',
  // Spec 037 phase 5: under review, or approved and still choosing a space.
  // Nothing is owed yet, so an order the application still carries (an
  // expired selection, or one from before apply-then-choose) is not live.
  NOT_DUE: 'CANCELLED',
  AWAITING_SELECTION: 'CANCELLED',
};

/**
 * Spec 037 phase 5: whether the application's order is the live amount. An
 * order is reopened at selection and cancelled again when the hold lapses; a
 * cancelled order on an application that is still in play is a leftover, not
 * a record of what the vendor owes. Rejected / withdrawn applications keep
 * their cancelled order as history.
 */
export function hasLiveOrder(application) {
  const order = application?.order;
  if (!order) return false;
  if (order.status !== 'CANCELLED') return true;
  return !['SUBMITTED', 'WAITLISTED', 'APPROVED'].includes(application.status);
}

/**
 * @param {{ status: string, paymentStatus: string }} application
 * @returns {'PENDING'|'COMPLETED'|'CANCELLED'|'REFUNDED'|'PARTIALLY_REFUNDED'}
 */
export function orderStatusFor(application) {
  if (
    ['REJECTED', 'WITHDRAWN'].includes(application.status) &&
    !MONEY_MOVED.has(application.paymentStatus)
  )
    return 'CANCELLED';
  return BY_PAYMENT_STATUS[application.paymentStatus] || 'PENDING';
}
