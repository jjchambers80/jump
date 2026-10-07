// Spec 037 phase 5 (apply-then-choose): small pure helpers shared by the
// application, payment, template and digest services. Imports only pure
// utils, safe from any module.
//
// The payment clock starts at approval: an approved vendor has
// `form.paymentDueDays` from the decision to choose a space and pay. Before
// they choose there is no order to carry `dueAt`, so the date is derived from
// `decidedAt` (the approval is the last decision an APPROVED row has); once
// they choose, the order's `dueAt` is set to the same instant.
//
// The clock runs to the end of the due day in the organization's zone: an
// email that says "pay by October 6" must not withdraw at 5:29 PM on the 6th.

import { DEFAULT_ZONE, instantToZonedInput, zonedInputToInstant } from '../utils/eventTime.js';

const DAY_MS = 86_400_000;

// ponytail: every organization is Eastern until spec 021 adds
// `Organization.timezone`; read it here then (see VenueService.defaultTimeZoneFor).
export const DUE_ZONE = DEFAULT_ZONE;

/** 23:59:59.999 in the organization's zone on the day `days` after `start`. */
export function dueAtEndOfDay(start, days) {
  const day = instantToZonedInput(new Date(new Date(start).getTime() + days * DAY_MS), DUE_ZONE).slice(0, 10);
  return new Date(zonedInputToInstant(`${day}T23:59`, DUE_ZONE).getTime() + 59_999);
}

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
  return dueAtEndOfDay(decidedAt, application.form?.paymentDueDays ?? 7);
}

/** True while an approved application holds a chosen space (booth or category slot) for payment. */
export function holdsSelection(application, now = new Date()) {
  return Boolean(
    application?.selectionHeldUntil &&
      ['PAYMENT_DUE', 'PROCESSING'].includes(application.paymentStatus) &&
      (application.paymentStatus === 'PROCESSING' || new Date(application.selectionHeldUntil) > now)
  );
}
