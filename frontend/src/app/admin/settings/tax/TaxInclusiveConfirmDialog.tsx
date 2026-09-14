'use client';

// Confirm flipping tax-inclusive pricing. It changes what every customer sees,
// so the dialog shows a worked example at one of the organization's rates.
// Not SettingsDialog: there is no form to make dirty, and a "discard changes?"
// prompt on Cancel would be wrong here.

import { RefObject, useEffect, useRef } from 'react';
import { computeTierAllInPrice, formatPrice } from '@/lib/fees';
import { formatRate } from './types';

interface TaxInclusiveConfirmDialogProps {
  enabling: boolean;
  /** A representative rate for the example (fraction). */
  sampleRate: number;
  saving: boolean;
  returnFocusRef: RefObject<HTMLInputElement>;
  onClose: () => void;
  onConfirm: () => void;
}

const SAMPLE_PRICE = 50;

export default function TaxInclusiveConfirmDialog({ enabling, sampleRate, saving, returnFocusRef, onClose, onConfirm }: TaxInclusiveConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inclusive = computeTierAllInPrice(SAMPLE_PRICE, sampleRate, true);
  const exclusive = computeTierAllInPrice(SAMPLE_PRICE, sampleRate, false);
  const next = enabling ? inclusive : exclusive;

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // Mount-only focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tax-inclusive-confirm-title"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <h2 id="tax-inclusive-confirm-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          {enabling ? 'Include sales tax in ticket prices?' : 'Add sales tax on top of ticket prices?'}
        </h2>
        <div className="mt-3 space-y-4 text-sm text-gray-700 dark:text-slate-300">
          <p>This changes the price every customer sees on every event. Orders already placed are not affected.</p>
          <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700" data-testid="tax-inclusive-example">
            <p className="font-medium text-gray-900 dark:text-white">
              Example: a {formatPrice(SAMPLE_PRICE)} tier at {formatRate(sampleRate)}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-gray-600 dark:text-slate-400">Ticket price</dt>
              <dd>
                {enabling
                  ? `${formatPrice(next.listedPrice)} incl. ${formatPrice(next.tax)} tax`
                  : `${formatPrice(next.basePrice)} + ${formatPrice(next.tax)} tax`}
              </dd>
              <dt className="text-gray-600 dark:text-slate-400">Fees</dt>
              <dd>{formatPrice(next.fees)}</dd>
              <dt className="font-medium text-gray-900 dark:text-white">Customer pays</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{formatPrice(next.total)}</dd>
            </dl>
            <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">
              Today the same tier costs {formatPrice(enabling ? exclusive.total : inclusive.total)}.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : enabling ? 'Include tax in prices' : 'Add tax on top'}
          </button>
        </div>
      </div>
    </div>
  );
}
