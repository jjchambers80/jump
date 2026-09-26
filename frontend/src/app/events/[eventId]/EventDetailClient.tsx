'use client';

// Event detail page — displays event info with price tiers per FR-041
// Uses new schema: venue object, priceTiers array, computed quantityAvailable
// RSVP mode (spec 034): inline form instead of tiers, no Order Summary column

import React, { useState, useEffect } from 'react';
import StorefrontPasswordGate from '../../../components/StorefrontPasswordGate';
import { storefrontLockFrom, type StorefrontLock } from '../../../lib/storefrontAccess';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../services/api';
import { resolveAssetUrl } from '../../../lib/assets';
import BrandScope from '../../../components/BrandScope';
import OrganizationHeader from '../../../components/OrganizationHeader';
import StorefrontFooter from '../../../components/storefront/StorefrontFooter';
import GetInvolved from './GetInvolved';
import FloorMapPreview from './FloorMapPreview';
import RsvpPass from './RsvpPass';
import TierStub from './TierStub';
import CartLineItem from '../../../components/CartLineItem';
import OrderTotals from '../../../components/OrderTotals';
import ExpandCollapseAll from '../../../components/ExpandCollapseAll';
import EmptyCart from '../../../components/EmptyCart';
import { computeOrderFees, formatPrice } from '../../../lib/fees';
import AddOnPicker from '../../../components/AddOnPicker';
import { offeredAddOns, addOnMaxQuantity, type AddOn } from '../../../lib/addOns';
import type { ThemeMode } from '@/lib/theme';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { CalendarDays, ChevronRight, Clock, Info, Lock, MapPin } from 'lucide-react';
import { fetchLegalVersions, type LegalVersions } from '@/lib/legal';
import ContentHtml from '@/components/storefront/ContentHtml';

interface EventVenue {
  id: string;
  name: string;
  address: string;
  timezone?: string;
  isPublic?: boolean;
}

interface PriceTier {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  quantityAvailable: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  isRefundable: boolean;
}

interface Event {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string | null;
  date: string;
  capacity: number;
  category?: string;
  status: string;
  admissionMode?: 'TICKETED' | 'RSVP';
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  rsvpRemaining?: number | null;
  taxRate: number;
  /** Listed tier prices already include tax (spec 009 phase 3). */
  taxInclusivePricing?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: ThemeMode | null;
  /** Settings › Customer accounts › Show sign-in links (spec 031). */
  organizationSignInLinks?: boolean;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  /** Ticket-scope add-ons (spec 012); offered per cart tier. */
  addOns?: AddOn[];
  createdAt: string;
  updatedAt: string;
}

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<StorefrontLock | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addOnQuantities, setAddOnQuantities] = useState<Record<string, number>>({});
  const [showDescription, setShowDescription] = useState(false);
  const [showTierDescription, setShowTierDescription] = useState<PriceTier | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  // Which cart lines have their price breakdown open — shared by the desktop
  // summary and the mobile drawer so both views always agree.
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});

  // RSVP mode (spec 034): the form lives in RsvpPass; the page only needs to
  // know when it is done and whether it is on screen (for the mobile bar).
  const [legalVersions, setLegalVersions] = useState<LegalVersions | null>(null);
  const [rsvpSubmitted, setRsvpSubmitted] = useState(false);
  const [rsvpPassInView, setRsvpPassInView] = useState(false);

  useEffect(() => {
    fetchEventDetails();
    fetchLegalVersions().then(setLegalVersions).catch(() => {});
  }, [params.eventId]);

  const isRsvpEvent = event?.admissionMode === 'RSVP';
  useEffect(() => {
    const pass = isRsvpEvent ? document.getElementById('rsvp-pass') : null;
    if (!pass || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setRsvpPassInView(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(pass);
    return () => observer.disconnect();
  }, [isRsvpEvent]);

  const fetchEventDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await api.get<Event>(`/events/${params.eventId}`);
      setEvent(data);
      setLock(null);
    } catch (err: any) {
      const locked = storefrontLockFrom(err);
      if (locked) {
        setLock(locked);
        return;
      }
      setError(err.message || 'Failed to load event details');
      console.error('Error fetching event:', err);
    } finally {
      setLoading(false);
    }
  };

  const isRsvpMode = event?.admissionMode === 'RSVP';

  const totalAvailable =
    isRsvpMode ? 0 : event?.priceTiers?.reduce((sum, t) => sum + (t.isActive ? t.quantityAvailable : 0), 0) ?? 0;
  const isSoldOut = !isRsvpMode && totalAvailable === 0;

  const updateQuantity = (tier: PriceTier, direction: 1 | -1) => {
    setQuantities((current) => {
      const quantity = current[tier.id] ?? 0;
      const minimum = tier.minPerOrder ?? 1;
      const maximum = Math.min(tier.quantityAvailable, tier.maxPerOrder ?? 10, 10);
      if (direction === 1 && maximum < minimum) return current;
      const nextQuantity =
        direction === 1
          ? quantity === 0
            ? Math.min(minimum, maximum)
            : Math.min(quantity + 1, maximum)
          : quantity <= minimum
            ? 0
            : quantity - 1;

      return { ...current, [tier.id]: nextQuantity };
    });
  };

  const setAddOnQuantity = (addOnId: string, quantity: number) =>
    setAddOnQuantities((current) => ({ ...current, [addOnId]: quantity }));

  const handleProceedToCheckout = () => {
    if (cartItems.length > 0) {
      const search = new URLSearchParams({ items: JSON.stringify(cartItems) });
      if (addOnLines.length > 0) search.set('addOns', JSON.stringify(addOnLines));
      router.push(`/checkout/${params.eventId}?${search.toString()}`);
    }
  };

  if (lock) {
    return <StorefrontPasswordGate organization={lock.organization} message={lock.message} onUnlocked={fetchEventDetails} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 text-brand-link mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-600 dark:text-slate-400">Loading event details...</p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Event Not Found
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">
            {error || 'This event does not exist'}
          </p>
        </div>
      </div>
    );
  }

  const eventDate = new Date(event.date);
  // Spec 033: the show's wall clock belongs to the venue, not to whoever is looking.
  const zone = event.venue?.timezone;
  const formattedDate = formatEventDate(event.date, zone, { weekday: 'long', month: 'long' });
  const formattedTime = formatEventTime(event.date, zone);
  const tile = dateTile(event.date, zone);

  const isPastEvent = eventDate < new Date();
  const activeTiers = event.priceTiers.filter((t) => t.isActive);
  const cartItems = activeTiers
    .map((tier) => ({ priceTierId: tier.id, quantity: quantities[tier.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  // All-in order total with per-line fee allocation (mirrors backend FeeService)
  const cartTiers = activeTiers.filter((tier) => (quantities[tier.id] ?? 0) > 0);
  // Add-ons (spec 012): only those offered on a tier in the cart count; a
  // quantity left behind after its tier was removed is simply not a line.
  const offered = offeredAddOns(event.addOns, cartTiers.map((tier) => tier.id));
  const cartAddOns = offered.filter((addOn) => Math.min(addOnQuantities[addOn.id] ?? 0, addOnMaxQuantity(addOn)) > 0);
  const addOnLines = cartAddOns.map((addOn) => ({
    addOnId: addOn.id,
    quantity: Math.min(addOnQuantities[addOn.id] ?? 0, addOnMaxQuantity(addOn)),
  }));
  const cartFees = computeOrderFees(
    [
      ...cartTiers.map((tier) => ({ price: tier.price, quantity: quantities[tier.id] ?? 0 })),
      ...cartAddOns.map((addOn, i) => ({ price: addOn.price, quantity: addOnLines[i].quantity, taxable: addOn.taxable })),
    ],
    event?.taxRate ?? 0,
    event?.taxInclusivePricing === true
  );
  const totalAmount = cartTiers.length > 0 ? cartFees.total : 0;
  // Lines in cart order: tiers first, then add-ons (same order as `cartFees.lines`)
  const cartLines = [
    ...cartTiers.map((tier) => ({ key: tier.id, name: tier.name })),
    ...cartAddOns.map((addOn) => ({ key: addOn.id, name: addOn.name })),
  ];

  const allLinesOpen = cartLines.length > 0 && cartLines.every((line) => openLines[line.key]);
  const toggleLine = (key: string) =>
    setOpenLines((current) => ({ ...current, [key]: !current[key] }));
  const toggleAllLines = () => {
    const next = !allLinesOpen;
    setOpenLines(Object.fromEntries(cartLines.map((line) => [line.key, next])));
  };

  const rsvpFull = isRsvpMode && !isPastEvent && event.rsvpRemaining != null && event.rsvpRemaining <= 0;

  return (
    <BrandScope color={event.organizationBrandColor} themeMode={event.organizationThemeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900 pb-20 sm:pb-0">
      {event.organizationName && (
        <OrganizationHeader
          organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl }}
          nav
          signIn={event.organizationSignInLinks !== false}
        />
      )}
      <div className={`max-w-6xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-12 ${isRsvpMode ? 'lg:block' : 'lg:flex lg:gap-8 lg:items-start'}`}>
        {/* RSVP mode drops overflow-hidden so the pass can stick; the hero clips its own corners */}
        <div className={`flex-1 min-w-0 bg-transparent sm:bg-white sm:dark:bg-slate-800 rounded-none sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-slate-700 sm:shadow-sm sm:dark:shadow-black/20 ${isRsvpMode ? '' : 'overflow-hidden'}`}>
          {/* Hero: blurred poster behind the title block, date tile, venue */}
          <div className="relative">
            {/* Background layers - clipped */}
            <div className="absolute inset-0 overflow-hidden bg-slate-900 sm:rounded-t-2xl">
              {event.logoUrl && (
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-70"
                  style={{
                    backgroundImage: `url(${resolveAssetUrl(event.logoUrl)})`,
                    filter: 'blur(28px) saturate(1.2)',
                    transform: 'scale(1.15)',
                  }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/40" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
            </div>

            <div className="relative flex items-center justify-between gap-8 p-6 sm:p-10">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {event.category && (
                    <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                      {event.category}
                    </span>
                  )}
                  {event.organizationName && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">
                      {event.organizationId ? (
                        <Link
                          href={`/organizations/${event.organizationId}`}
                          className="transition-colors hover:text-white hover:underline"
                        >
                          {event.organizationName}
                        </Link>
                      ) : (
                        event.organizationName
                      )}
                    </p>
                  )}
                </div>
                <h1 className="text-balance text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-[2.75rem]">
                  {event.name}
                </h1>

                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
                  <div className="flex items-center gap-3">
                    {tile ? (
                      <div
                        aria-hidden
                        className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-white/10 py-1.5 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm"
                      >
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{tile.month}</span>
                        <span className="text-[22px] font-extrabold leading-none tabular-nums">{tile.day}</span>
                      </div>
                    ) : (
                      <CalendarDays className="h-5 w-5 shrink-0 text-gray-200" aria-hidden />
                    )}
                    <div className="leading-snug">
                      <p className="font-semibold text-white">{formattedDate}</p>
                      <p className="text-sm text-gray-300">{formattedTime}</p>
                    </div>
                  </div>

                  {event.venue && (
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm"
                      >
                        <MapPin className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 leading-snug">
                        {event.venue.isPublic ? (
                          <Link href={`/venues/${event.venue.id}`} className="font-semibold text-white hover:underline">
                            {event.venue.name}
                          </Link>
                        ) : (
                          <p className="font-semibold text-white">{event.venue.name}</p>
                        )}
                        <p className="text-sm text-gray-300">{event.venue.address}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* RSVP pages show the description inline under "About" */}
                {event.description && !isRsvpMode && (
                  <button
                    type="button"
                    onClick={() => setShowDescription(true)}
                    className="mt-6 inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Info className="h-4 w-4" aria-hidden />
                    <span>Event Information</span>
                  </button>
                )}
              </div>

              {/* Foreground event image - desktop inline */}
              {event.logoUrl && (
                <button
                  type="button"
                  onClick={() => setShowImagePreview(true)}
                  aria-label={`View ${event.name} image`}
                  className="group hidden shrink-0 sm:block"
                >
                  <div className="flex h-40 w-40 rotate-2 items-center justify-center overflow-hidden rounded-xl bg-black/40 shadow-2xl shadow-black/50 ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:rotate-0 group-hover:scale-[1.02] motion-reduce:transition-none lg:h-44 lg:w-44">
                    <img
                      src={resolveAssetUrl(event.logoUrl) || undefined}
                      alt={`${event.name}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                </button>
              )}
            </div>

            {/* Foreground event image - mobile floating square */}
            {event.logoUrl && (
              <button
                type="button"
                onClick={() => setShowImagePreview(true)}
                aria-label={`View ${event.name} image`}
                className="absolute bottom-0 right-4 z-10 translate-y-1/2 cursor-pointer sm:hidden"
              >
                <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border-2 border-white bg-black/40 shadow-lg dark:border-slate-800">
                  <img
                    src={resolveAssetUrl(event.logoUrl) || undefined}
                    alt={`${event.name}`}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </button>
            )}
          </div>

          {/* Content area: Tiers (ticketed) or About + RSVP pass (RSVP mode) */}
          {/* The mobile poster hangs 4rem below the hero: the pass must clear it, a heading need not */}
          <div
            className={
              isRsvpMode
                ? `p-6 sm:p-8 ${event.logoUrl ? 'pt-24 sm:pt-8' : ''}`
                : `px-4 pb-6 sm:p-10 ${event.logoUrl ? 'pt-[4.5rem]' : 'pt-6'}`
            }
          >
            {isRsvpMode ? (
              <div className={event.description ? 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12' : 'mx-auto max-w-md'}>
                {/* Pass first on mobile: it is the one thing to do here */}
                <div id="rsvp-pass" className="scroll-mt-6 lg:order-2">
                  <div className="lg:sticky lg:top-6">
                    <RsvpPass
                      event={event}
                      isPastEvent={isPastEvent}
                      legalVersions={legalVersions}
                      onLegalStale={() => fetchLegalVersions().then(setLegalVersions).catch(() => {})}
                      onSubmitted={() => setRsvpSubmitted(true)}
                    />
                  </div>
                </div>

                {event.description && (
                  <section aria-labelledby="about-heading" className="min-w-0 lg:order-1 lg:pt-1">
                    <h2 id="about-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
                      About this event
                    </h2>
                    <ContentHtml html={event.description} className="text-base" />
                  </section>
                )}
              </div>
            ) : (
              <>
                {/* Ticketed mode — one torn ticket per tier */}
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
                      Admission
                    </p>
                    <h2 className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">Tickets</h2>
                  </div>
                  {!isPastEvent && !isSoldOut && activeTiers.length > 0 && (
                    <p className="pb-1 text-right text-xs text-gray-500 dark:text-slate-400">
                      Prices include fees{event.taxRate > 0 ? ' and tax' : ''}
                    </p>
                  )}
                </div>

                {isPastEvent ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-slate-600">
                    <Clock className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-slate-600" strokeWidth={1.5} aria-hidden />
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300 mb-2">This event has ended</h3>
                    <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm mx-auto">
                      This event took place on {formattedDate}. Tickets are no longer available for purchase.
                    </p>
                  </div>
                ) : isSoldOut ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-slate-600">
                    <span className="inline-block -rotate-3 rounded-lg border-[3px] border-double border-red-600 px-5 py-2 text-lg font-extrabold uppercase tracking-[0.2em] text-red-700 dark:border-red-400 dark:text-red-400">
                      Sold Out
                    </span>
                  </div>
                ) : activeTiers.length === 0 ? (
                  <p className="text-gray-500 dark:text-slate-400 text-center py-4">
                    No ticket tiers available
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activeTiers.map((tier) => (
                      <TierStub
                        key={tier.id}
                        tier={tier}
                        quantity={quantities[tier.id] ?? 0}
                        taxRate={event.taxRate ?? 0}
                        taxInclusive={event.taxInclusivePricing === true}
                        onChange={(direction) => updateQuantity(tier, direction)}
                        onShowDetails={() => setShowTierDescription(tier)}
                      />
                    ))}
                  </div>
                )}

                {/* Add-ons (spec 012): shown once the cart holds a ticket that offers them */}
                {!isPastEvent && !isSoldOut && offered.length > 0 && (
                  <div className="mt-8">
                    <AddOnPicker
                      addOns={offered}
                      quantities={addOnQuantities}
                      onChange={setAddOnQuantity}
                      taxRate={event.taxRate ?? 0}
                      taxInclusive={event.taxInclusivePricing === true}
                      hint="Optional extras bought with your tickets."
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Line both up with the ticketed content's gutter (px-4, sm:p-10) */}
          <div className={isRsvpMode ? '' : '-mx-2 sm:mx-0 sm:px-2'}>
            {/* Applications (spec 011): vendors, sponsors, press, panels */}
            <GetInvolved eventId={event.id} />

            {/* Floor map preview (spec 014 phase 1) */}
            <FloorMapPreview eventId={event.id} />
          </div>
        </div>
        {/* End content card */}

        {/* Desktop sticky cart — hidden in RSVP mode */}
        {!isRsvpMode && !isPastEvent && !isSoldOut && (
          <div className="hidden lg:block lg:w-[21rem] flex-shrink-0">
            <div className="sticky top-8">
              <div className="rounded-2xl border border-gray-200 border-t-4 border-t-brand bg-white p-6 shadow-sm dark:border-slate-700 dark:border-t-brand dark:bg-slate-800 dark:shadow-black/20">
                <div className="mb-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-lg font-bold tracking-tight text-gray-900 dark:text-slate-100">Order Summary</h3>
                    <ExpandCollapseAll
                      allOpen={allLinesOpen}
                      onToggle={toggleAllLines}
                      disabled={cartLines.length === 0}
                    />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {totalQuantity > 0
                      ? `${totalQuantity} ${totalQuantity === 1 ? 'ticket' : 'tickets'} selected`
                      : 'Review your selection'}
                  </p>
                </div>

                {cartItems.length === 0 ? (
                  <EmptyCart />
                ) : (
                  <div className="space-y-3 mb-4" data-testid="cart-lines-desktop">
                    {cartLines.map((line, index) => (
                      <CartLineItem
                        key={line.key}
                        id={`desktop-${line.key}`}
                        name={line.name}
                        line={cartFees.lines[index]}
                        open={!!openLines[line.key]}
                        onToggle={() => toggleLine(line.key)}
                        variant="compact"
                      />
                    ))}
                  </div>
                )}

                {cartItems.length > 0 && (
                  <>
                    <OrderTotals
                      fees={cartFees}
                      totalLabel={`Total (${totalQuantity} ${totalQuantity === 1 ? 'ticket' : 'tickets'})`}
                      className="border-t border-gray-200 dark:border-slate-700 pt-4 mb-4"
                    />

                    <button
                      onClick={handleProceedToCheckout}
                      className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-lg font-bold text-brand-fg transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
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
        )}
      </div>

      {/* Mobile floating bar — checkout for ticketed, RSVP scroll-to for RSVP */}
      {!isPastEvent && !(isRsvpMode && rsvpFull) && (
        <div
          className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ease-out ${
            isRsvpMode
              ? !rsvpSubmitted && !rsvpPassInView ? 'translate-y-0' : 'translate-y-full'
              : totalQuantity > 0 ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          {isRsvpMode ? (
            /* Mobile RSVP bar — scrolls to the form */
            <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => document.getElementById('rsvp-pass')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full bg-brand hover:bg-brand-hover text-brand-fg font-bold py-3 px-4 rounded-lg transition-colors duration-200 text-base"
              >
                Reserve my spot · Free
              </button>
            </div>
          ) : (
            /* Mobile checkout bar */
            <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowMobileCart(true)}
                  className="relative flex items-center justify-center w-12 h-12 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200"
                  aria-label="View cart"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                  {totalQuantity > 0 && (
                    <span className="absolute -top-1 -right-1 bg-brand text-brand-fg text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                      {totalQuantity}
                    </span>
                  )}
                </button>

                <button
                  onClick={handleProceedToCheckout}
                  disabled={cartItems.length === 0}
                  className="flex-1 bg-brand hover:bg-brand-hover disabled:bg-gray-400 disabled:cursor-not-allowed text-brand-fg disabled:text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 text-base flex items-center justify-center gap-2"
                >
                  <span>Checkout {formatPrice(totalAmount)}</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile cart drawer — only for ticketed events */}
      {!isRsvpMode && showMobileCart && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setShowMobileCart(false)}
        >
          <div
            className="w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[70vh] overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
            </div>
            <div className="px-4 pb-2 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your Cart</h3>
              <ExpandCollapseAll
                allOpen={allLinesOpen}
                onToggle={toggleAllLines}
                disabled={cartLines.length === 0}
              />
              <button
                onClick={() => setShowMobileCart(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1 shrink-0"
                aria-label="Close cart"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto">
              {cartItems.length === 0 ? (
                <EmptyCart />
              ) : (
                <div data-testid="cart-lines-mobile">
                  {cartLines.map((line, index) => (
                    <CartLineItem
                      key={line.key}
                      id={`mobile-${line.key}`}
                      name={line.name}
                      line={cartFees.lines[index]}
                      open={!!openLines[line.key]}
                      onToggle={() => toggleLine(line.key)}
                      variant="drawer"
                    />
                  ))}

                  <OrderTotals
                    fees={cartFees}
                    className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-600"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tier Description Dialog */}
      {showTierDescription && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowTierDescription(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                {showTierDescription.name}
              </h2>
              <button
                onClick={() => setShowTierDescription(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-700 dark:text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">
                {showTierDescription.description}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Event Information Dialog */}
      {/* Image Preview - drawer on mobile, dialog on desktop */}
      {showImagePreview && event?.logoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
          onClick={() => setShowImagePreview(false)}
        >
          {/* Mobile: slide-up drawer */}
          <div
            className="sm:hidden w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
            </div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{event.name}</h3>
              <button
                onClick={() => setShowImagePreview(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 pb-6">
              <img
                src={resolveAssetUrl(event.logoUrl) || undefined}
                alt={event.name}
                className="w-full h-auto object-contain rounded-lg"
              />
            </div>
          </div>
          {/* Desktop: centered dialog */}
          <div
            className="hidden sm:block bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{event.name}</h3>
              <button
                onClick={() => setShowImagePreview(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <img
                src={resolveAssetUrl(event.logoUrl) || undefined}
                alt={event.name}
                className="w-full h-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {showDescription && event?.description && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
          onClick={() => setShowDescription(false)}
        >
          {/* Mobile: slide-up drawer */}
          <div
            className="sm:hidden w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
            </div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Event Information</h3>
              <button
                onClick={() => setShowDescription(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 pb-6 overflow-y-auto max-h-[70vh]">
              <ContentHtml html={event.description} className="text-base" />
            </div>
          </div>
          {/* Desktop: centered dialog */}
          <div
            className="hidden sm:block bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                Event Information
              </h2>
              <button
                onClick={() => setShowDescription(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <ContentHtml html={event.description} className="text-lg" />
            </div>
          </div>
        </div>
      )}
      {event.organizationId && event.organizationName && (
        <StorefrontFooter organization={{ id: event.organizationId, name: event.organizationName }} />
      )}
    </BrandScope>
  );
}