// Spec 039 follow-up: the vendor's "Choose your space" total is computed like
// the order (one fee calculation over all lines), not by summing per-line
// all-in prices, which counts Stripe's fixed fee once per line.
import { describe, expect, it } from 'vitest';
import { estimateSpaceTotal, type SpacePricing } from '@/lib/applications';
import { computeOrderFees, roundCurrency } from '@/lib/fees';

const pass: SpacePricing = { feeMode: 'PASS', taxable: false, taxRate: 0, taxInclusive: false };

describe('estimateSpaceTotal', () => {
  it('matches one fee calculation over the space and its extras', () => {
    const extras = [{ price: 20, taxable: false, quantity: 1 }];
    const exact = computeOrderFees([{ price: 55, quantity: 1, taxable: false }, { price: 20, quantity: 1, taxable: false }], 0, false).total;
    expect(estimateSpaceTotal(55, extras, pass)).toBe(exact);
  });

  it('is below the sum of per-line all-in prices by the double-counted fixed fee', () => {
    const alone = (listed: number) => computeOrderFees([{ price: listed, quantity: 1, taxable: false }], 0, false).total;
    const summed = roundCurrency(alone(55) + alone(20));
    const exact = estimateSpaceTotal(55, [{ price: 20, taxable: false, quantity: 1 }], pass);
    expect(summed - exact).toBeGreaterThan(0.25);
    expect(summed - exact).toBeLessThan(0.35);
  });

  it('ignores extras with no quantity', () => {
    expect(estimateSpaceTotal(55, [{ price: 20, taxable: false, quantity: 0 }], pass)).toBe(estimateSpaceTotal(55, [], pass));
  });

  it('ABSORB: the listed prices plus tax on taxable lines', () => {
    const absorb: SpacePricing = { feeMode: 'ABSORB', taxable: true, taxRate: 0.075, taxInclusive: false };
    expect(estimateSpaceTotal(100, [{ price: 20, taxable: false, quantity: 2 }], absorb)).toBe(147.5);
  });
});
