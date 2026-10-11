'use client';

// The public event page, presentational (spec 050 §8.2): no fetching, no
// routing. The container (EventDetailClient) feeds it the event, cart and
// handlers; the wizard's preview frame (050-H) feeds it a client-built event
// with `preview`. Branded by BrandScope with the org's colour and theme mode
// (gotchas 6/7, never setTheme).
//
// `preview` = no commerce: checkout and RSVP submit are disabled, no dialog
// opens, and unset fields render as placeholders ("Add a date", "$ –").
// Section anchors: #event-hero #event-hero-image #event-date #event-venue
// #about #tickets #rsvp-pass #add-ons #get-involved #floor-map.

import type { ReactNode } from 'react';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import StorefrontFooter from '@/components/storefront/StorefrontFooter';
import EventPreviewBar from '@/components/storefront/EventPreviewBar';
import { formatEventDate } from '@/lib/eventTime';
import type { LegalVersions } from '@/lib/legal';
import EventHero from './EventHero';
import EventAbout from './EventAbout';
import EventTickets from './EventTickets';
import EventRsvp from './EventRsvp';
import EventCart from './EventCart';
import EventMobileBar from './EventMobileBar';
import { EMPTY_CART, type EventCart as Cart } from './useEventCart';
import { eventPageState, type EventPageEvent, type EventPageOrg, type PriceTier } from './eventPage';

export interface EventPageHandlers {
  onQuantityChange?: (tier: PriceTier, direction: 1 | -1) => void;
  onAddOnChange?: (addOnId: string, quantity: number) => void;
  onToggleLine?: (key: string) => void;
  onToggleAllLines?: () => void;
  onCheckout?: () => void;
  onOpenCart?: () => void;
  /** Dialog openers: omitted in preview, which hides their buttons. */
  onShowDescription?: () => void;
  onShowImage?: () => void;
  onShowTier?: (tier: PriceTier) => void;
  onRsvpSubmitted?: () => void;
  onLegalStale?: () => void;
}

export interface EventPageViewProps extends EventPageHandlers {
  event: EventPageEvent;
  org: EventPageOrg;
  preview?: boolean;
  /** 050-F's draft bar. The wizard's in-pane preview leaves it off. */
  previewBar?: boolean;
  /** False when the theme frame (spec 038) already renders the header and footer. */
  chrome?: boolean;
  cart?: Cart;
  legalVersions?: LegalVersions | null;
  checkoutCancelled?: boolean;
  rsvpSubmitted?: boolean;
  /** The container's open dialogs, rendered inside the brand scope. */
  children?: ReactNode;
}

export default function EventPageView({
  event,
  org,
  preview = false,
  previewBar = false,
  chrome = true,
  cart = EMPTY_CART,
  legalVersions = null,
  checkoutCancelled,
  rsvpSubmitted,
  children,
  ...on
}: EventPageViewProps) {
  const state = eventPageState(event);
  const { isRsvp, isPastEvent, isSoldOut, salesClosed } = state;
  const zone = event.venue?.timezone;
  const formattedDate = event.date ? formatEventDate(event.date, zone, { weekday: 'long', month: 'long' }) : '';

  return (
    <BrandScope color={org.brandColor} themeMode={org.themeMode} className={`${chrome ? 'min-h-screen' : ''} bg-gray-50 dark:bg-slate-900 pb-24 lg:pb-0`}>
      {previewBar && <EventPreviewBar organizationId={org.id} />}
      {chrome && org.name && (
        <OrganizationHeader
          organization={{ id: org.id, name: org.name, logoUrl: org.logoUrl, storefrontLogo: org.storefrontLogo }}
          nav
          signIn={org.signInLinks !== false}
        />
      )}
      <div className={`max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-12 ${isRsvp ? 'lg:block' : 'lg:flex lg:gap-8 lg:items-start'}`}>
        {/* RSVP mode drops overflow-hidden so the pass can stick; the hero clips its own corners */}
        <div className={`flex-1 min-w-0 bg-transparent sm:bg-white sm:dark:bg-slate-800 rounded-none sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-slate-700 sm:shadow-sm sm:dark:shadow-black/20 ${isRsvp ? '' : 'overflow-hidden'}`}>
          <EventHero event={event} org={org} preview={preview} onShowDescription={on.onShowDescription} onShowImage={on.onShowImage} />

          {/* The mobile poster hangs 4rem below the hero: the pass must clear it, a heading need not */}
          <div
            className={
              isRsvp
                ? `p-6 sm:p-8 ${event.logoUrl ? 'pt-24 sm:pt-8' : ''}`
                : `px-4 pb-6 sm:p-10 ${event.logoUrl ? 'pt-[4.5rem]' : 'pt-6'}`
            }
          >
            {isRsvp ? (
              <EventRsvp
                event={event}
                isPastEvent={isPastEvent}
                preview={preview}
                legalVersions={legalVersions}
                onLegalStale={on.onLegalStale}
                onSubmitted={on.onRsvpSubmitted}
              />
            ) : (
              <>
                {/* Preview has no Event Information dialog: the description shows inline */}
                {preview && <EventAbout description={event.description} className="mb-8" />}
                <EventTickets
                  event={event}
                  state={state}
                  cart={cart}
                  preview={preview}
                  checkoutCancelled={checkoutCancelled}
                  formattedDate={formattedDate}
                  onQuantityChange={on.onQuantityChange}
                  onAddOnChange={on.onAddOnChange}
                  onShowTier={on.onShowTier}
                />
              </>
            )}
          </div>
        </div>

        {!isRsvp && !isPastEvent && !isSoldOut && !salesClosed && (
          <EventCart cart={cart} preview={preview} onCheckout={on.onCheckout} onToggleLine={on.onToggleLine} onToggleAllLines={on.onToggleAllLines} />
        )}
      </div>

      <EventMobileBar state={state} cart={cart} preview={preview} rsvpSubmitted={rsvpSubmitted} onOpenCart={on.onOpenCart} onCheckout={on.onCheckout} />

      {!preview && children}
      {chrome && org.id && org.name && <StorefrontFooter organization={{ id: org.id, name: org.name }} />}
    </BrandScope>
  );
}
