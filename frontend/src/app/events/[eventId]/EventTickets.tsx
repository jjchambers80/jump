// Ticketed mode: one torn ticket per tier (TierStub, all-in prices from
// lib/fees.ts), then the add-ons the cart's tiers offer. In `preview` a draft
// with no tiers yet shows a placeholder stub instead of "Sold out".

import { Clock, Lock } from 'lucide-react';
import TierStub from './TierStub';
import EventAddOns from './EventAddOns';
import Placeholder from './Placeholder';
import { PreviewNote } from './PreviewOff';
import type { EventCart } from './useEventCart';
import type { EventPageEvent, EventPageState, PriceTier } from './eventPage';

interface EventTicketsProps {
  event: EventPageEvent;
  state: EventPageState;
  cart: EventCart;
  preview: boolean;
  checkoutCancelled?: boolean;
  formattedDate: string;
  onQuantityChange?: (tier: PriceTier, direction: 1 | -1) => void;
  onAddOnChange?: (addOnId: string, quantity: number) => void;
  onShowTier?: (tier: PriceTier) => void;
}

const EMPTY_BOX = 'rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-slate-600';

export default function EventTickets({ event, state, cart, preview, checkoutCancelled, formattedDate, onQuantityChange, onAddOnChange, onShowTier }: EventTicketsProps) {
  const { isPastEvent, activeTiers, salesClosed } = state;
  const awaitingTiers = preview && activeTiers.length === 0;
  const isSoldOut = state.isSoldOut && !awaitingTiers;
  const taxRate = event.taxRate ?? 0;
  const taxInclusive = event.taxInclusivePricing === true;

  return (
    <>
      {checkoutCancelled && !isPastEvent && (
        <div
          role="status"
          data-testid="checkout-cancelled"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
        >
          <p className="font-semibold">Payment not completed — you haven&apos;t been charged.</p>
          <p className="mt-0.5">
            {cart.totalQuantity > 0
              ? 'Your tickets are still in your cart. Check out again whenever you’re ready.'
              : 'Choose your tickets below to try again.'}
          </p>
        </div>
      )}
      <div id="tickets" className="mb-5 flex scroll-mt-6 items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">Admission</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">Tickets</h2>
        </div>
        {!isPastEvent && !isSoldOut && !salesClosed && activeTiers.length > 0 && (
          <p className="pb-1 text-right text-xs text-gray-500 dark:text-slate-400">
            Prices include fees{event.taxRate > 0 ? ' and tax' : ''}
          </p>
        )}
      </div>

      {/* No handler (the wizard pane): steppers are aria-disabled and point here */}
      {!onQuantityChange && !isPastEvent && !isSoldOut && !salesClosed && activeTiers.length > 0 && (
        <PreviewNote id="tickets-off" className="-mt-3 mb-4">
          Choosing tickets is off in preview
        </PreviewNote>
      )}

      {isPastEvent ? (
        <div className={EMPTY_BOX}>
          <Clock className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-slate-600" strokeWidth={1.5} aria-hidden />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300 mb-2">This event has ended</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm mx-auto">
            This event took place on {formattedDate}. Tickets are no longer available for purchase.
          </p>
        </div>
      ) : salesClosed ? (
        <div className={EMPTY_BOX} role="status" data-testid="sales-closed">
          <Lock className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-slate-600" strokeWidth={1.5} aria-hidden />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300 mb-2">Sales are closed</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm mx-auto">
            Tickets are no longer on sale for this event. Tickets already bought stay valid.
          </p>
        </div>
      ) : awaitingTiers ? (
        <div className={`${EMPTY_BOX} flex items-center justify-between gap-4 py-6 text-left`}>
          <Placeholder>Add tickets</Placeholder>
          <span className="text-xl font-extrabold tabular-nums">
            <Placeholder>$ –</Placeholder>
          </span>
        </div>
      ) : isSoldOut ? (
        // Spec 047 D1: the sold-out "Give without a ticket" link goes in this box.
        <div className={EMPTY_BOX}>
          <span className="inline-block -rotate-3 rounded-lg border-[3px] border-double border-red-600 px-5 py-2 text-lg font-extrabold uppercase tracking-[0.2em] text-red-700 dark:border-red-400 dark:text-red-400">
            Sold Out
          </span>
        </div>
      ) : activeTiers.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400 text-center py-4">No ticket tiers available</p>
      ) : (
        // Spec 047 D1: "Can't make it? Give without a ticket" goes under this list.
        <div className="space-y-3">
          {activeTiers.map((tier) => (
            <TierStub
              key={tier.id}
              tier={tier}
              quantity={cart.quantities[tier.id] ?? 0}
              taxRate={taxRate}
              taxInclusive={taxInclusive}
              onChange={(direction) => onQuantityChange?.(tier, direction)}
              onShowDetails={onShowTier && (() => onShowTier(tier))}
              offReasonId={onQuantityChange ? undefined : 'tickets-off'}
            />
          ))}
        </div>
      )}

      {!isPastEvent && !isSoldOut && !salesClosed && (
        <EventAddOns offered={cart.offered} quantities={cart.addOnQuantities} onChange={onAddOnChange} taxRate={taxRate} taxInclusive={taxInclusive} />
      )}
    </>
  );
}
