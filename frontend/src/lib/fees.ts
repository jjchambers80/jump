// Pure fee math for customer-facing all-in pricing (FTC junk fee compliance).
// Mirrors backend/src/services/FeeService.js exactly — including the proportional
// per-line allocation and the rounding-drift correction — so what the cart shows
// is what the order will charge. No React here.

/** Must match backend/src/config/fees.js. */
export const FEE_CONFIG = {
  platformFeePercent: 0.05, // 5% service fee on base price
  stripeFeePercent: 0.029, // Stripe's 2.9%
  stripeFeeFixed: 0.3, // Stripe's $0.30 per transaction (once per order, not per ticket)
} as const;

export interface FeeItem {
  price: number;
  quantity: number;
}

/** Cost components that make up one cart line's price. */
export interface LineBreakdown {
  unitPrice: number;
  quantity: number;
  /** unitPrice × quantity */
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
 */
export function computeTierAllInPrice(basePrice: number, taxRate: number = 0) {
  const platformFee = roundCurrency(basePrice * FEE_CONFIG.platformFeePercent);
  const processingFee = roundCurrency(
    (basePrice + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
  );
  const tax = roundCurrency(basePrice * taxRate);
  const total = roundCurrency(basePrice + platformFee + processingFee + tax);
  return { basePrice, platformFee, processingFee, tax, total };
}

/**
 * Fee breakdown for a whole order plus a per-line allocation.
 * Platform and processing fees are computed on the order subtotal, then split across
 * lines proportionally by line value; any cent of rounding drift lands on the largest
 * line so the lines always add up to the order total.
 */
export function computeOrderFees(items: FeeItem[], taxRate: number = 0): OrderFees {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const platformFee = roundCurrency(subtotal * FEE_CONFIG.platformFeePercent);
  const processingFee = roundCurrency(
    (subtotal + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
  );
  const tax = roundCurrency(subtotal * taxRate);
  const total = roundCurrency(subtotal + platformFee + processingFee + tax);

  const lines: LineBreakdown[] = items.map((item) => {
    const base = roundCurrency(item.price * item.quantity);
    const proportion = subtotal > 0 ? base / subtotal : 0;
    const linePlatform = roundCurrency(platformFee * proportion);
    const lineProcessing = roundCurrency(processingFee * proportion);
    const lineTax = roundCurrency(tax * proportion);
    return {
      unitPrice: item.price,
      quantity: item.quantity,
      base,
      platformFee: linePlatform,
      processingFee: lineProcessing,
      tax: lineTax,
      total: roundCurrency(base + linePlatform + lineProcessing + lineTax),
    };
  });

  if (lines.length > 1) {
    const largest = lines.reduce((max, line, i) => (line.base > lines[max].base ? i : max), 0);
    const platformDrift = roundCurrency(platformFee - lines.reduce((s, l) => s + l.platformFee, 0));
    const processingDrift = roundCurrency(
      processingFee - lines.reduce((s, l) => s + l.processingFee, 0)
    );
    const taxDrift = roundCurrency(tax - lines.reduce((s, l) => s + l.tax, 0));
    const target = lines[largest];
    target.platformFee = roundCurrency(target.platformFee + platformDrift);
    target.processingFee = roundCurrency(target.processingFee + processingDrift);
    target.tax = roundCurrency(target.tax + taxDrift);
    target.total = roundCurrency(target.base + target.platformFee + target.processingFee + target.tax);
  }

  return { subtotal: roundCurrency(subtotal), platformFee, processingFee, tax, total, lines };
}
