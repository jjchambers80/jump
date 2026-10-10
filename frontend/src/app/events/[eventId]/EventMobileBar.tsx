'use client';

// Mobile floating bar. RSVP: "Reserve my spot" scrolls to the pass and hides
// while the pass is on screen or once submitted. Ticketed: "Get tickets" jumps
// to the tier list until the cart has a ticket, then cart + checkout. The
// scrolling is this document's own (inside the wizard's preview iframe too).

import { useEffect, useState } from 'react';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { formatPrice } from '@/lib/fees';
import { ticketCount } from './EventCart';
import type { EventCart } from './useEventCart';
import type { EventPageState } from './eventPage';

interface EventMobileBarProps {
  state: EventPageState;
  cart: EventCart;
  preview: boolean;
  rsvpSubmitted?: boolean;
  onOpenCart?: () => void;
  onCheckout?: () => void;
}

const BAR =
  'bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]';
const PRIMARY = 'w-full bg-brand hover:bg-brand-hover text-brand-fg font-bold py-3 px-4 rounded-[var(--theme-button-radius,8px)] transition-colors duration-200 text-base';

/** Whether the element with `id` is on screen (threshold as a fraction of it). */
function useInView(id: string, enabled: boolean, threshold: number) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const target = enabled ? document.getElementById(id) : null;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    observer.observe(target);
    return () => observer.disconnect();
  }, [id, enabled, threshold]);
  return inView;
}

export default function EventMobileBar({ state, cart, preview, rsvpSubmitted, onOpenCart, onCheckout }: EventMobileBarProps) {
  const { isRsvp, isPastEvent, rsvpFull, canBuy, fromPrice } = state;
  const rsvpPassInView = useInView('rsvp-pass', isRsvp, 0.25);
  const ticketsInView = useInView('tickets', !isRsvp, 0.1);
  if (isPastEvent || (isRsvp && rsvpFull)) return null;

  const shown = isRsvp ? !rsvpSubmitted && !rsvpPassInView : cart.totalQuantity > 0 || (canBuy && !ticketsInView);

  return (
    <div className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ease-out ${shown ? 'translate-y-0' : 'translate-y-full'}`}>
      {isRsvp ? (
        <div className={BAR}>
          <button type="button" onClick={() => document.getElementById('rsvp-pass')?.scrollIntoView({ behavior: 'smooth' })} className={PRIMARY}>
            Reserve my spot · Free
          </button>
        </div>
      ) : cart.totalQuantity === 0 ? (
        <div className={BAR}>
          <button
            type="button"
            onClick={() => {
              const tickets = document.getElementById('tickets');
              tickets?.scrollIntoView({ behavior: 'smooth' });
              // First "+" stepper under the Tickets heading, for keyboard and screen reader users
              tickets?.parentElement?.querySelector<HTMLElement>('button[aria-label^="Increase"]')?.focus({ preventScroll: true });
            }}
            tabIndex={ticketsInView ? -1 : undefined}
            data-testid="mobile-get-tickets"
            className={PRIMARY}
          >
            Get tickets{fromPrice != null ? ` · from ${formatPrice(fromPrice)}` : ''}
          </button>
        </div>
      ) : (
        <div className={BAR}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenCart}
              disabled={preview}
              className="relative flex items-center justify-center w-12 h-12 rounded-[var(--theme-button-radius,8px)] bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 disabled:cursor-not-allowed"
              aria-label={`View cart, ${ticketCount(cart.totalQuantity)}`}
              aria-haspopup="dialog"
            >
              <ShoppingCart className="w-6 h-6" aria-hidden />
              <span aria-hidden="true" className="absolute -top-1 -right-1 bg-brand text-brand-fg text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {cart.totalQuantity}
              </span>
            </button>

            <button
              onClick={onCheckout}
              disabled={cart.items.length === 0 || preview}
              className="flex-1 bg-brand hover:bg-brand-hover disabled:bg-gray-400 disabled:cursor-not-allowed text-brand-fg disabled:text-white font-bold py-3 px-4 rounded-[var(--theme-button-radius,8px)] transition-colors duration-200 text-base flex items-center justify-center gap-2"
            >
              <span>Checkout {formatPrice(cart.totalAmount)}</span>
              <ChevronRight className="w-5 h-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
