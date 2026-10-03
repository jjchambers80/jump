// Self-serve refund policy (spec 031 phase 2). One pure evaluation shared by
// the buyer refund route (enforcement) and the buyer ticket serializer (what
// the account page shows), so the two can never disagree. Staff refunds from
// /admin/orders never go through here: they refund the full amount at any time.

import { ticketAmountPaid } from './ticketAmounts.js';

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

export const REFUND_POLICY_MESSAGES = {
  DISABLED: 'This organization does not offer self-service refunds',
  TIER: 'This ticket is not eligible for refund',
  STATUS: 'Only valid tickets can be refunded',
  WINDOW_CLOSED: 'The refund window for this event has closed',
  ZERO: 'The refund fee leaves nothing to return for this ticket',
};

/** Fields the evaluation needs from the organization row. */
export const REFUND_POLICY_SELECT = {
  selfServeRefundsEnabled: true,
  selfServeRefundCutoffHours: true,
  selfServeRefundFeeType: true,
  selfServeRefundFeeValue: true,
};

/** Fee kept by the organization for a self-serve refund of `pricePaid`. */
export function refundFee(policy, pricePaid) {
  const price = Number(pricePaid) || 0;
  const value = Number(policy.selfServeRefundFeeValue) || 0;
  if (price <= 0 || value <= 0) return 0;
  if (policy.selfServeRefundFeeType === 'FIXED') return round(Math.min(value, price));
  if (policy.selfServeRefundFeeType === 'PERCENT') return round(Math.min(price, (price * value) / 100));
  return 0;
}

/** Last moment a buyer may refund a ticket for an event starting at `eventDate`. */
export function refundDeadline(policy, eventDate) {
  const start = new Date(eventDate);
  if (Number.isNaN(start.getTime())) return null;
  const hours = policy.selfServeRefundCutoffHours;
  if (hours == null) return start;
  return new Date(start.getTime() - hours * 3600 * 1000);
}

/**
 * Evaluate whether `ticket` may be self-refunded under `policy` right now.
 *
 * The quoted `refundAmount` is what the buyer actually paid for the ticket —
 * the listed price plus its share of fees and tax (`ticketAmountPaid`) — less
 * the policy fee, so the quote always matches what `refundTicket` returns.
 * The fee itself stays a function of the listed price, which is what the
 * organizer set the policy against.
 *
 * @param {object} policy - organization row (REFUND_POLICY_SELECT fields)
 * @param {object} ticket - `{ status, pricePaid, priceTier: { isRefundable }, event: { date } }`,
 *   ideally queried with `TICKET_AMOUNT_INCLUDE`
 * @param {Date} [now]
 * @returns {{ eligible: boolean, reason: string|null, deadline: Date|null, fee: number, refundAmount: number }}
 */
export function evaluateRefundPolicy(policy, ticket, now = new Date()) {
  const deadline = refundDeadline(policy, ticket.event?.date);
  const listedPrice = round(Number(ticket.pricePaid) || 0);
  const amountPaid = ticketAmountPaid(ticket);
  const fee = refundFee(policy, listedPrice);
  const refundAmount = round(amountPaid - fee);
  const result = { eligible: false, reason: null, deadline, fee, refundAmount };

  if (!policy.selfServeRefundsEnabled) return { ...result, reason: 'DISABLED' };
  if (!ticket.priceTier?.isRefundable) return { ...result, reason: 'TIER' };
  if (ticket.status !== 'VALID') return { ...result, reason: 'STATUS' };
  if (!deadline || now >= deadline) return { ...result, reason: 'WINDOW_CLOSED' };
  if (refundAmount <= 0) return { ...result, reason: 'ZERO' };
  return { ...result, eligible: true };
}
