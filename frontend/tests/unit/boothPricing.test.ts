// Spec 039: per-booth price input rules in the map builder.
import { describe, expect, it } from 'vitest';
import { isPriceLocked, parsePriceDraft, priceDraft } from '@/components/maps/builder/pricing';

describe('parsePriceDraft', () => {
  it('reads an empty field as "use the tier price"', () => {
    expect(parsePriceDraft('')).toBeNull();
    expect(parsePriceDraft('   ')).toBeNull();
  });

  it('accepts dollars with up to two decimals, a $ sign and thousands commas', () => {
    expect(parsePriceDraft('250')).toBe(250);
    expect(parsePriceDraft('249.5')).toBe(249.5);
    expect(parsePriceDraft('$1,250.99')).toBe(1250.99);
    expect(parsePriceDraft('0')).toBe(0);
  });

  it('refuses what the backend refuses', () => {
    for (const bad of ['-5', '1.234', 'abc', '100000.01', '1e3']) expect(parsePriceDraft(bad)).toBeUndefined();
  });
});

describe('priceDraft / isPriceLocked', () => {
  it('formats a price for the field', () => {
    expect(priceDraft(250)).toBe('250.00');
    expect(priceDraft(null)).toBe('');
    expect(priceDraft(undefined)).toBe('');
  });

  it('locks the price of held, sold and reserved booths only', () => {
    expect(['AVAILABLE', 'BLOCKED', 'HELD', 'SOLD', 'RESERVED'].map((s) => isPriceLocked(s as never))).toEqual([false, false, true, true, true]);
  });
});
