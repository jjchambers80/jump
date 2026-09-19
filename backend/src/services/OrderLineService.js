// Order Line Service (spec 024)
// The order-side amount snapshot of a paid application: totals plus real
// lines — one APPLICATION_TIER item, an OrderAddOn per add-on, and a signed
// ADJUSTMENT / WAIVER item per manual line. Rewritten wholesale whenever the
// amount changes before money moves (add-on edit, tier change, adjustment,
// waive); never touched once paid — money that has moved is only refunded.
//
// Fee math is unchanged from spec 011/012/018: `applicationLines` folds the
// adjustment total into the tier line so FeeService never sees a negative
// item, and every add-on line keeps its exact share.

import { applicationAmounts, applicationLines } from './ApplicationFormService.js';

import { adjustmentItems, adjustmentTotal, buyerLineTotal, tierItem } from './orderLines.js';

export { adjustmentItems, adjustmentTotal, buyerLineTotal, tierItem };

class OrderLineService {
  /**
   * Totals and lines for a tier, its add-on lines and manual adjustments.
   * @param {object} tier ApplicationTier
   * @param {object} form ApplicationForm (feeMode, taxable)
   * @param {Array<{ addOn, quantity }>} addOnLines validated lines in display order
   * @param {Array<{ kind, unitPrice, quantity?, description, createdById?, createdAt? }>} adjustments existing ADJUSTMENT / WAIVER items to keep
   * @param {object} event (taxRate)
   * @param {object} organization (taxInclusivePricing)
   * @returns {{ amounts, items, addOns }} `amounts` is the applicationAmounts shape; `items` / `addOns` are Prisma create rows
   */
  applicationOrderData(tier, form, addOnLines, adjustments, event, organization) {
    const total = adjustmentTotal(adjustments);
    const amounts = applicationAmounts(
      applicationLines(tier, form, addOnLines, total),
      form,
      event,
      organization
    );
    const [tierLine, ...addOnShares] = amounts.lines;
    const items = [
      {
        kind: 'APPLICATION_TIER',
        applicationTierId: tier.id,
        description: tier.name,
        quantity: 1,
        unitPrice: Number(tier.price),
        platformFee: tierLine.platformFee,
        processingFee: tierLine.processingFee,
        tax: tierLine.tax,
      },
      ...(adjustments || []).map((adj) => ({
        ...(adj.id && { id: adj.id }), // keep ids stable across rewrites (removeAdjustment addresses them)
        kind: adj.kind,
        description: adj.description,
        quantity: 1,
        unitPrice: Number(adj.unitPrice),
        createdById: adj.createdById ?? null,
        ...(adj.createdAt && { createdAt: adj.createdAt }),
      })),
    ];
    const addOns = addOnLines.map((l, i) => ({
      addOnId: l.addOn.id,
      quantity: l.quantity,
      unitPrice: Number(l.addOn.price),
      platformFee: addOnShares[i].platformFee,
      processingFee: addOnShares[i].processingFee,
      tax: addOnShares[i].tax,
    }));
    return { amounts, items, addOns };
  }

  /** Order columns for an amounts snapshot. */
  totalsData(amounts) {
    return {
      totalAmount: amounts.applicantPays,
      subtotalAmount: amounts.subtotal,
      platformFeeAmount: amounts.platformFee,
      processingFeeAmount: amounts.processingFee,
      taxAmount: amounts.tax,
      orgReceives: amounts.orgReceives,
      feeMode: amounts.feeMode,
    };
  }

  /**
   * Replace every line and the totals of an application order inside `tx`.
   * @returns the order with items, add-ons (with add-on), payment and refunds
   */
  async rewriteApplicationOrder(tx, orderId, { amounts, items, addOns }, extraData = {}) {
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.orderAddOn.deleteMany({ where: { orderId } });
    return tx.order.update({
      where: { id: orderId },
      data: {
        ...this.totalsData(amounts),
        items: { create: items },
        addOns: { create: addOns },
        ...extraData,
      },
      include: ORDER_INCLUDE,
    });
  }

  /** "Vendor booth — 10×10 + Power ×1 (adjusted)" for list rows and logs. */
  describe(order) {
    if (!order) return '';
    if (order.kind === 'TICKET') {
      const tickets = (order.items || [])
        .map((i) => `${i.quantity} × ${i.priceTier?.name ?? i.description ?? 'ticket'}`)
        .join(', ');
      const addOns = (order.addOns || []).length;
      return [tickets, addOns ? `${addOns} add-on${addOns === 1 ? '' : 's'}` : null]
        .filter(Boolean)
        .join(' + ');
    }
    const tier = tierItem(order);
    const addOns = (order.addOns || [])
      .map((l) => `${l.addOn?.name ?? 'Add-on'} ×${l.quantity}`)
      .join(', ');
    const adjusted = adjustmentItems(order).length > 0;
    return (
      [tier?.description || 'Application', addOns || null].filter(Boolean).join(' + ') +
      (adjusted ? ' (adjusted)' : '')
    );
  }
}

/** Include for any read that needs an order's money: lines, payment, refunds. */
export const ORDER_INCLUDE = {
  items: {
    include: { applicationTier: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
  addOns: { include: { addOn: true }, orderBy: { addOn: { displayOrder: 'asc' } } },
  payment: true,
  refunds: { orderBy: { createdAt: 'asc' } },
};

export default new OrderLineService();
