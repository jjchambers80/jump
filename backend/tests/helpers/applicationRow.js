// Spec 024 test helper: an application row flattened with its order's money
// the way the pre-024 columns read (applicantPays, stripePaymentIntentId,
// paymentDueAt, refunds…), so contract assertions written against the
// application ledger keep their meaning against the order ledger.

import { prisma } from '@jump/db';
import { moneyOf } from '../../src/services/applicationMoney.js';
import { ORDER_INCLUDE } from '../../src/services/OrderLineService.js';

export async function appRow(id, include = {}) {
  const a = await prisma.application.findUnique({
    where: { id },
    include: { ...include, order: { include: ORDER_INCLUDE } },
  });
  if (!a) return null;
  const m = moneyOf(a);
  return {
    ...a,
    orderId: m.orderId,
    orderRef: m.orderRef,
    orderStatus: m.orderStatus,
    subtotal: m.subtotal,
    platformFee: m.platformFee,
    processingFee: m.processingFee,
    tax: m.tax,
    applicantPays: m.applicantPays,
    orgReceives: m.orgReceives,
    feeMode: m.feeMode,
    stripePaymentIntentId: m.stripePaymentIntentId,
    stripeAccountId: m.stripeAccountId,
    applicationFee: m.applicationFee,
    paidAt: m.paidAt,
    paymentDueAt: m.paymentDueAt,
    paymentSource: m.paymentSource,
    offlinePaymentMethod: m.offlinePayment?.method ?? null,
    offlinePaymentReference: m.offlinePayment?.reference ?? null,
    refunds: m.refunds,
    addOns: m.addOns,
    adjustments: m.adjustments.map((adj) => ({ ...adj, amount: adj.amount })),
  };
}

/** Move an application's payment-due clock (Order.dueAt). */
export async function setDueAt(applicationId, dueAt) {
  await prisma.order.updateMany({ where: { applicationId }, data: { dueAt } });
}

/** Delete the application orders (payments, refunds, lines) of an organization's contacts. */
export async function cleanupApplicationOrders(organizationId) {
  const where = { kind: 'APPLICATION', contact: { organizationId } };
  await prisma.refund.deleteMany({ where: { order: where } }).catch(() => {});
  await prisma.paymentTransaction.deleteMany({ where: { order: where } }).catch(() => {});
  await prisma.order.deleteMany({ where }).catch(() => {});
}

/**
 * Give a fixture application (created straight through Prisma on a PAID form)
 * the order that ApplicationService.submit would have created, priced from
 * its tier today. Returns the order. `orderData` overrides order columns
 * (paidAt, dueAt, status…); the status defaults to the mapping.
 */
export async function attachOrder(applicationId, orderData = {}) {
  const [{ default: orderService }, { default: orderLineService }, { orderStatusFor }] =
    await Promise.all([
      import('../../src/services/OrderService.js'),
      import('../../src/services/OrderLineService.js'),
      import('../../src/services/applicationOrderStatus.js'),
    ]);
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      tier: true,
      form: true,
      event: { include: { venue: { include: { organization: true } } } },
    },
  });
  if (!application?.tier) throw new Error('attachOrder needs a tiered (PAID) application');
  const data = orderLineService.applicationOrderData(
    application.tier,
    application.form,
    [],
    [],
    application.event,
    application.event.venue.organization
  );
  const order = await prisma.$transaction((tx) =>
    orderService.createApplicationOrder(tx, { application, data })
  );
  return prisma.order.update({
    where: { id: order.id },
    data: { status: orderStatusFor(application), ...orderData },
  });
}
