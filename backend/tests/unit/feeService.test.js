// Unit tests for FeeService — all-in pricing fee computation
import { describe, it, expect } from '@jest/globals';

// Direct import of FeeService
import feeService from '../../src/services/FeeService.js';

describe('FeeService.computeOrderFees', () => {
  it('computes fees for a single item order', () => {
    const result = feeService.computeOrderFees([{ unitPrice: 50, quantity: 2 }]);

    // subtotal = 50 * 2 = 100
    expect(result.subtotal).toBe(100);

    // platformFee = 100 * 0.05 = 5.00
    expect(result.platformFee).toBe(5);

    // processingFee = (100 + 5) * 0.029 + 0.30 = 3.045 + 0.30 = 3.345 → 3.35
    expect(result.processingFee).toBe(3.35);

    // tax = 0
    expect(result.tax).toBe(0);

    // total = 100 + 5 + 3.35 = 108.35
    expect(result.total).toBe(108.35);

    // Single item breakdown matches order totals
    expect(result.itemBreakdowns).toHaveLength(1);
    expect(result.itemBreakdowns[0].platformFee).toBe(5);
    expect(result.itemBreakdowns[0].processingFee).toBe(3.35);
  });

  it('computes fees for multi-item order with proportional allocation', () => {
    const result = feeService.computeOrderFees([
      { unitPrice: 50, quantity: 2 }, // $100
      { unitPrice: 25, quantity: 4 }, // $100
    ]);

    expect(result.subtotal).toBe(200);
    expect(result.platformFee).toBe(10); // 200 * 0.05

    // processingFee = (200 + 10) * 0.029 + 0.30 = 6.09 + 0.30 = 6.39
    expect(result.processingFee).toBe(6.39);

    expect(result.total).toBe(216.39);

    // Both items have equal value ($100 each), so fees split 50/50
    expect(result.itemBreakdowns).toHaveLength(2);
    const totalItemPlatform = result.itemBreakdowns.reduce((s, b) => s + b.platformFee, 0);
    const totalItemProcessing = result.itemBreakdowns.reduce((s, b) => s + b.processingFee, 0);

    // Rounding drift correction: total per-item fees should match order-level fees
    expect(Math.abs(totalItemPlatform - result.platformFee)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(totalItemProcessing - result.processingFee)).toBeLessThanOrEqual(0.01);
  });

  it('handles free tickets ($0 price)', () => {
    const result = feeService.computeOrderFees([{ unitPrice: 0, quantity: 5 }]);

    expect(result.subtotal).toBe(0);
    expect(result.platformFee).toBe(0);
    // processingFee = 0 * 0.029 + 0.30 = 0.30
    expect(result.processingFee).toBe(0.3);
    expect(result.total).toBe(0.3);
  });

  it('handles single ticket', () => {
    const result = feeService.computeOrderFees([{ unitPrice: 65, quantity: 1 }]);

    expect(result.subtotal).toBe(65);
    expect(result.platformFee).toBe(3.25); // 65 * 0.05
    // processingFee = (65 + 3.25) * 0.029 + 0.30 = 1.9793 + 0.30 = 2.2793 → 2.28
    expect(result.processingFee).toBe(2.28);
    expect(result.total).toBe(70.53);
  });

  it('produces correct rounding for edge amounts', () => {
    const result = feeService.computeOrderFees([{ unitPrice: 19.99, quantity: 3 }]);

    // subtotal = 59.97
    expect(result.subtotal).toBe(59.97);
    // platformFee = 59.97 * 0.05 = 2.9985 → 3.00
    expect(result.platformFee).toBe(3);
    // All values should be rounded to 2 decimal places
    expect(result.total).toEqual(expect.any(Number));
    expect(Number(result.total.toFixed(2))).toBe(result.total);
  });

  describe('tax-inclusive pricing (spec 009 phase 3)', () => {
    it('backs tax out of the listed price and charges fees on the net amount', () => {
      // $50 listed at 8.25% inclusive: net 46.19, tax 3.81
      const result = feeService.computeOrderFees([{ unitPrice: 50, quantity: 1 }], 0.0825, { taxInclusive: true });
      expect(result.taxInclusive).toBe(true);
      expect(result.subtotal).toBe(46.19);
      expect(result.tax).toBe(3.81);
      // platformFee = 46.19 × 5% = 2.3095 → 2.31; processing = (46.19 + 2.31) × 2.9% + 0.30 = 1.7065 → 1.71
      expect(result.platformFee).toBe(2.31);
      expect(result.processingFee).toBe(1.71);
      // total = listed + fees, and subtotal + fees + tax
      expect(result.total).toBe(54.02);
      expect(result.total).toBe(feeService._round(result.subtotal + result.platformFee + result.processingFee + result.tax));
      expect(result.total).toBe(feeService._round(50 + result.platformFee + result.processingFee));
      expect(result.itemBreakdowns[0]).toMatchObject({ unitPrice: 50, quantity: 1, tax: 3.81, lineTotal: 54.02 });
    });

    it('is the exclusive model with the same total when the rate is 0', () => {
      const inclusive = feeService.computeOrderFees([{ unitPrice: 20, quantity: 2 }], 0, { taxInclusive: true });
      const exclusive = feeService.computeOrderFees([{ unitPrice: 20, quantity: 2 }], 0);
      expect({ ...inclusive, taxInclusive: false }).toEqual({ ...exclusive, taxInclusive: false });
    });

    it('allocates tax and fees per line so the lines sum to the total', () => {
      const result = feeService.computeOrderFees(
        [
          { unitPrice: 25, quantity: 2 },
          { unitPrice: 99.99, quantity: 1 },
        ],
        0.07,
        { taxInclusive: true }
      );
      const sum = (pick) => feeService._round(result.itemBreakdowns.reduce((s, b) => s + pick(b), 0));
      expect(sum((b) => b.platformFee)).toBe(result.platformFee);
      expect(sum((b) => b.processingFee)).toBe(result.processingFee);
      expect(sum((b) => b.tax)).toBe(result.tax);
      expect(sum((b) => b.lineTotal)).toBe(result.total);
      // Each line's charge is its listed value plus its fee share (tax is inside the listed price)
      for (const line of result.itemBreakdowns) {
        expect(line.lineTotal).toBe(feeService._round(line.unitPrice * line.quantity + line.platformFee + line.processingFee));
      }
    });

    it('defaults to tax added on top', () => {
      const result = feeService.computeOrderFees([{ unitPrice: 50, quantity: 1 }], 0.0825);
      expect(result.taxInclusive).toBe(false);
      expect(result.subtotal).toBe(50);
      expect(result.tax).toBe(4.13);
    });
  });

  // Mixed taxable lines (spec 012 add-ons). Fixture shared with frontend/tests/unit/fees.test.ts.
  describe('untaxed add-on lines', () => {
    it('taxes only taxable lines, fees on the whole subtotal', () => {
      const result = feeService.computeOrderFees(
        [
          { unitPrice: 100, quantity: 1 }, // tier, taxable
          { unitPrice: 20, quantity: 2, taxable: false }, // add-on, untaxed
        ],
        0.1
      );
      expect(result.subtotal).toBe(140);
      expect(result.tax).toBe(10); // 10% of 100 only
      expect(result.platformFee).toBe(7); // 5% of 140
      expect(result.processingFee).toBe(4.56); // (140 + 7) × 2.9% + 0.30 = 4.563
      expect(result.total).toBe(161.56);
      expect(result.itemBreakdowns[0].tax).toBe(10);
      expect(result.itemBreakdowns[1].tax).toBe(0);
      expect(result.itemBreakdowns[1].taxable).toBe(false);
      const lineSum = result.itemBreakdowns.reduce((s, b) => s + b.lineTotal, 0);
      expect(Math.round(lineSum * 100) / 100).toBe(result.total);
    });

    it('backs tax out of taxable lines only when tax-inclusive', () => {
      const result = feeService.computeOrderFees(
        [
          { unitPrice: 110, quantity: 1 }, // listed incl. 10% tax → net 100
          { unitPrice: 25, quantity: 1, taxable: false },
        ],
        0.1,
        { taxInclusive: true }
      );
      expect(result.subtotal).toBe(125);
      expect(result.tax).toBe(10);
      expect(result.itemBreakdowns[1].tax).toBe(0);
      expect(result.itemBreakdowns[1].lineTotal).toBeGreaterThan(25); // add-on + its fee share
      expect(result.total).toBe(Math.round((125 + result.platformFee + result.processingFee + 10) * 100) / 100);
    });

    it('lands tax drift on the largest taxable line, never an untaxed one', () => {
      const result = feeService.computeOrderFees(
        [
          { unitPrice: 33.33, quantity: 1 },
          { unitPrice: 33.33, quantity: 1 },
          { unitPrice: 50, quantity: 1, taxable: false },
        ],
        0.0725
      );
      expect(result.itemBreakdowns[2].tax).toBe(0);
      const allocatedTax = result.itemBreakdowns.reduce((s, b) => s + b.tax, 0);
      expect(Math.round(allocatedTax * 100) / 100).toBe(result.tax);
    });
  });
});
