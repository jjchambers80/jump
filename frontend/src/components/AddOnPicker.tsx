'use client';

// Add-on quantity steppers (spec 012). Rendered under the tier list once the
// cart has a ticket (event page) or a tier is chosen (application form). The
// parent owns quantities; this component only renders and reports changes.

import React from 'react';
import { formatPrice } from '../lib/fees';
import { addOnAllInPrice, addOnMaxQuantity, type PickableAddOn } from '../lib/addOns';

interface AddOnPickerProps {
  addOns: PickableAddOn[];
  quantities: Record<string, number>;
  onChange: (addOnId: string, quantity: number) => void;
  taxRate?: number;
  taxInclusive?: boolean;
  /** Overrides the default all-in unit price (application forms pass the form's fee mode figure). */
  unitPrice?: (addOn: PickableAddOn) => number;
  title?: string;
  hint?: string;
}

export default function AddOnPicker({
  addOns,
  quantities,
  onChange,
  taxRate = 0,
  taxInclusive = false,
  unitPrice,
  title = 'Add-ons',
  hint = 'Optional extras for this order.',
}: AddOnPickerProps) {
  if (addOns.length === 0) return null;

  return (
    <section className="mt-6" data-testid="add-on-picker" aria-labelledby="add-on-picker-title">
      <h3 id="add-on-picker-title" className="text-lg font-bold text-gray-900 dark:text-slate-100">
        {title}
      </h3>
      {hint && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{hint}</p>}
      <div className="mt-3 space-y-3">
        {addOns.map((addOn) => {
          const quantity = quantities[addOn.id] ?? 0;
          const max = addOnMaxQuantity(addOn);
          const price = unitPrice ? unitPrice(addOn) : addOnAllInPrice(addOn, taxRate, taxInclusive).total;
          const soldOut = addOn.soldOut || max === 0;
          return (
            <div
              key={addOn.id}
              data-testid={`add-on-${addOn.id}`}
              className={`flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-slate-700 p-4 ${soldOut ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-slate-100">{addOn.name}</p>
                {addOn.description && (
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{addOn.description}</p>
                )}
                <p className="mt-1 text-sm">
                  <span className="font-bold text-brand-link">{formatPrice(price)}</span>
                  <span className="text-gray-400 dark:text-slate-500"> each</span>
                  {soldOut && <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">Sold out</span>}
                  {!soldOut && addOn.remaining !== null && addOn.remaining <= 5 && (
                    <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{addOn.remaining} left</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  aria-label={`Decrease ${addOn.name} quantity`}
                  onClick={() => onChange(addOn.id, Math.max(0, quantity - 1))}
                  disabled={quantity === 0}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xl font-bold leading-none text-gray-700 dark:text-slate-200 transition-colors hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30"
                >
                  −
                </button>
                <span className="min-w-6 text-center text-lg font-semibold text-gray-900 dark:text-slate-100" aria-label={`${addOn.name} quantity`}>
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${addOn.name} quantity`}
                  onClick={() => onChange(addOn.id, Math.min(max, quantity + 1))}
                  disabled={soldOut || quantity >= max}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-fg text-xl font-bold leading-none transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
