// Unit tests for FeeService — all-in pricing fee computation
import { describe, it, expect } from 'vitest';

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
});
