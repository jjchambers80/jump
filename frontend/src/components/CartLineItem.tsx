'use client';

// One ticket line in the cart / order summary. The line price is a disclosure
// button (dotted underline + caret) that opens an accordion listing the cost
// components that make up that price. Open/closed state is owned by the parent
// so a page-level "Expand all / Collapse all" can drive every line at once.

import React from 'react';
import { formatPrice, type LineBreakdown } from '../lib/fees';

interface CartLineItemProps {
  id: string;
  name: string;
  line: LineBreakdown;
  open: boolean;
  onToggle: () => void;
  /** `compact`: single row (desktop summary). `drawer`: two-line row (mobile sheet / checkout). */
  variant?: 'compact' | 'drawer';
}

export default function CartLineItem({
  id,
  name,
  line,
  open,
  onToggle,
  variant = 'compact',
}: CartLineItemProps) {
  const regionId = `cart-line-breakdown-${id}`;
  const isDrawer = variant === 'drawer';

  const priceButton = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={regionId}
      aria-label={`${open ? 'Hide' : 'Show'} price breakdown for ${name}`}
      data-testid="cart-line-price"
      className={`inline-flex items-center gap-1 rounded-sm text-gray-900 dark:text-slate-100 hover:text-brand-link focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        isDrawer ? 'font-semibold' : 'font-medium'
      }`}
    >
      <span className="border-b border-dotted border-current pb-px">{formatPrice(line.total)}</span>
      <svg
        aria-hidden="true"
        className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
          open ? 'rotate-90' : 'rotate-0'
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );

  return (
    <div
      data-testid="cart-line"
      data-line-id={id}
      data-open={open ? 'true' : 'false'}
      className={
        isDrawer
          ? 'py-3 border-b border-gray-100 dark:border-slate-700 last:border-0'
          : ''
      }
    >
      {isDrawer ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{name}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {formatPrice(line.unitPrice)} base each
            </p>
          </div>
          <div className="text-right shrink-0">
            {priceButton}
            <p className="text-sm text-gray-500 dark:text-slate-400">Qty: {line.quantity}</p>
          </div>
        </div>
      ) : (
        <div className="flex justify-between items-center gap-4 text-sm">
          <span className="text-gray-700 dark:text-slate-300 min-w-0 truncate">
            {name} x{line.quantity}
          </span>
          {priceButton}
        </div>
      )}

      <div
        id={regionId}
        role="region"
        aria-label={`Price breakdown for ${name}`}
        hidden={!open}
        data-testid="line-breakdown"
        className={`mt-2 rounded-md bg-gray-100/70 dark:bg-slate-700/40 px-3 py-2 text-xs text-gray-600 dark:text-slate-400 space-y-1 ${
          isDrawer ? '' : 'text-[0.8rem]'
        }`}
      >
        <BreakdownRow
          label={`Base price (${line.quantity} × ${formatPrice(line.unitPrice)})`}
          value={line.base}
        />
        <BreakdownRow label="Service fee" value={line.platformFee} />
        <BreakdownRow label="Processing fee" value={line.processingFee} />
        {line.tax > 0 && <BreakdownRow label="Tax" value={line.tax} />}
        <div className="flex justify-between gap-4 pt-1 border-t border-gray-200 dark:border-slate-600 font-semibold text-gray-800 dark:text-slate-200">
          <span>Line total</span>
          <span data-testid="line-breakdown-total">{formatPrice(line.total)}</span>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="tabular-nums">{formatPrice(value)}</span>
    </div>
  );
}
