// Pure fee math for customer-facing all-in pricing (FTC junk fee compliance).
// Mirrors backend/src/services/FeeService.js exactly — including the proportional
// per-line allocation and the rounding-drift correction — so what the cart shows
// is what the order will charge. No React here.
//
// Tax-inclusive pricing (spec 009 phase 3): when `taxInclusive` is set the listed
// tier price already contains tax. Tax is backed out (net = listed / (1 + rate)),
// fees are computed on the net, and the customer total is listed + fees.
// `subtotal` / `base` are always the ex-tax amounts in both modes.

/** Must match backend/src/config/fees.js. */
export const FEE_CONFIG = {
  platformFeePercent: 0.05, // 5% service fee on base price
  stripeFeePercent: 0.029, // Stripe's 2.9%
  stripeFeeFixed: 0.3, // Stripe's $0.30 per transaction (once per order, not per ticket)
} as const;

export interface FeeItem {
  price: number;
  quantity: number;
  /** `false` excludes the line from tax (untaxed add-ons, spec 012). Tiers are always taxable. */
  taxable?: boolean;
}

/** Cost components that make up one cart line's price. */
export interface LineBreakdown {
  unitPrice: number;
  quantity: number;
  taxable: boolean;
  /** Ex-tax line amount: unitPrice × quantity, minus the line's tax when tax-inclusive */
  base: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  /** base + platformFee + processingFee + tax */
  total: number;
}

export interface OrderFees {
  subtotal: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  total: number;
  /** Listed prices already include tax (backed out into `tax`). */
  taxInclusive: boolean;
  /** One entry per input item, same order. Line totals sum to `total`. */
  lines: LineBreakdown[];
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

/**
 * All-in price for a single ticket of a tier, as if it were the whole order.
 * Used on tier cards where the customer has not built a cart yet.
 * `basePrice` is the ex-tax amount (the listed price unless tax-inclusive).
 */
export function computeTierAllInPrice(listedPrice: number, taxRate: number = 0, taxInclusive: boolean = false) {
  const basePrice = taxInclusive ? roundCurrency(listedPrice / (1 + taxRate)) : roundCurrency(listedPrice);
  const tax = taxInclusive ? roundCurrency(listedPrice - basePrice) : roundCurrency(basePrice * taxRate);
  const platformFee = roundCurrency(basePrice * FEE_CONFIG.platformFeePercent);
  const processingFee = roundCurrency(
    (basePrice + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
  );
  /** platformFee + processingFee — the single "Fees" figure shown on tier cards. */
  const fees = roundCurrency(platformFee + processingFee);
  const total = roundCurrency(basePrice + fees + tax);
  return { listedPrice, basePrice, platformFee, processingFee, fees, tax, total, taxInclusive };
}

/**
 * Fee breakdown for a whole order plus a per-line allocation.
 * Platform and processing fees are computed on the order subtotal, then split across
 * lines proportionally by line value; any cent of rounding drift lands on the largest
 * line so the lines always add up to the order total.
 */
export function computeOrderFees(items: FeeItem[], taxRate: number = 0, taxInclusive: boolean = false): OrderFees {
  const listed = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Tax on the taxable listed value only; fees on the whole ex-tax subtotal.
  const isTaxable = (item: FeeItem) => item.taxable !== false;
  const taxableListed = items.reduce((sum, item) => sum + (isTaxable(item) ? item.price * item.quantity : 0), 0);
  const taxableNet = taxInclusive ? roundCurrency(taxableListed / (1 + taxRate)) : roundCurrency(taxableListed);
  const tax = taxInclusive ? roundCurrency(taxableListed - taxableNet) : roundCurrency(taxableNet * taxRate);
  const subtotal = roundCurrency(listed - (taxInclusive ? tax : 0));
  const platformFee = roundCurrency(subtotal * FEE_CONFIG.platformFeePercent);
  // No lines means no charge: an empty cart must not carry Stripe's fixed fee.
  // (A $0 tier still does — free tickets go through Checkout like any other.)
  const processingFee =
    items.length === 0
      ? 0
      : roundCurrency((subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed);
  const total = roundCurrency(subtotal + platformFee + processingFee + tax);

  const lines: LineBreakdown[] = items.map((item) => {
    const lineListed = roundCurrency(item.price * item.quantity);
    const proportion = listed > 0 ? lineListed / listed : 0;
    const taxProportion = isTaxable(item) && taxableListed > 0 ? lineListed / taxableListed : 0;
    const linePlatform = roundCurrency(platformFee * proportion);
    const lineProcessing = roundCurrency(processingFee * proportion);
    const lineTax = roundCurrency(tax * taxProportion);
    const base = taxInclusive ? roundCurrency(lineListed - lineTax) : lineListed;
    return {
      unitPrice: item.price,
      quantity: item.quantity,
      taxable: isTaxable(item),
      base,
      platformFee: linePlatform,
      processingFee: lineProcessing,
      tax: lineTax,
      total: roundCurrency(base + linePlatform + lineProcessing + lineTax),
    };
  });

  if (lines.length > 1) {
    const value = (line: LineBreakdown) => line.unitPrice * line.quantity;
    const largest = lines.reduce((max, line, i) => (value(line) > value(lines[max]) ? i : max), 0);
    // Tax drift lands on the largest taxable line, never on an untaxed one.
    const largestTaxable = lines.reduce(
      (max, line, i) => (line.taxable && (max === -1 || value(line) > value(lines[max])) ? i : max),
      -1
    );
    const platformDrift = roundCurrency(platformFee - lines.reduce((s, l) => s + l.platformFee, 0));
    const processingDrift = roundCurrency(
      processingFee - lines.reduce((s, l) => s + l.processingFee, 0)
    );
    const taxDrift = roundCurrency(tax - lines.reduce((s, l) => s + l.tax, 0));
    const target = lines[largest];
    target.platformFee = roundCurrency(target.platformFee + platformDrift);
    target.processingFee = roundCurrency(target.processingFee + processingDrift);
    target.total = roundCurrency(target.base + target.platformFee + target.processingFee + target.tax);
    if (largestTaxable !== -1) {
      const taxTarget = lines[largestTaxable];
      taxTarget.tax = roundCurrency(taxTarget.tax + taxDrift);
      // Inside a listed price, tax drift moves net vs tax, not what is charged.
      if (taxInclusive) taxTarget.base = roundCurrency(taxTarget.base - taxDrift);
      taxTarget.total = roundCurrency(taxTarget.base + taxTarget.platformFee + taxTarget.processingFee + taxTarget.tax);
    }
  }

  return { subtotal, platformFee, processingFee, tax, total, taxInclusive, lines };
}
