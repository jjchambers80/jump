// Fee Service
// Computes all-in pricing breakdown for orders (FTC junk fees compliance)
// Pass-through model: base ticket price + platform fee + processing fee + tax = total
//
// Tax-inclusive pricing (spec 009 phase 3): when the organization lists tier
// prices with tax already inside, the tax is backed out of the listed price
// (net = listed / (1 + rate)), fees are computed on the net amount, and the
// customer total is listed + fees. `subtotal` is always the ex-tax amount.
//
// Per-line rate and fee mode (spec 047 D0-B): each item may carry its own
// `platformFeeRate` (default FEE_CONFIG.platformFeePercent) and `feeMode`
// ('PASS' default | 'ABSORB'). The platform fee is Σ net × rate, rounded once;
// processing stays once per order on (subtotal + platformFee). An ABSORB line
// charges the buyer its listed price (plus tax on top) and its fee shares come
// out of the organization's share as `absorbedFees`. The invariants
//   total       = subtotal + platformFee + processingFee + tax − absorbedFees
//   orgReceives = subtotal − absorbedFees
// hold in both tax modes; with every line default, absorbedFees = 0.
// frontend/src/lib/fees.ts mirrors this file exactly; both are asserted
// against backend/tests/fixtures/fees.fixtures.json.

import { FEE_CONFIG } from '../config/fees.js';

class FeeService {
  /**
   * Compute fee breakdown for a set of order items.
   *
   * @param {Array<{unitPrice: number, quantity: number, taxable?: boolean, platformFeeRate?: number, feeMode?: 'PASS'|'ABSORB'}>} items - Line items with listed price and quantity; `taxable: false` excludes a line from tax (add-ons, spec 012); `platformFeeRate` / `feeMode` per line (spec 047)
   * @param {number} [taxRate=0] - Effective tax rate as a decimal
   * @param {{ taxInclusive?: boolean }} [options]
   * @returns {{
   *   subtotal: number,
   *   platformFee: number,
   *   processingFee: number,
   *   tax: number,
   *   total: number,
   *   absorbedFees: number,
   *   orgReceives: number,
   *   taxInclusive: boolean,
   *   itemBreakdowns: Array<{unitPrice: number, quantity: number, taxable: boolean, platformFeeRate: number, feeMode: string, base: number, platformFee: number, processingFee: number, tax: number, absorbedFees: number, lineTotal: number}>
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

    // Platform fee on the ex-tax base price, each line at its own rate, rounded
    // once on the sum. Written as subtotal × maxRate × (Σ net·k / Σ net) with
    // k = rate / maxRate, so a uniform-rate order is exactly subtotal × rate.
    const rateOf = (item) => item.platformFeeRate ?? FEE_CONFIG.platformFeePercent;
    const maxRate = items.reduce((m, item) => Math.max(m, rateOf(item)), 0);
    const k = (item) => (maxRate > 0 ? rateOf(item) / maxRate : 0);
    const nets = items.map((item) => {
      const lineListed = item.unitPrice * item.quantity;
      if (!taxInclusive || !isTaxable(item) || taxableListed <= 0) return lineListed;
      return lineListed - this._round(tax * (lineListed / taxableListed));
    });
    const netSum = nets.reduce((s, n) => s + n, 0);
    const ratedNet = items.reduce((s, item, i) => s + nets[i] * k(item), 0);
    const platformFee = netSum > 0 ? this._round(subtotal * maxRate * (ratedNet / netSum)) : 0;
    // Platform fee is allocated by listed value × k (a 0% line gets none)
    const ratedListed = items.reduce((s, item) => s + item.unitPrice * item.quantity * k(item), 0);

    // Processing fee on (subtotal + platformFee) — Stripe charges on the full amount.
    // No lines means no charge: an empty cart must not carry the fixed fee
    // (a $0 tier still does — free tickets go through Checkout like any other).
    const processingFee =
      items.length === 0
        ? 0
        : this._round((subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed);

    // Proportionally allocate fees across items by listed value (platform fee
    // by listed value × rate), tax across taxable items only
    const itemBreakdowns = items.map((item) => {
      const lineListed = item.unitPrice * item.quantity;
      const proportion = listed > 0 ? lineListed / listed : 0;
      const platformProportion = ratedListed > 0 ? (lineListed * k(item)) / ratedListed : 0;
      const taxProportion = isTaxable(item) && taxableListed > 0 ? lineListed / taxableListed : 0;

      return {
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        taxable: isTaxable(item),
        platformFeeRate: rateOf(item),
        feeMode: item.feeMode === 'ABSORB' ? 'ABSORB' : 'PASS',
        base: 0,
        platformFee: this._round(platformFee * platformProportion),
        processingFee: this._round(processingFee * proportion),
        tax: this._round(tax * taxProportion),
        absorbedFees: 0,
        lineTotal: 0,
      };
    });

    // Fix rounding drift so the lines add up to the order exactly (a single
    // $0 line has no proportion at all and takes the whole fixed fee here)
    if (itemBreakdowns.length > 0) {
      const value = (b) => b.unitPrice * b.quantity;
      const largestWhere = (pred) =>
        itemBreakdowns.reduce((max, b, i) => (pred(b) && (max === -1 || value(b) > value(itemBreakdowns[max])) ? i : max), -1);
      const largest = largestWhere(() => true);
      // Platform drift lands on the largest line with a non-zero rate, tax
      // drift on the largest taxable line — never on a 0% or untaxed one
      const largestRated = largestWhere((b) => b.platformFeeRate > 0);
      const largestTaxable = largestWhere((b) => b.taxable);

      const platformDrift = this._round(platformFee - itemBreakdowns.reduce((s, b) => s + b.platformFee, 0));
      const processingDrift = this._round(processingFee - itemBreakdowns.reduce((s, b) => s + b.processingFee, 0));
      const taxDrift = this._round(tax - itemBreakdowns.reduce((s, b) => s + b.tax, 0));

      if (largestRated !== -1) {
        itemBreakdowns[largestRated].platformFee = this._round(itemBreakdowns[largestRated].platformFee + platformDrift);
      }
      itemBreakdowns[largest].processingFee = this._round(itemBreakdowns[largest].processingFee + processingDrift);
      if (largestTaxable !== -1) {
        itemBreakdowns[largestTaxable].tax = this._round(itemBreakdowns[largestTaxable].tax + taxDrift);
      }
    }

    // Line totals from the final shares. Inside a listed price the tax is part
    // of the listed value, so `base` is what is left once it is backed out.
    // ABSORB: the buyer pays the listed price (plus tax on top); the line's
    // fee shares come out of the organization's share.
    for (const b of itemBreakdowns) {
      const lineListed = this._round(b.unitPrice * b.quantity);
      b.base = taxInclusive ? this._round(lineListed - b.tax) : lineListed;
      if (b.feeMode === 'ABSORB') {
        b.absorbedFees = this._round(b.platformFee + b.processingFee);
        b.lineTotal = this._round(b.base + b.tax);
      } else {
        b.lineTotal = this._round(b.base + b.platformFee + b.processingFee + b.tax);
      }
    }
    const absorbedFees = this._round(itemBreakdowns.reduce((s, b) => s + b.absorbedFees, 0));
    const total = this._round(subtotal + platformFee + processingFee + tax - absorbedFees);
    const orgReceives = this._round(subtotal - absorbedFees);

    return {
      subtotal,
      platformFee,
      processingFee,
      tax,
      total,
      absorbedFees,
      orgReceives,
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
