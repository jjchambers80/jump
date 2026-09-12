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
});

describe('formatPrice', () => {
  it('formats to two decimals with a dollar sign', () => {
    expect(formatPrice(5)).toBe('$5.00');
    expect(formatPrice(12.345)).toBe('$12.35');
  });
});
