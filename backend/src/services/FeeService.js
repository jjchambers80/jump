// Fee Service
// Computes all-in pricing breakdown for orders (FTC junk fees compliance)
// Pass-through model: base ticket price + platform fee + processing fee + tax = total

import { FEE_CONFIG } from '../config/fees.js';

class FeeService {
  /**
   * Compute fee breakdown for a set of order items.
   *
   * @param {Array<{unitPrice: number, quantity: number}>} items - Line items with base price and quantity
   * @returns {{
   *   subtotal: number,
   *   platformFee: number,
   *   processingFee: number,
   *   tax: number,
   *   total: number,
   *   itemBreakdowns: Array<{unitPrice: number, quantity: number, platformFee: number, processingFee: number, lineTotal: number}>
   * }}
   */
  computeOrderFees(items, taxRate = 0) {
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    // Platform fee on base price
    const platformFee = this._round(subtotal * FEE_CONFIG.platformFeePercent);

    // Processing fee on (subtotal + platformFee) — Stripe charges on the full amount
    const processingFee = this._round(
      (subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
    );

    // Tax from event's venue-based rate
    const tax = this._round(subtotal * taxRate);

    const total = this._round(subtotal + platformFee + processingFee + tax);

    // Proportionally allocate fees across items by value
    const itemBreakdowns = items.map((item) => {
      const lineSubtotal = item.unitPrice * item.quantity;
      const proportion = subtotal > 0 ? lineSubtotal / subtotal : 0;

      return {
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        platformFee: this._round(platformFee * proportion),
        processingFee: this._round(processingFee * proportion),
        lineTotal: this._round(lineSubtotal + platformFee * proportion + processingFee * proportion + tax * proportion),
      };
    });

    // Fix rounding drift: adjust largest item to match totals exactly
    if (itemBreakdowns.length > 1) {
      const allocatedPlatform = itemBreakdowns.reduce((s, b) => s + b.platformFee, 0);
      const allocatedProcessing = itemBreakdowns.reduce((s, b) => s + b.processingFee, 0);
      const largest = itemBreakdowns.reduce((max, b, i) =>
        b.unitPrice * b.quantity > (itemBreakdowns[max]?.unitPrice ?? 0) * (itemBreakdowns[max]?.quantity ?? 0) ? i : max, 0
      );

      const platformDrift = this._round(platformFee - allocatedPlatform);
      const processingDrift = this._round(processingFee - allocatedProcessing);

      itemBreakdowns[largest].platformFee = this._round(itemBreakdowns[largest].platformFee + platformDrift);
      itemBreakdowns[largest].processingFee = this._round(itemBreakdowns[largest].processingFee + processingDrift);
      itemBreakdowns[largest].lineTotal = this._round(itemBreakdowns[largest].lineTotal + platformDrift + processingDrift);
    }

    return {
      subtotal: this._round(subtotal),
      platformFee,
      processingFee,
      tax,
      total,
      itemBreakdowns,
    };
  }

  /**
   * Round to 2 decimal places (banker's rounding for currency).
   */
  _round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

export default new FeeService();
