'use client';

// Mobile cart drawer (ticketed events): a bottom sheet with the same lines and
// open breakdowns as the desktop summary. The container opens it; preview mode
// never does (no dialogs, spec 050 §8.2).

import { ChevronRight, X } from 'lucide-react';
import CartLineItem from '@/components/CartLineItem';
import OrderTotals from '@/components/OrderTotals';
import ExpandCollapseAll from '@/components/ExpandCollapseAll';
import EmptyCart from '@/components/EmptyCart';
import { formatPrice } from '@/lib/fees';
import { useDialog } from '@/lib/useDialog';
import type { EventCart } from './useEventCart';

interface EventCartSheetProps {
  cart: EventCart;
  onClose: () => void;
  onCheckout: () => void;
  onToggleLine: (key: string) => void;
  onToggleAllLines: () => void;
}

export default function EventCartSheet({ cart, onClose, onCheckout, onToggleLine, onToggleAllLines }: EventCartSheetProps) {
  const ref = useDialog(true, onClose);
  return (
    <div className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-cart-heading"
        tabIndex={-1}
        className="w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] flex flex-col overflow-hidden animate-slide-up motion-reduce:animate-none focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between gap-3">
          <h2 id="mobile-cart-heading" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your Cart</h2>
          <ExpandCollapseAll allOpen={cart.allLinesOpen} onToggle={onToggleAllLines} disabled={cart.lines.length === 0} />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1 shrink-0" aria-label="Close cart">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>
        <div className="px-4 pb-4 overflow-y-auto">
          {cart.items.length === 0 ? (
            <EmptyCart />
          ) : (
            <div data-testid="cart-lines-mobile">
              {cart.lines.map((line, index) => (
                <CartLineItem
                  key={line.key}
                  id={`mobile-${line.key}`}
                  name={line.name}
                  line={cart.fees.lines[index]}
                  open={!!cart.openLines[line.key]}
                  onToggle={() => onToggleLine(line.key)}
                  variant="drawer"
                />
              ))}
              <OrderTotals fees={cart.fees} className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-600" />
            </div>
          )}
        </div>
        {cart.items.length > 0 && (
          <div className="border-t border-gray-200 dark:border-slate-700 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onCheckout}
              className="disabled:cursor-not-allowed disabled:opacity-60 flex w-full items-center justify-center gap-2 rounded-[var(--theme-button-radius,8px)] bg-brand px-4 py-3 text-base font-bold text-brand-fg transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2"
            >
              Checkout {formatPrice(cart.totalAmount)}
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
