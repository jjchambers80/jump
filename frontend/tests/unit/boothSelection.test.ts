// Booth picker rules (spec 014 phase 2): selectability, next step after a hold, countdown.
import { describe, expect, it } from 'vitest';
import {
  describeBooth,
  formatCountdown,
  holdRemaining,
  isDimmed,
  isSelectable,
  nextStepAfterChoose,
  priceRangeLabel,
  selectability,
  sortSpots,
  spotPrice,
  type PickerBooth,
} from '@/components/maps/boothSelection';

const tier = { id: 't-1' };
const other = { id: 't-2' };
const booth = (over: Partial<PickerBooth>): PickerBooth => ({ id: 'b', label: 'A1', w: 10, h: 10, status: 'AVAILABLE', tier, ...over });

describe('isSelectable / isDimmed', () => {
  it('allows only AVAILABLE booths of the vendor tier', () => {
    expect(isSelectable(booth({}), 't-1')).toBe(true);
    for (const status of ['SOLD', 'HELD', 'RESERVED', 'BLOCKED'] as const) {
      expect(isSelectable(booth({ status }), 't-1')).toBe(false);
    }
    expect(isSelectable(booth({ tier: other }), 't-1')).toBe(false);
    expect(isSelectable(booth({ tier: null }), 't-1')).toBe(false);
    expect(isSelectable(booth({}), null)).toBe(false);
  });

  it('dims other tiers and untiered booths, never the vendor tier', () => {
    expect(isDimmed(booth({}), 't-1')).toBe(false);
    expect(isDimmed(booth({ status: 'SOLD' }), 't-1')).toBe(false);
    expect(isDimmed(booth({ tier: other }), 't-1')).toBe(true);
    expect(isDimmed(booth({ tier: null }), 't-1')).toBe(true);
    expect(isDimmed(booth({}), undefined)).toBe(true);
  });
});

describe('selectability', () => {
  it('splits a map into selectable, dimmed and disabled id sets', () => {
    const booths = [
      booth({ id: 'a' }),
      booth({ id: 'sold', status: 'SOLD' }),
      booth({ id: 'held', status: 'HELD' }),
      booth({ id: 'blocked', status: 'BLOCKED', tier: null }),
      booth({ id: 'other', tier: other }),
    ];
    const sets = selectability(booths, 't-1');
    expect([...sets.selectable]).toEqual(['a']);
    expect([...sets.disabled].sort()).toEqual(['blocked', 'held', 'other', 'sold']);
    expect([...sets.dimmed].sort()).toEqual(['blocked', 'other']);
  });
});

describe('describeBooth', () => {
  it('reads "Booth A12 · 10×10 · $275.00 all-in"', () => {
    expect(describeBooth({ label: 'A12', w: 10, h: 10 }, '$275.00')).toBe('Booth A12 · 10×10 · $275.00 all-in');
  });
});

describe('nextStepAfterChoose', () => {
  it('is paid only when the server says PAID (or the booth is SOLD)', () => {
    expect(nextStepAfterChoose({ status: 'SOLD', paymentStatus: 'PAID' })).toBe('paid');
    expect(nextStepAfterChoose({ status: 'SOLD' })).toBe('paid');
  });
  it('polls while a saved card settles, opens Checkout without a card, and reports a declined card', () => {
    expect(nextStepAfterChoose({ status: 'HELD', paymentStatus: 'PROCESSING' })).toBe('charging');
    expect(nextStepAfterChoose({ status: 'HELD', paymentStatus: 'PAYMENT_DUE' })).toBe('checkout');
    expect(nextStepAfterChoose({ status: 'AVAILABLE', paymentStatus: 'PAYMENT_DUE' })).toBe('declined');
  });
  it('never treats a bare hold as a sale', () => {
    expect(nextStepAfterChoose({ status: 'HELD' })).not.toBe('paid');
  });
});

describe('holdRemaining / formatCountdown', () => {
  it('counts down from holdExpiresAt and never goes negative', () => {
    const now = Date.parse('2026-09-21T12:00:00.000Z');
    expect(holdRemaining('2026-09-21T12:14:59.000Z', now)).toBe(14 * 60_000 + 59_000);
    expect(holdRemaining('2026-09-21T11:59:00.000Z', now)).toBe(0);
    expect(holdRemaining(null, now)).toBe(0);
    expect(holdRemaining('not a date', now)).toBe(0);
  });
  it('formats m:ss, rounding partial seconds up', () => {
    expect(formatCountdown(14 * 60_000 + 59_000)).toBe('14:59');
    expect(formatCountdown(14 * 60_000 + 58_400)).toBe('14:59');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-1)).toBe('0:00');
  });
});

describe('spec 039 per-spot prices', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  it("uses the spot's own price, else the category's", () => {
    expect(spotPrice({ price: 325 }, 200)).toBe(325);
    expect(spotPrice({ price: 0 }, 200)).toBe(0);
    expect(spotPrice({ price: null }, 200)).toBe(200);
    expect(spotPrice({}, 200)).toBe(200);
  });

  it('labels one price or a range', () => {
    expect(priceRangeLabel(200, 200, fmt)).toBe('$200.00');
    expect(priceRangeLabel(200, 350, fmt)).toBe('$200.00–$350.00');
  });

  it('sorts spots by label (natural) or cheapest first', () => {
    const spots = [
      { label: 'A10', price: 200 },
      { label: 'A2', price: 350 },
      { label: 'A1', price: null },
    ];
    expect(sortSpots(spots, 'label', 250).map((s) => s.label)).toEqual(['A1', 'A2', 'A10']);
    expect(sortSpots(spots, 'price', 250).map((s) => s.label)).toEqual(['A10', 'A1', 'A2']);
    expect(spots.map((s) => s.label)).toEqual(['A10', 'A2', 'A1']);
  });
});
