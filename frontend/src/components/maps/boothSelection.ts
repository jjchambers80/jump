// Booth picker rules (spec 014 phase 2): which booths an approved vendor may
// choose, what happens after the hold is taken, and the hold countdown. Pure
// functions so the rules are unit-tested apart from the map rendering.

import type { BoothStatus, ChooseBoothResult } from '@/services/api';

export interface PickerBooth {
  id: string;
  label: string;
  w: number;
  h: number;
  status: BoothStatus;
  tier: { id: string } | null;
}

/** A booth the vendor may buy: available and sold from their own tier. */
export function isSelectable(booth: PickerBooth, tierId: string | null | undefined): boolean {
  return booth.status === 'AVAILABLE' && !!tierId && booth.tier?.id === tierId;
}

/** Booths of other tiers (or none) are faded so the vendor's inventory stands out. */
export function isDimmed(booth: PickerBooth, tierId: string | null | undefined): boolean {
  return !tierId || booth.tier?.id !== tierId;
}

/**
 * Id sets for `MapCanvas`: `dimmed` fades other tiers, `disabled` covers
 * everything that cannot be chosen — other tiers and SOLD / HELD / RESERVED /
 * BLOCKED booths of the vendor's own tier — so they get `aria-disabled` and
 * ignore clicks.
 */
export function selectability(booths: PickerBooth[], tierId: string | null | undefined) {
  const selectable = new Set<string>();
  const dimmed = new Set<string>();
  const disabled = new Set<string>();
  for (const booth of booths) {
    if (isSelectable(booth, tierId)) selectable.add(booth.id);
    else disabled.add(booth.id);
    if (isDimmed(booth, tierId)) dimmed.add(booth.id);
  }
  return { selectable, dimmed, disabled };
}

/** "Booth A12 · 10×10 · $275.00 all-in" — `price` is already formatted. */
export function describeBooth(booth: Pick<PickerBooth, 'label' | 'w' | 'h'>, price: string): string {
  return `Booth ${booth.label} · ${booth.w}×${booth.h} · ${price} all-in`;
}

export type NextStep = 'paid' | 'charging' | 'checkout' | 'declined';

/**
 * What the picker does with the hold response. A saved card was charged
 * off-session: PAID means the booth is sold, PROCESSING means Stripe is still
 * settling (poll). No card: the booth is HELD and the pay-now Checkout takes
 * over. A declined card releases the hold (AVAILABLE) — the vendor may choose
 * again. Nothing here ever treats a hold as a sale.
 */
export function nextStepAfterChoose(result: Pick<ChooseBoothResult, 'status' | 'paymentStatus'>): NextStep {
  if (result.paymentStatus === 'PAID' || result.status === 'SOLD') return 'paid';
  if (result.paymentStatus === 'PROCESSING') return 'charging';
  if (result.status === 'HELD') return 'checkout';
  return 'declined';
}

/** Milliseconds left on a hold, never negative; 0 when there is no deadline. */
export function holdRemaining(holdExpiresAt: string | null | undefined, now: number = Date.now()): number {
  if (!holdExpiresAt) return 0;
  const end = new Date(holdExpiresAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now);
}

/** "14:59" for the hold countdown; hours fold into minutes. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ─── Spec 039: per-spot prices ───────────────────────────────────────────

/** What a spot costs the vendor, all in: its own price when the organizer set one, else `fallback` (the category's). */
export function spotPrice(booth: { price?: number | null }, fallback: number): number {
  return typeof booth.price === 'number' ? booth.price : fallback;
}

/** "$250.00" or "$250.00–$400.00"; `formatted` turns dollars into text. */
export function priceRangeLabel(from: number, to: number, formatted: (dollars: number) => string): string {
  return from === to ? formatted(from) : `${formatted(from)}–${formatted(to)}`;
}

export type SpotSort = 'label' | 'price';

/** Spots in label order (natural: A2 before A10) or cheapest first, label breaking ties. */
export function sortSpots<T extends { label: string; price?: number | null }>(spots: T[], by: SpotSort, fallback: number): T[] {
  const byLabel = (a: T, b: T) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  return [...spots].sort((a, b) => (by === 'price' ? spotPrice(a, fallback) - spotPrice(b, fallback) || byLabel(a, b) : byLabel(a, b)));
}
