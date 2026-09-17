// Fee Service
// Computes all-in pricing breakdown for orders (FTC junk fees compliance)
// Pass-through model: base ticket price + platform fee + processing fee + tax = total
//
// Tax-inclusive pricing (spec 009 phase 3): when the organization lists tier
// prices with tax already inside, the tax is backed out of the listed price
// (net = listed / (1 + rate)), fees are computed on the net amount, and the
// customer total is listed + fees. The invariant
//   total = subtotal + platformFee + processingFee + tax
// holds in both modes; `subtotal` is always the ex-tax amount.
// frontend/src/lib/fees.ts mirrors this file exactly.

import { FEE_CONFIG } from '../config/fees.js';

class FeeService {
  /**
   * Compute fee breakdown for a set of order items.
   *
   * @param {Array<{unitPrice: number, quantity: number, taxable?: boolean}>} items - Line items with listed price and quantity; `taxable: false` excludes a line from tax (add-ons, spec 012)
   * @param {number} [taxRate=0] - Effective tax rate as a decimal
   * @param {{ taxInclusive?: boolean }} [options]
   * @returns {{
   *   subtotal: number,
   *   platformFee: number,
   *   processingFee: number,
   *   tax: number,
   *   total: number,
   *   taxInclusive: boolean,
   *   itemBreakdowns: Array<{unitPrice: number, quantity: number, platformFee: number, processingFee: number, tax: number, lineTotal: number}>
   * }}
   */
  computeOrderFees(items, taxRate = 0, { taxInclusive = false } = {}) {
    const listed = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    // Add-ons (spec 012) may be untaxed; tiers are always taxable. Tax is
    // computed on the taxable listed value only, fees on the whole subtotal.
    const isTaxable = (item) => item.taxable !== false;
    const taxableListed = items.reduce((sum, item) => sum + (isTaxable(item) ? item.unitPrice * item.quantity : 0), 0);

    // Ex-tax base and tax: added on top, or backed out of the listed price
    const taxableNet = taxInclusive ? this._round(taxableListed / (1 + taxRate)) : this._round(taxableListed);
    const tax = taxInclusive ? this._round(taxableListed - taxableNet) : this._round(taxableNet * taxRate);
    const subtotal = this._round(listed - (taxInclusive ? tax : 0));

    // Platform fee on the ex-tax base price
    const platformFee = this._round(subtotal * FEE_CONFIG.platformFeePercent);

    // Processing fee on (subtotal + platformFee) — Stripe charges on the full amount
    const processingFee = this._round(
      (subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
    );

    const total = this._round(subtotal + platformFee + processingFee + tax);

    // Proportionally allocate fees across items by listed value, tax across
    // taxable items only
    const itemBreakdowns = items.map((item) => {
      const lineListed = item.unitPrice * item.quantity;
      const proportion = listed > 0 ? lineListed / listed : 0;
      const taxProportion = isTaxable(item) && taxableListed > 0 ? lineListed / taxableListed : 0;
      const lineTax = this._round(tax * taxProportion);
      const lineNet = taxInclusive ? this._round(lineListed - lineTax) : this._round(lineListed);

      return {
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        taxable: isTaxable(item),
        platformFee: this._round(platformFee * proportion),
        processingFee: this._round(processingFee * proportion),
        tax: lineTax,
        lineTotal: this._round(lineNet + platformFee * proportion + processingFee * proportion + lineTax),
      };
    });

    // Fix rounding drift: adjust largest item to match totals exactly
    if (itemBreakdowns.length > 1) {
      const allocatedPlatform = itemBreakdowns.reduce((s, b) => s + b.platformFee, 0);
      const allocatedProcessing = itemBreakdowns.reduce((s, b) => s + b.processingFee, 0);
      const allocatedTax = itemBreakdowns.reduce((s, b) => s + b.tax, 0);
      const value = (b) => b.unitPrice * b.quantity;
      const largest = itemBreakdowns.reduce((max, b, i) => (value(b) > value(itemBreakdowns[max]) ? i : max), 0);
      // Tax drift lands on the largest taxable line, never on an untaxed one
      const largestTaxable = itemBreakdowns.reduce(
        (max, b, i) => (b.taxable && (max === -1 || value(b) > value(itemBreakdowns[max])) ? i : max),
        -1
      );

      const platformDrift = this._round(platformFee - allocatedPlatform);
      const processingDrift = this._round(processingFee - allocatedProcessing);
      const taxDrift = this._round(tax - allocatedTax);

      itemBreakdowns[largest].platformFee = this._round(itemBreakdowns[largest].platformFee + platformDrift);
      itemBreakdowns[largest].processingFee = this._round(itemBreakdowns[largest].processingFee + processingDrift);
      itemBreakdowns[largest].lineTotal = this._round(itemBreakdowns[largest].lineTotal + platformDrift + processingDrift);
      if (largestTaxable !== -1) {
        itemBreakdowns[largestTaxable].tax = this._round(itemBreakdowns[largestTaxable].tax + taxDrift);
        // Tax drift only moves the line total when tax is added on top; inside a
        // listed price it shifts net vs tax without changing what is charged.
        if (!taxInclusive) {
          itemBreakdowns[largestTaxable].lineTotal = this._round(itemBreakdowns[largestTaxable].lineTotal + taxDrift);
        }
      }
    }

    return {
      subtotal,
      platformFee,
      processingFee,
      tax,
      total,
      taxInclusive,
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
