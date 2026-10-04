// Spec 039: per-booth prices in the map builder. Pure helpers so the rules
// are unit-tested apart from the inspector.

import type { BoothStatus } from '@/services/api';

/** Highest price the backend accepts for a booth (MapService MAX_BOOTH_PRICE). */
export const MAX_BOOTH_PRICE = 100_000;

/**
 * A price field draft as the save payload needs it: `null` for an empty
 * field (use the tier's price), dollars rounded to cents, or `undefined` when
 * the text is not a price the backend would accept.
 */
export function parsePriceDraft(draft: string): number | null | undefined {
  const text = draft.trim().replace(/^\$/, '').replace(/,/g, '');
  if (text === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value > MAX_BOOTH_PRICE) return undefined;
  return Math.round(value * 100) / 100;
}

/** "250" / "249.5" → "250.00" / "249.50" for the field; "" for no price. */
export function priceDraft(price: number | null | undefined): string {
  return typeof price === 'number' ? price.toFixed(2) : '';
}

/**
 * A vendor holds, owns or was placed on the booth: its price is what they
 * pay, so the backend refuses to change it (409 BOOTH_PRICE_LOCKED).
 */
export function isPriceLocked(status: BoothStatus): boolean {
  return status === 'HELD' || status === 'SOLD' || status === 'RESERVED';
}
