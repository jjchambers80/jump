'use client';

import { formatPrice, roundCurrency, type OrderFees } from '../lib/fees';

interface OrderTotalsProps {
  fees: OrderFees;
  /** Label for the final row, e.g. "Total (2 tickets)". */
  totalLabel?: string;
  className?: string;
}

/**
 * Subtotal / Tax / Shipping / Total rows shown at the bottom of the cart.
 *
 * Subtotal is the pre-tax amount the customer pays (base + platform +
 * processing fees), so Subtotal + Tax + Shipping equals Total. Tickets are
 * delivered digitally, so Shipping is always $0.00 but shown for clarity.
 */
export default function OrderTotals({ fees, totalLabel = 'Total', className = '' }: OrderTotalsProps) {
  const subtotal = roundCurrency(fees.subtotal + fees.platformFee + fees.processingFee);
  const shipping = 0;

  return (
    <div className={className} data-testid="order-totals">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-slate-400">Subtotal</dt>
          <dd className="font-medium text-gray-900 dark:text-slate-100">{formatPrice(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-slate-400">Tax</dt>
          <dd className="font-medium text-gray-900 dark:text-slate-100">{formatPrice(fees.tax)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-slate-400">Shipping</dt>
          <dd className="font-medium text-gray-900 dark:text-slate-100">{formatPrice(shipping)}</dd>
        </div>
      </dl>
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700 flex justify-between">
        <span className="font-semibold text-gray-700 dark:text-slate-300">{totalLabel}</span>
        <span className="text-xl font-bold text-gray-900 dark:text-slate-100">{formatPrice(fees.total)}</span>
      </div>
    </div>
  );
}
