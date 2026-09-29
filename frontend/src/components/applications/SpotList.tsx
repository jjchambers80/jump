'use client';

// Spots list (spec 039 D7): the same spots the floor map offers an approved
// vendor, as a sortable list — the keyboard, screen-reader and small-screen
// way to choose. Only spots of the vendor's category that are still
// available are listed; the server re-checks everything when holding.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { mapsApi, type PublicMap } from '@/services/api';
import { formatPrice } from '@/lib/fees';
import { selectability, sortSpots, spotPrice, type SpotSort } from '@/components/maps/boothSelection';

interface SpotListProps {
  eventId: string;
  tierId: string;
  /** All-in price of a spot without its own price (the category's). */
  fallbackPrice: number;
  /** All-in total of the chosen extras. */
  extrasTotal: number;
  /** The exact total for a spot with the chosen extras (one fee calculation); defaults to spot + extras. */
  totalFor?: (spot: PublicMap['booths'][number]) => number;
  /** True while a hold or payment is in flight. */
  busy: boolean;
  /** Label of the hold button for the chosen spot's total. */
  actionLabel: (total: number) => string;
  onHold: (boothId: string) => Promise<void>;
}

type Spot = PublicMap['booths'][number];

export default function SpotList({ eventId, tierId, fallbackPrice, extrasTotal, totalFor, busy, actionLabel, onHold }: SpotListProps) {
  const baseId = useId();
  const [map, setMap] = useState<PublicMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SpotSort>('label');
  const [chosen, setChosen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMap(await mapsApi.getPublicEventMap(eventId));
      setError(null);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      setError(e.status === 404 ? 'The floor plan is being updated. Check back soon.' : e.message || 'Could not load the spots');
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const spots = useMemo(() => {
    const booths = map?.booths ?? [];
    const { selectable } = selectability(booths, tierId);
    return sortSpots(
      booths.filter((b) => selectable.has(b.id)),
      sort,
      fallbackPrice
    );
  }, [map, tierId, sort, fallbackPrice]);

  // A spot taken meanwhile drops out of the list; forget it as the choice.
  useEffect(() => {
    if (chosen && !spots.some((s) => s.id === chosen)) setChosen(null);
  }, [spots, chosen]);

  const chosenSpot = spots.find((s) => s.id === chosen) ?? null;
  const total = chosenSpot ? (totalFor ? totalFor(chosenSpot) : Math.round((spotPrice(chosenSpot, fallbackPrice) + extrasTotal) * 100) / 100) : null;

  const hold = async () => {
    if (!chosenSpot || busy) return;
    await onHold(chosenSpot.id);
    await load();
  };

  if (error) return <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="spot-list-unavailable">{error}</p>;
  if (!map) return <p className="text-sm text-gray-600 dark:text-slate-400">Loading spots…</p>;
  if (spots.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="spot-list-empty">
        No spots are left in your category right now. The organizer can still place you — reply to your approval email.
      </p>
    );
  }

  const sortLabel = sort === 'label' ? 'spot' : 'price, lowest first';
  return (
    <div className="space-y-3" data-testid="spot-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-slate-400" aria-live="polite">
          {spots.length} spot{spots.length === 1 ? '' : 's'} available, sorted by {sortLabel}.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SpotSort)}
            data-testid="spot-sort"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="label">Spot</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="sr-only">Choose a spot</legend>
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
          {spots.map((spot: Spot) => {
            const price = spotPrice(spot, fallbackPrice);
            const id = `${baseId}-${spot.id}`;
            return (
              <li key={spot.id}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-3 bg-white px-4 py-3 text-sm has-[:checked]:bg-gray-50 dark:bg-slate-800 dark:has-[:checked]:bg-slate-900/60"
                  data-testid="spot-option"
                >
                  <input
                    id={id}
                    type="radio"
                    name={`${baseId}-spot`}
                    value={spot.id}
                    checked={chosen === spot.id}
                    onChange={() => setChosen(spot.id)}
                    disabled={busy}
                    className="h-4 w-4 accent-brand"
                  />
                  <span className="flex-1 font-semibold text-gray-900 dark:text-slate-100">Spot {spot.label}</span>
                  <span className="text-gray-600 dark:text-slate-400">
                    {spot.w}×{spot.h}
                  </span>
                  <span className="w-24 text-right font-semibold tabular-nums text-gray-900 dark:text-slate-100">{formatPrice(price)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="spot-total">
          {total === null ? (
            'Choose a spot to see your total.'
          ) : (
            <>
              Total <strong className="ml-1 text-lg font-extrabold tabular-nums text-gray-900 dark:text-slate-50">{formatPrice(total)}</strong>
              {extrasTotal > 0 && <span className="ml-1 text-xs">(extras included)</span>}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={hold}
          disabled={!chosenSpot || busy}
          data-testid="spot-hold"
          className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
        >
          {chosenSpot && total !== null ? actionLabel(total) : 'Choose a spot'}
        </button>
      </div>
    </div>
  );
}
