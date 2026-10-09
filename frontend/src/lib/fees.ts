// Pure fee math for customer-facing all-in pricing (FTC junk fee compliance).
// Mirrors backend/src/services/FeeService.js exactly — including the proportional
// per-line allocation and the rounding-drift correction — so what the cart shows
// is what the order will charge. No React here.
//
// Tax-inclusive pricing (spec 009 phase 3): when `taxInclusive` is set the listed
// tier price already contains tax. Tax is backed out (net = listed / (1 + rate)),
// fees are computed on the net, and the customer total is listed + fees.
// `subtotal` / `base` are always the ex-tax amounts in both modes.
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
// Both libraries are asserted against backend/tests/fixtures/fees.fixtures.json.

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
  /** Platform fee rate for this line (spec 047); default FEE_CONFIG.platformFeePercent. */
  platformFeeRate?: number;
  /** ABSORB: the buyer pays the listed price, the fees come out of the organization's share. */
  feeMode?: FeeMode;
}

export type FeeMode = 'PASS' | 'ABSORB';

/** Cost components that make up one cart line's price. */
export interface LineBreakdown {
  unitPrice: number;
  quantity: number;
  taxable: boolean;
  platformFeeRate: number;
  feeMode: FeeMode;
  /** Ex-tax line amount: unitPrice × quantity, minus the line's tax when tax-inclusive */
  base: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  /** ABSORB: platformFee + processingFee, borne by the organization. PASS: 0. */
  absorbedFees: number;
  /** What the buyer pays: base + platformFee + processingFee + tax − absorbedFees */
  total: number;
}

export interface OrderFees {
  subtotal: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  /** What the buyer pays: subtotal + platformFee + processingFee + tax − absorbedFees */
  total: number;
  /** Σ line absorbedFees */
  absorbedFees: number;
  /** subtotal − absorbedFees */
  orgReceives: number;
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
 * Platform fee (per-line rate) and processing fee are computed on the order, then split
 * across lines proportionally (platform fee by line value × rate, processing by line
 * value); a cent of rounding drift lands on the largest (non-zero-rate) line so the
 * lines always add up to the order total.
 */
export function computeOrderFees(items: FeeItem[], taxRate: number = 0, taxInclusive: boolean = false): OrderFees {
  const listed = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Tax on the taxable listed value only; fees on the whole ex-tax subtotal.
  const isTaxable = (item: FeeItem) => item.taxable !== false;
  const taxableListed = items.reduce((sum, item) => sum + (isTaxable(item) ? item.price * item.quantity : 0), 0);
  const taxableNet = taxInclusive ? roundCurrency(taxableListed / (1 + taxRate)) : roundCurrency(taxableListed);
  const tax = taxInclusive ? roundCurrency(taxableListed - taxableNet) : roundCurrency(taxableNet * taxRate);
  const subtotal = roundCurrency(listed - (taxInclusive ? tax : 0));
  // Each line at its own rate, rounded once on the sum. Written as
  // subtotal × maxRate × (Σ net·k / Σ net) with k = rate / maxRate, so a
  // uniform-rate order is exactly subtotal × rate.
  const rateOf = (item: FeeItem) => item.platformFeeRate ?? FEE_CONFIG.platformFeePercent;
  const maxRate = items.reduce((m, item) => Math.max(m, rateOf(item)), 0);
  const k = (item: FeeItem) => (maxRate > 0 ? rateOf(item) / maxRate : 0);
  const nets = items.map((item) => {
    const lineListed = item.price * item.quantity;
    if (!taxInclusive || !isTaxable(item) || taxableListed <= 0) return lineListed;
    return lineListed - roundCurrency(tax * (lineListed / taxableListed));
  });
  const netSum = nets.reduce((s, n) => s + n, 0);
  const ratedNet = items.reduce((s, item, i) => s + nets[i] * k(item), 0);
  const platformFee = netSum > 0 ? roundCurrency(subtotal * maxRate * (ratedNet / netSum)) : 0;
  // Platform fee is allocated by listed value × k (a 0% line gets none).
  const ratedListed = items.reduce((s, item) => s + item.price * item.quantity * k(item), 0);
  // No lines means no charge: an empty cart must not carry Stripe's fixed fee.
  // (A $0 tier still does — free tickets go through Checkout like any other.)
  const processingFee =
    items.length === 0
      ? 0
      : roundCurrency((subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed);
  const lines: LineBreakdown[] = items.map((item) => {
    const lineListed = item.price * item.quantity;
    const proportion = listed > 0 ? lineListed / listed : 0;
    const platformProportion = ratedListed > 0 ? (lineListed * k(item)) / ratedListed : 0;
    const taxProportion = isTaxable(item) && taxableListed > 0 ? lineListed / taxableListed : 0;
    return {
      unitPrice: item.price,
      quantity: item.quantity,
      taxable: isTaxable(item),
      platformFeeRate: rateOf(item),
      feeMode: item.feeMode === 'ABSORB' ? 'ABSORB' : 'PASS',
      base: 0,
      platformFee: roundCurrency(platformFee * platformProportion),
      processingFee: roundCurrency(processingFee * proportion),
      tax: roundCurrency(tax * taxProportion),
      absorbedFees: 0,
      total: 0,
    };
  });

  // Rounding drift, so the lines add up to the order exactly (a single $0 line
  // has no proportion at all and takes the whole fixed fee here).
  if (lines.length > 0) {
    const value = (line: LineBreakdown) => line.unitPrice * line.quantity;
    const largestWhere = (pred: (line: LineBreakdown) => boolean) =>
      lines.reduce((max, line, i) => (pred(line) && (max === -1 || value(line) > value(lines[max])) ? i : max), -1);
    const largest = largestWhere(() => true);
    // Platform drift lands on the largest line with a non-zero rate, tax drift
    // on the largest taxable line — never on a 0% or untaxed one.
    const largestRated = largestWhere((line) => line.platformFeeRate > 0);
    const largestTaxable = largestWhere((line) => line.taxable);
    const platformDrift = roundCurrency(platformFee - lines.reduce((s, l) => s + l.platformFee, 0));
    const processingDrift = roundCurrency(processingFee - lines.reduce((s, l) => s + l.processingFee, 0));
    const taxDrift = roundCurrency(tax - lines.reduce((s, l) => s + l.tax, 0));
    if (largestRated !== -1) lines[largestRated].platformFee = roundCurrency(lines[largestRated].platformFee + platformDrift);
    lines[largest].processingFee = roundCurrency(lines[largest].processingFee + processingDrift);
    if (largestTaxable !== -1) lines[largestTaxable].tax = roundCurrency(lines[largestTaxable].tax + taxDrift);
  }

  // Line totals from the final shares. Inside a listed price the tax is part of
  // the listed value, so `base` is what is left once it is backed out.
  // ABSORB: the buyer pays the listed price (plus tax on top); the line's fee
  // shares come out of the organization's share.
  for (const line of lines) {
    const lineListed = roundCurrency(line.unitPrice * line.quantity);
    line.base = taxInclusive ? roundCurrency(lineListed - line.tax) : lineListed;
    if (line.feeMode === 'ABSORB') {
      line.absorbedFees = roundCurrency(line.platformFee + line.processingFee);
      line.total = roundCurrency(line.base + line.tax);
    } else {
      line.total = roundCurrency(line.base + line.platformFee + line.processingFee + line.tax);
    }
  }
  const absorbedFees = roundCurrency(lines.reduce((s, l) => s + l.absorbedFees, 0));
  const total = roundCurrency(subtotal + platformFee + processingFee + tax - absorbedFees);
  const orgReceives = roundCurrency(subtotal - absorbedFees);

  return { subtotal, platformFee, processingFee, tax, total, absorbedFees, orgReceives, taxInclusive, lines };
}
