'use client';

import { formatPrice } from '../../lib/fees';
import React from 'react';
import { useTheme } from 'next-themes';
import {
  TIER_SWATCHES,
  STATUS_LABELS,
  LEGEND_STATE_LIGHT,
  LEGEND_STATE_DARK,
  LEGEND_STATE_STROKE_LIGHT,
  LEGEND_STATE_STROKE_DARK,
  BOOTH_LABEL_LIGHT,
  BOOTH_LABEL_DARK,
} from './mapTheme';

export interface LegendTier {
  id: string;
  name: string;
  price: number;
  /** Spec 039: all-in range across the tier's spots (spots can carry their own price). */
  priceFrom?: number;
  priceTo?: number;
  swatch: number;
}

interface MapLegendProps {
  tiers: LegendTier[];
  showStates?: boolean;
  selectedTierId?: string | null;
  onTierSelect?: (tierId: string | null) => void;
}

export default function MapLegend({
  tiers,
  showStates = true,
  selectedTierId,
  onTierSelect,
}: MapLegendProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';


  return (
    <div className="space-y-4">
      {tiers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
            Tiers
          </h4>
          <div className="space-y-1.5">
            {tiers.map((tier) => {
              const swatch = TIER_SWATCHES[tier.swatch % TIER_SWATCHES.length];
              const isSelected = selectedTierId === tier.id;
              return (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => onTierSelect?.(isSelected ? null : tier.id)}
                  className={`flex items-start gap-2 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-500'
                      : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <span
                    className="mt-1 w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: dark ? swatch.dark : swatch.light }}
                  />
                  {/* Name and price stack so a price range never squeezes the name
                      (the legend column is narrow beside the map). */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-gray-700 dark:text-slate-300" title={tier.name}>
                      {tier.name}
                    </span>
                    <span className="text-xs tabular-nums text-gray-500 dark:text-slate-400" data-testid={`legend-price-${tier.id}`}>
                      {tier.priceFrom !== undefined && tier.priceTo !== undefined && tier.priceFrom !== tier.priceTo
                        ? `${formatPrice(tier.priceFrom)}–${formatPrice(tier.priceTo)}`
                        : formatPrice(tier.priceFrom ?? tier.price)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showStates && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
            States
          </h4>
          <div className="space-y-1">
            {/* Lifecycle order. HELD is a real state a visitor meets on the map
                — someone is checking out right now — so it needs a row, or an
                amber booth with a clock on it means nothing to them. */}
            {(['AVAILABLE', 'HELD', 'SOLD', 'RESERVED', 'BLOCKED'] as const).map((state) => (
              <div key={state} className="flex items-center gap-2 px-2 py-0.5">
                <span
                  className="relative w-3 h-3 rounded-sm shrink-0"
                  style={{
                    backgroundColor: dark ? LEGEND_STATE_DARK[state] : LEGEND_STATE_LIGHT[state],
                    border: `1px solid ${
                      dark ? LEGEND_STATE_STROKE_DARK[state] : LEGEND_STATE_STROKE_LIGHT[state]
                    }`,
                  }}
                >
                  {state === 'HELD' && (
                    // The same clock the booth carries, so the two read as one thing.
                    <svg
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full"
                      fill="none"
                      stroke={dark ? BOOTH_LABEL_DARK : BOOTH_LABEL_LIGHT}
                      strokeWidth={1}
                    >
                      <circle cx={6} cy={6} r={3.2} />
                      <path d="M 6 4.2 v 2 h 1.4" />
                    </svg>
                  )}
                </span>
                <span className="text-xs text-gray-600 dark:text-slate-400">
                  {STATUS_LABELS[state] || state}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}