// Unit tests for FeeService — all-in pricing fee computation
//
// The cases come from backend/tests/fixtures/fees.fixtures.json, which
// frontend/tests/unit/fees.test.ts asserts too (Gotcha 12): the two fee
// libraries cannot drift apart without one of the suites failing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from '@jest/globals';
import feeService from '../../src/services/FeeService.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '../fixtures/fees.fixtures.json'), 'utf8'));
const round = (v) => feeService._round(v);
const sum = (arr, pick) => round(arr.reduce((s, x) => s + pick(x), 0));

describe('FeeService.computeOrderFees (shared fixtures)', () => {
  it.each(fixtures.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const result = feeService.computeOrderFees(c.items, c.taxRate, { taxInclusive: c.taxInclusive });

    expect(result).toMatchObject({ ...c.order, taxInclusive: c.taxInclusive });
    expect(result.itemBreakdowns).toHaveLength(c.lines.length);
    result.itemBreakdowns.forEach((line, i) => {
      expect(line).toEqual({ unitPrice: c.items[i].unitPrice, quantity: c.items[i].quantity, ...c.lines[i] });
    });

    // Invariants: the lines add up to what the buyer pays, and what the buyer
    // pays beyond the organization's share is Jump's fee, Stripe's (estimated)
    // fee and the tax the organization remits.
    expect(sum(result.itemBreakdowns, (b) => b.lineTotal)).toBe(result.total);
    expect(round(result.total - result.orgReceives)).toBe(
      round(result.platformFee + result.processingFee + result.tax)
    );
    expect(sum(result.itemBreakdowns, (b) => b.platformFee)).toBe(result.platformFee);
    expect(sum(result.itemBreakdowns, (b) => b.processingFee)).toBe(result.processingFee);
    expect(sum(result.itemBreakdowns, (b) => b.tax)).toBe(result.tax);
    expect(sum(result.itemBreakdowns, (b) => b.absorbedFees)).toBe(result.absorbedFees);
  });

  it('tax-inclusive at a 0% rate is the exclusive model', () => {
    const inclusive = feeService.computeOrderFees([{ unitPrice: 20, quantity: 2 }], 0, { taxInclusive: true });
    const exclusive = feeService.computeOrderFees([{ unitPrice: 20, quantity: 2 }], 0);
    expect({ ...inclusive, taxInclusive: false }).toEqual({ ...exclusive, taxInclusive: false });
  });
});
