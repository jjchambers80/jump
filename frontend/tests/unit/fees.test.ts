import { describe, expect, it } from 'vitest';
import { FEE_CONFIG, computeOrderFees, computeTierAllInPrice, formatPrice } from '@/lib/fees';

const sumBy = <T>(arr: T[], pick: (t: T) => number) =>
  Math.round(arr.reduce((s, t) => s + pick(t), 0) * 100) / 100;

describe('computeOrderFees', () => {
  it('matches the backend FeeService order-level math', () => {
    const fees = computeOrderFees([{ price: 50, quantity: 2 }], 0.08);
    expect(fees.subtotal).toBe(100);
    expect(fees.platformFee).toBe(5); // 5%
    expect(fees.processingFee).toBe(3.35); // (100 + 5) × 2.9% + 0.30 = 3.345 → 3.35
    expect(fees.tax).toBe(8);
    expect(fees.total).toBe(116.35);
  });

  it('charges the fixed Stripe fee once per order, not per ticket', () => {
    const one = computeOrderFees([{ price: 10, quantity: 1 }]);
    const three = computeOrderFees([{ price: 10, quantity: 3 }]);
    const fixedShare = (fees: typeof one) =>
      fees.processingFee - (fees.subtotal + fees.platformFee) * FEE_CONFIG.stripeFeePercent;
    expect(fixedShare(one)).toBeCloseTo(FEE_CONFIG.stripeFeeFixed, 2);
    expect(fixedShare(three)).toBeCloseTo(FEE_CONFIG.stripeFeeFixed, 2);
  });

  it('returns one line per item whose components sum to the line total', () => {
    const fees = computeOrderFees(
      [
        { price: 25, quantity: 2 },
        { price: 99.99, quantity: 1 },
      ],
      0.0725
    );
    expect(fees.lines).toHaveLength(2);
    for (const line of fees.lines) {
      expect(line.base).toBe(Math.round(line.unitPrice * line.quantity * 100) / 100);
      expect(line.total).toBe(
        Math.round((line.base + line.platformFee + line.processingFee + line.tax) * 100) / 100
      );
    }
  });

  it('line totals and components always sum to the order totals', () => {
    const cases: Array<[Array<{ price: number; quantity: number }>, number]> = [
      [[{ price: 33.33, quantity: 1 }, { price: 33.33, quantity: 1 }, { price: 33.33, quantity: 1 }], 0],
      [[{ price: 12.5, quantity: 3 }, { price: 7.25, quantity: 5 }, { price: 100, quantity: 1 }], 0.0825],
      [[{ price: 0.01, quantity: 1 }, { price: 999.99, quantity: 4 }], 0.1],
      [[{ price: 19.99, quantity: 7 }], 0.06],
    ];
    for (const [items, taxRate] of cases) {
      const fees = computeOrderFees(items, taxRate);
      expect(sumBy(fees.lines, (l) => l.total)).toBe(fees.total);
      expect(sumBy(fees.lines, (l) => l.platformFee)).toBe(fees.platformFee);
      expect(sumBy(fees.lines, (l) => l.processingFee)).toBe(fees.processingFee);
      expect(sumBy(fees.lines, (l) => l.tax)).toBe(fees.tax);
      expect(sumBy(fees.lines, (l) => l.base)).toBe(fees.subtotal);
    }
  });

  it('pushes rounding drift onto the largest line', () => {
    const fees = computeOrderFees(
      [
        { price: 33.33, quantity: 1 },
        { price: 33.33, quantity: 1 },
        { price: 33.34, quantity: 1 },
      ],
      0
    );
    // Equal-ish thirds: the first two lines get the plain proportional share,
    // the largest (index 2) absorbs whatever is left.
    expect(fees.lines[0].platformFee).toBe(fees.lines[1].platformFee);
    expect(fees.lines[2].platformFee).toBe(
      Math.round((fees.platformFee - 2 * fees.lines[0].platformFee) * 100) / 100
    );
  });

  it('handles an empty cart without NaN', () => {
    const fees = computeOrderFees([], 0.08);
    expect(fees.subtotal).toBe(0);
    expect(fees.platformFee).toBe(0);
    expect(fees.processingFee).toBe(FEE_CONFIG.stripeFeeFixed);
    expect(fees.tax).toBe(0);
    expect(fees.lines).toEqual([]);
  });

  it('omits tax when the rate is zero', () => {
    const fees = computeOrderFees([{ price: 40, quantity: 1 }]);
    expect(fees.tax).toBe(0);
    expect(fees.lines[0].tax).toBe(0);
  });
});

describe('computeTierAllInPrice', () => {
  it('equals a one-ticket order', () => {
    const tier = computeTierAllInPrice(45, 0.05);
    const order = computeOrderFees([{ price: 45, quantity: 1 }], 0.05);
    expect(tier.total).toBe(order.total);
    expect(tier.platformFee).toBe(order.platformFee);
    expect(tier.processingFee).toBe(order.processingFee);
    expect(tier.tax).toBe(order.tax);
  });

  it('exposes a combined fees figure so Base + Fees + Tax equals the shown price', () => {
    // $65 VIP at 7.25% tax: platform 3.25, processing 2.28, tax 4.71, total 75.24
    const tier = computeTierAllInPrice(65, 0.0725);
    expect(tier.platformFee).toBe(3.25);
    expect(tier.processingFee).toBe(2.28);
    expect(tier.fees).toBe(5.53);
    expect(tier.tax).toBe(4.71);
    expect(tier.total).toBe(75.24);
    expect(sumBy([tier.basePrice, tier.fees, tier.tax], (v) => v)).toBe(tier.total);
  });
});

describe('tax-inclusive pricing (spec 009 phase 3)', () => {
  // Fixtures generated from backend/tests/unit/feeService.test.js — keep in sync.
  it('backs tax out of the listed price and charges fees on the net, like FeeService', () => {
    const fees = computeOrderFees([{ price: 50, quantity: 1 }], 0.0825, true);
    expect(fees.taxInclusive).toBe(true);
    expect(fees.subtotal).toBe(46.19);
    expect(fees.tax).toBe(3.81);
    expect(fees.platformFee).toBe(2.31);
    expect(fees.processingFee).toBe(1.71);
    expect(fees.total).toBe(54.02);
    expect(fees.lines[0]).toMatchObject({ unitPrice: 50, base: 46.19, tax: 3.81, total: 54.02 });
  });

  it('tier card: listed price is the base plus tax; total is listed plus fees', () => {
    const tier = computeTierAllInPrice(50, 0.0825, true);
    expect(tier.listedPrice).toBe(50);
    expect(tier.basePrice).toBe(46.19);
    expect(tier.tax).toBe(3.81);
    expect(tier.fees).toBe(4.02);
    expect(tier.total).toBe(54.02);
    expect(tier.total).toBe(sumBy([tier.listedPrice, tier.fees], (v) => v));
  });

  it('multi-line: components and line totals reconcile, each line charges listed + fee share', () => {
    const fees = computeOrderFees(
      [
        { price: 25, quantity: 2 },
        { price: 99.99, quantity: 1 },
      ],
      0.07,
      true
    );
    expect(sumBy(fees.lines, (l) => l.platformFee)).toBe(fees.platformFee);
    expect(sumBy(fees.lines, (l) => l.processingFee)).toBe(fees.processingFee);
    expect(sumBy(fees.lines, (l) => l.tax)).toBe(fees.tax);
    expect(sumBy(fees.lines, (l) => l.base)).toBe(fees.subtotal);
    expect(sumBy(fees.lines, (l) => l.total)).toBe(fees.total);
    for (const line of fees.lines) {
      expect(line.total).toBe(sumBy([line.unitPrice * line.quantity, line.platformFee, line.processingFee], (v) => v));
    }
  });

  it('is identical to the exclusive model at a 0% rate', () => {
    const inclusive = computeOrderFees([{ price: 20, quantity: 2 }], 0, true);
    const exclusive = computeOrderFees([{ price: 20, quantity: 2 }], 0, false);
    expect({ ...inclusive, taxInclusive: false }).toEqual({ ...exclusive, taxInclusive: false });
  });
});

describe('formatPrice', () => {
  it('formats to two decimals with a dollar sign', () => {
    expect(formatPrice(5)).toBe('$5.00');
    expect(formatPrice(12.345)).toBe('$12.35');
  });
});

// Mixed taxable lines (spec 012 add-ons). Same fixture as backend/tests/unit/feeService.test.js.
describe('computeOrderFees with untaxed add-on lines', () => {
  it('taxes only taxable lines, fees on the whole subtotal', () => {
    const fees = computeOrderFees(
      [
        { price: 100, quantity: 1 },
        { price: 20, quantity: 2, taxable: false },
      ],
      0.1
    );
    expect(fees.subtotal).toBe(140);
    expect(fees.tax).toBe(10);
    expect(fees.platformFee).toBe(7);
    expect(fees.processingFee).toBe(4.56);
    expect(fees.total).toBe(161.56);
    expect(fees.lines[0].tax).toBe(10);
    expect(fees.lines[1].tax).toBe(0);
    expect(fees.lines[1].taxable).toBe(false);
    expect(sumBy(fees.lines, (l) => l.total)).toBe(fees.total);
  });

  it('backs tax out of taxable lines only when tax-inclusive', () => {
    const fees = computeOrderFees(
      [
        { price: 110, quantity: 1 },
        { price: 25, quantity: 1, taxable: false },
      ],
      0.1,
      true
    );
    expect(fees.subtotal).toBe(125);
    expect(fees.tax).toBe(10);
    expect(fees.lines[1].tax).toBe(0);
    expect(fees.lines[1].base).toBe(25);
    expect(sumBy(fees.lines, (l) => l.total)).toBe(fees.total);
  });
});
