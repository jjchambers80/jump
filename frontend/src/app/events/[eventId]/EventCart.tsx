// Desktop sticky Order Summary (ticketed events). Lines and totals come from
// useEventCart; in `preview` checkout is disabled (spec 050 F / §8.2).
// Spec 047 D1 adds its "Give to {Org}" link under the checkout button.

import { ChevronRight, Lock } from 'lucide-react';
import CartLineItem from '@/components/CartLineItem';
import OrderTotals from '@/components/OrderTotals';
import ExpandCollapseAll from '@/components/ExpandCollapseAll';
import EmptyCart from '@/components/EmptyCart';
import type { EventCart as Cart } from './useEventCart';

interface EventCartProps {
  cart: Cart;
  preview: boolean;
  onCheckout?: () => void;
  onToggleLine?: (key: string) => void;
  onToggleAllLines?: () => void;
}

export const ticketCount = (quantity: number) => `${quantity} ${quantity === 1 ? 'ticket' : 'tickets'}`;

export default function EventCart({ cart, preview, onCheckout, onToggleLine, onToggleAllLines }: EventCartProps) {
  return (
    <div className="hidden lg:block lg:w-[21rem] flex-shrink-0">
      <div className="sticky top-8">
        <div className="rounded-2xl border border-gray-200 border-t-4 border-t-brand bg-white p-6 shadow-sm dark:border-slate-700 dark:border-t-brand dark:bg-slate-800 dark:shadow-black/20">
          <div className="mb-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold tracking-tight text-gray-900 dark:text-slate-100">Order Summary</h3>
              <ExpandCollapseAll allOpen={cart.allLinesOpen} onToggle={onToggleAllLines ?? (() => {})} disabled={cart.lines.length === 0} />
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {cart.totalQuantity > 0 ? `${ticketCount(cart.totalQuantity)} selected` : 'Review your selection'}
            </p>
          </div>

          {cart.items.length === 0 ? (
            <EmptyCart />
          ) : (
            <div className="space-y-3 mb-4" data-testid="cart-lines-desktop">
              {cart.lines.map((line, index) => (
                <CartLineItem
                  key={line.key}
                  id={`desktop-${line.key}`}
                  name={line.name}
                  line={cart.fees.lines[index]}
                  open={!!cart.openLines[line.key]}
                  onToggle={() => onToggleLine?.(line.key)}
                  variant="compact"
                />
              ))}
            </div>
          )}

          {cart.items.length > 0 && (
            <>
              <OrderTotals
                fees={cart.fees}
                totalLabel={`Total (${ticketCount(cart.totalQuantity)})`}
                className="border-t border-gray-200 dark:border-slate-700 pt-4 mb-4"
              />

              <button
                onClick={onCheckout}
                disabled={preview}
                className="group flex disabled:cursor-not-allowed disabled:opacity-60 w-full items-center justify-center gap-2 rounded-[var(--theme-button-radius,0.75rem)] bg-brand px-6 py-3.5 text-lg font-bold text-brand-fg transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              >
                Proceed to Checkout
                <ChevronRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Secure checkout · Tickets sent by email
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
