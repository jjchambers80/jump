// Spec 037 phase 5 (apply-then-choose): small pure helpers shared by the
// application, payment, template and digest services. No imports, safe from
// any module.
//
// The payment clock starts at approval: an approved vendor has
// `form.paymentDueDays` from the decision to choose a space and pay. Before
// they choose there is no order to carry `dueAt`, so the date is derived from
// `decidedAt` (the approval is the last decision an APPROVED row has); once
// they choose, the order's `dueAt` is set to the same instant.

const DAY_MS = 86_400_000;

/** Payment statuses in which an approved PAID application still has to choose a space. */
export const CHOOSING = 'AWAITING_SELECTION';

/** When an approved application must have chosen and paid by; null when the clock has not started. */
export function selectionDueAt(application) {
  if (!application || application.status !== 'APPROVED') return null;
  if (application.paymentStatus !== CHOOSING) {
    // Holding / paying a space: the order carries the same clock.
    const orderDue = application.order?.dueAt;
    return orderDue && ['PAYMENT_DUE', 'PROCESSING'].includes(application.paymentStatus) ? new Date(orderDue) : null;
  }
  const decidedAt = application.decidedAt ? new Date(application.decidedAt) : null;
  if (!decidedAt) return null;
  const days = application.form?.paymentDueDays ?? 7;
  return new Date(decidedAt.getTime() + days * DAY_MS);
}

/** True while an approved application holds a chosen space (booth or category slot) for payment. */
export function holdsSelection(application, now = new Date()) {
  return Boolean(
    application?.selectionHeldUntil &&
      ['PAYMENT_DUE', 'PROCESSING'].includes(application.paymentStatus) &&
      (application.paymentStatus === 'PROCESSING' || new Date(application.selectionHeldUntil) > now)
  );
}
