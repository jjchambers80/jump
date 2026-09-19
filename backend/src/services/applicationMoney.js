// Spec 024: the money view of an application, read from its order. Every
// serializer, template and report that used to read amount / Stripe / refund
// columns on Application reads this instead, so the API shapes are unchanged
// while the ledger lives on Order / PaymentTransaction / Refund.

import { adjustmentItems, buyerLineTotal } from './orderLines.js';

const num = (v) => Number(v || 0);
const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

const EMPTY = Object.freeze({
  orderId: null,
  orderRef: null,
  orderStatus: null,
  subtotal: 0,
  platformFee: 0,
  processingFee: 0,
  tax: 0,
  applicantPays: 0,
  orgReceives: 0,
  feeMode: 'PASS',
  currency: 'usd',
  paidAt: null,
  paymentDueAt: null,
  stripePaymentIntentId: null,
  stripeAccountId: null,
  applicationFee: null,
  paymentSource: 'STRIPE',
  offlinePayment: null,
  refunds: [],
  refundedTotal: 0,
  addOns: [],
  adjustments: [],
});

/**
 * @param {object} application with `order` (items, addOns.addOn, payment, refunds) when it has one
 * @param {{ taxInclusive?: boolean }} [options]
 */
export function moneyOf(application, { taxInclusive = false } = {}) {
  const order = application?.order;
  if (!order) return { ...EMPTY, feeMode: application?.form?.feeMode ?? 'PASS' };
  const payment = order.payment || null;
  const refunds = order.refunds || [];
  const waived = (order.items || []).some((i) => i.kind === 'WAIVER');
  const offline = payment?.source === 'OFFLINE' || waived;
  return {
    orderId: order.id,
    orderRef: order.orderRef,
    orderStatus: order.status,
    subtotal: num(order.subtotalAmount),
    platformFee: num(order.platformFeeAmount),
    processingFee: num(order.processingFeeAmount),
    tax: num(order.taxAmount),
    applicantPays: num(order.totalAmount),
    orgReceives: num(order.orgReceives),
    feeMode: order.feeMode,
    currency: order.currency,
    paidAt: order.paidAt,
    paymentDueAt: order.dueAt,
    stripePaymentIntentId: payment?.stripePaymentIntentId ?? null,
    stripeAccountId: payment?.stripeAccountId ?? null,
    applicationFee: payment?.applicationFee == null ? null : num(payment.applicationFee),
    paymentSource: offline ? 'OFFLINE' : 'STRIPE',
    offlinePayment:
      payment?.source === 'OFFLINE' && payment.offlineMethod
        ? {
            method: payment.offlineMethod,
            reference: payment.offlineReference,
            recordedById: payment.recordedById,
          }
        : null,
    refunds,
    refundedTotal: round(
      refunds.filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + num(r.amount), 0)
    ),
    addOns: (order.addOns || []).map((l) => ({
      id: l.id,
      addOnId: l.addOnId,
      addOn: l.addOn,
      name: l.addOn?.name ?? null,
      quantity: l.quantity,
      unitPrice: num(l.unitPrice),
      applicantPays: buyerLineTotal(l, order.feeMode, { taxInclusive }),
    })),
    adjustments: adjustmentItems(order).map((i) => ({
      id: i.id,
      kind: i.kind,
      amount: num(i.unitPrice),
      reason: i.description,
      createdById: i.createdById,
      createdAt: i.createdAt,
    })),
  };
}
