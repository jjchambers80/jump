'use client';

// One price tier on the public event page, drawn as a ticket in the same torn
// language as the RSVP pass and the storefront event stubs: the details on the
// left (top on phones), the price and the stepper on a stub torn off by a
// notched perforation.
// The notches are cut with a CSS mask (`.tier-stub` in globals.css).

import React, { useState } from 'react';
import { Info, Minus, Plus } from 'lucide-react';
import { computeTierAllInPrice, formatPrice } from '@/lib/fees';

export interface TierStubTier {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  quantityAvailable: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isRefundable: boolean;
}

interface TierStubProps {
  tier: TierStubTier;
  quantity: number;
  taxRate: number;
  taxInclusive: boolean;
  onChange: (direction: 1 | -1) => void;
  onShowDetails: () => void;
}

export default function TierStub({ tier, quantity, taxRate, taxInclusive, onChange, onShowDetails }: TierStubProps) {
  const [showPolicy, setShowPolicy] = useState(false);
  const soldOut = tier.quantityAvailable === 0;
  const selected = quantity > 0;
  const minQuantity = tier.minPerOrder ?? 1;
  const maxQuantity = Math.min(tier.quantityAvailable, tier.maxPerOrder ?? 10, 10);
  // Only surface the remaining count once it's low enough to mean something.
  const low = !soldOut && tier.quantityAvailable < 10;
  const fees = computeTierAllInPrice(tier.price, taxRate, taxInclusive);

  return (
    <div className="tier-stub-shadow" data-testid={`tier-${tier.id}`} data-selected={selected}>
      <div
        className={`tier-stub relative grid grid-cols-1 overflow-hidden rounded-2xl border bg-white transition-colors duration-200 dark:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_10rem] ${
          selected
            ? 'border-brand-link'
            : soldOut
              ? 'border-gray-200 dark:border-slate-700'
              : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
        }`}
      >
        {/* Brand edge marks the tiers in the cart */}
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1 bg-brand transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`}
        />

        <div className={`min-w-0 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 ${soldOut ? 'opacity-60' : ''}`}>
          <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-slate-100">
            {tier.name}
          </h3>

          {tier.description && (
            <div className="mt-1 flex items-start gap-1.5">
              <p className="line-clamp-2 min-w-0 text-sm leading-relaxed text-gray-600 dark:text-slate-400">
                {tier.description}
              </p>
              <button
                type="button"
                onClick={onShowDetails}
                className="mt-0.5 shrink-0 rounded text-gray-400 transition-colors hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:text-slate-500"
                aria-label={`${tier.name} details`}
              >
                <Info className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          {(soldOut || low || !tier.isRefundable) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {soldOut && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                  Sold out
                </span>
              )}
              {low && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30">
                  Only {tier.quantityAvailable} left
                </span>
              )}
              {!tier.isRefundable && (
                <button
                  type="button"
                  onClick={() => setShowPolicy((open) => !open)}
                  aria-expanded={showPolicy}
                  aria-controls={`tier-policy-${tier.id}`}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                >
                  Non-refundable
                  <Info className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          )}

          {showPolicy && (
            <p
              id={`tier-policy-${tier.id}`}
              className="mt-2 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-slate-900/50 dark:text-slate-400"
            >
              <span className="font-semibold text-gray-800 dark:text-slate-200">Non-refundable ticket. </span>
              This ticket is non-refundable, non-cancellable, and non-transferable after purchase. The delivery of the
              service is completed upon receiving this ticket by email.
            </p>
          )}

          <p className="mt-2.5 text-xs tabular-nums text-gray-500 dark:text-slate-400">
            {fees.taxInclusive ? (
              <>
                {formatPrice(fees.listedPrice)}
                {fees.tax > 0 && <> incl. {formatPrice(fees.tax)} tax</>}
              </>
            ) : (
              <>{formatPrice(fees.basePrice)}</>
            )}
            {fees.fees > 0 && <> + {formatPrice(fees.fees)} fees</>}
            {!fees.taxInclusive && fees.tax > 0 && <> + {formatPrice(fees.tax)} tax</>}
          </p>
        </div>

        {/* The stub: all-in price over the stepper, torn off by the perforation */}
        <div className="relative flex h-16 items-center justify-between gap-3 border-t-2 border-dashed border-gray-200 pl-5 pr-4 dark:border-slate-700 sm:h-auto sm:flex-col sm:justify-center sm:border-l-2 sm:border-t-0 sm:px-2 sm:py-4">
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 bg-brand transition-opacity duration-200 ${selected ? 'opacity-[0.07] dark:opacity-[0.12]' : 'opacity-0'}`}
          />
          <p
            className={`relative text-xl font-extrabold tabular-nums tracking-tight sm:text-2xl ${
              soldOut ? 'text-gray-400 line-through decoration-2 dark:text-slate-500' : 'text-gray-900 dark:text-slate-50'
            }`}
          >
            {formatPrice(fees.total)}
          </p>
          <div className="relative flex items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              aria-label={`Decrease ${tier.name} quantity`}
              onClick={() => onChange(-1)}
              disabled={soldOut || quantity === 0}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition-colors hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:focus-visible:ring-offset-slate-800"
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </button>
            <span
              className="min-w-[1.5rem] text-center text-lg font-bold tabular-nums text-gray-900 dark:text-slate-100"
              aria-label={`${tier.name} quantity`}
              aria-live="polite"
            >
              {quantity}
            </span>
            <button
              type="button"
              aria-label={`Increase ${tier.name} quantity`}
              onClick={() => onChange(1)}
              disabled={soldOut || maxQuantity < minQuantity || quantity >= maxQuantity}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-fg transition-[opacity,transform] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100 dark:focus-visible:ring-offset-slate-800"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
