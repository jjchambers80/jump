import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEE_CONFIG, computeOrderFees, computeTierAllInPrice, formatPrice, type FeeMode } from '@/lib/fees';

// The order cases live in backend/tests/fixtures/fees.fixtures.json, which
// backend/tests/unit/feeService.test.js asserts too (Gotcha 12): the two fee
// libraries cannot drift apart without one of the suites failing.
type FixtureItem = { unitPrice: number; quantity: number; taxable?: boolean; platformFeeRate?: number; feeMode?: FeeMode };
type FixtureLine = {
  platformFeeRate: number;
  feeMode: FeeMode;
  taxable: boolean;
  base: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  absorbedFees: number;
  lineTotal: number;
};
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '../../../backend/tests/fixtures/fees.fixtures.json'), 'utf8')
) as {
  cases: {
    name: string;
    items: FixtureItem[];
    taxRate: number;
    taxInclusive: boolean;
    order: { subtotal: number; platformFee: number; processingFee: number; tax: number; absorbedFees: number; orgReceives: number; total: number };
    lines: FixtureLine[];
  }[];
};

const sumBy = <T>(arr: T[], pick: (t: T) => number) =>
  Math.round(arr.reduce((s, t) => s + pick(t), 0) * 100) / 100;

describe('computeOrderFees (shared fixtures)', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const items = c.items.map(({ unitPrice, ...rest }) => ({ price: unitPrice, ...rest }));
      const fees = computeOrderFees(items, c.taxRate, c.taxInclusive);

      expect(fees).toMatchObject({ ...c.order, taxInclusive: c.taxInclusive });
      expect(fees.lines).toHaveLength(c.lines.length);
      fees.lines.forEach((line, i) => {
        const { lineTotal, ...expected } = c.lines[i];
        expect(line).toEqual({ unitPrice: c.items[i].unitPrice, quantity: c.items[i].quantity, ...expected, total: lineTotal });
      });

      // Invariants: the lines add up to what the buyer pays, and what the buyer
      // pays beyond the organization's share is Jump's fee, Stripe's (estimated)
      // fee and the tax the organization remits.
      expect(sumBy(fees.lines, (l) => l.total)).toBe(fees.total);
      expect(sumBy([fees.total, -fees.orgReceives], (v) => v)).toBe(
        sumBy([fees.platformFee, fees.processingFee, fees.tax], (v) => v)
      );
      expect(sumBy(fees.lines, (l) => l.platformFee)).toBe(fees.platformFee);
      expect(sumBy(fees.lines, (l) => l.processingFee)).toBe(fees.processingFee);
      expect(sumBy(fees.lines, (l) => l.tax)).toBe(fees.tax);
      expect(sumBy(fees.lines, (l) => l.base)).toBe(fees.subtotal);
      expect(sumBy(fees.lines, (l) => l.absorbedFees)).toBe(fees.absorbedFees);
    });
  }

  it('charges the fixed Stripe fee once per order, not per ticket', () => {
    const one = computeOrderFees([{ price: 10, quantity: 1 }]);
    const three = computeOrderFees([{ price: 10, quantity: 3 }]);
    const fixedShare = (fees: typeof one) =>
      fees.processingFee - (fees.subtotal + fees.platformFee) * FEE_CONFIG.stripeFeePercent;
    expect(fixedShare(one)).toBeCloseTo(FEE_CONFIG.stripeFeeFixed, 2);
    expect(fixedShare(three)).toBeCloseTo(FEE_CONFIG.stripeFeeFixed, 2);
  });

  it('tax-inclusive at a 0% rate is the exclusive model', () => {
    const inclusive = computeOrderFees([{ price: 20, quantity: 2 }], 0, true);
    const exclusive = computeOrderFees([{ price: 20, quantity: 2 }], 0, false);
    expect({ ...inclusive, taxInclusive: false }).toEqual({ ...exclusive, taxInclusive: false });
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
  it('tier card: listed price is the base plus tax; total is listed plus fees', () => {
    const tier = computeTierAllInPrice(50, 0.0825, true);
    expect(tier.listedPrice).toBe(50);
    expect(tier.basePrice).toBe(46.19);
    expect(tier.tax).toBe(3.81);
    expect(tier.fees).toBe(4.02);
    expect(tier.total).toBe(54.02);
    expect(tier.total).toBe(sumBy([tier.listedPrice, tier.fees], (v) => v));
  });
});

describe('formatPrice', () => {
  it('formats to two decimals with a dollar sign', () => {
    expect(formatPrice(5)).toBe('$5.00');
    expect(formatPrice(12.345)).toBe('$12.35');
  });
});
