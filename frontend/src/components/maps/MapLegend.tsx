'use client';

import React from 'react';
import { useTheme } from 'next-themes';
import {
  TIER_SWATCHES,
  STATUS_LABELS,
  LEGEND_STATE_LIGHT,
  LEGEND_STATE_DARK,
  LEGEND_STATE_STROKE_LIGHT,
  LEGEND_STATE_STROKE_DARK,
} from './mapTheme';

export interface LegendTier {
  id: string;
  name: string;
  price: number;
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

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

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
                  className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-500'
                      : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: dark ? swatch.dark : swatch.light }}
                  />
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-slate-300">
                    {tier.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    {formatPrice(tier.price)}
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
            {(['AVAILABLE', 'SOLD', 'RESERVED', 'BLOCKED'] as const).map((state) => (
              <div key={state} className="flex items-center gap-2 px-2 py-0.5">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{
                    backgroundColor: dark ? LEGEND_STATE_DARK[state] : LEGEND_STATE_LIGHT[state],
                    border: `1px solid ${
                      dark ? LEGEND_STATE_STROKE_DARK[state] : LEGEND_STATE_STROKE_LIGHT[state]
                    }`,
                  }}
                />
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