'use client';

// Event detail page — displays event info with price tiers per FR-041
// Uses new schema: venue object, priceTiers array, computed quantityAvailable

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
import CartLineItem from '../../../components/CartLineItem';
import OrderTotals from '../../../components/OrderTotals';
import ExpandCollapseAll from '../../../components/ExpandCollapseAll';
import EmptyCart from '../../../components/EmptyCart';
import { computeOrderFees, computeTierAllInPrice, formatPrice } from '../../../lib/fees';
import AddOnPicker from '../../../components/AddOnPicker';
import { offeredAddOns, addOnMaxQuantity, type AddOn } from '../../../lib/addOns';
import type { ThemeMode } from '@/lib/theme';

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

  useEffect(() => {
    fetchEventDetails();
  }, [params.eventId]);

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

  const totalAvailable =
    event?.priceTiers?.reduce((sum, t) => sum + (t.isActive ? t.quantityAvailable : 0), 0) ?? 0;
  const isSoldOut = totalAvailable === 0;

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
  const formattedDate = eventDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = eventDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

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

  return (
    <BrandScope color={event.organizationBrandColor} themeMode={event.organizationThemeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900 pb-20 sm:pb-0">
      {event.organizationName && (
        <OrganizationHeader
          organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl }}
          nav
          signIn={event.organizationSignInLinks !== false}
        />
      )}
      <div className="max-w-6xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-12 lg:flex lg:gap-6 lg:items-start">
        <div className="flex-1 min-w-0 bg-transparent sm:bg-white sm:dark:bg-slate-800 rounded-none sm:rounded-lg sm:shadow-lg sm:dark:shadow-lg sm:dark:shadow-black/20 overflow-hidden">
          {/* Hero Header */}
          <div className="relative">
            {/* Background layers - clipped */}
            <div className="absolute inset-0 overflow-hidden">
              {/* Blurred background image */}
              {event.logoUrl && (
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${resolveAssetUrl(event.logoUrl)})`,
                    filter: 'blur(20px)',
                    transform: 'scale(1.1)',
                  }}
                />
              )}
              {/* Dark gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/70 to-black/50" />
            </div>

            {/* Content */}
            <div className="relative flex items-center justify-between p-6 sm:p-8">
              <div className="flex-1 min-w-0 pr-4">
                {event.category && (
                  <span className="inline-block bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-3 py-1 rounded-full mb-3">
                    {event.category}
                  </span>
                )}
                {event.organizationName && (
                  <p className="text-sm font-medium text-gray-300 mb-1">
                    {event.organizationId ? (
                      <Link
                        href={`/organizations/${event.organizationId}`}
                        className="hover:text-white hover:underline transition-colors"
                      >
                        {event.organizationName}
                      </Link>
                    ) : (
                      event.organizationName
                    )}
                  </p>
                )}
                <h1 className="text-2xl sm:text-4xl font-bold text-white mb-3">{event.name}</h1>

                <div className="flex items-center text-gray-200 mb-2">
                  <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span>
                    {formattedDate} at {formattedTime}
                  </span>
                </div>

                {event.venue && (
                  <div className="flex items-center text-gray-200">
                    <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <div>
                      {event.venue.isPublic ? (
                        <Link
                          href={`/venues/${event.venue.id}`}
                          className="text-white hover:underline"
                        >
                          {event.venue.name}
                        </Link>
                      ) : (
                        <span>{event.venue.name}</span>
                      )}
                      <span className="text-gray-300 text-sm block">
                        {event.venue.address}
                      </span>
                    </div>
                  </div>
                )}

                {event.description && (
                  <button
                    onClick={() => setShowDescription(true)}
                    className="flex items-center text-indigo-300 hover:text-indigo-200 font-medium mt-4 transition-colors duration-200"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>Event Information</span>
                  </button>
                )}
              </div>

              {/* Foreground event image - desktop inline */}
              {event.logoUrl && (
                <button
                  onClick={() => setShowImagePreview(true)}
                  className="hidden sm:block flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                >
                  <div className="w-40 h-40 rounded-lg overflow-hidden bg-black/40 flex items-center justify-center">
                    <img
                      src={resolveAssetUrl(event.logoUrl) || undefined}
                      alt={`${event.name}`}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </button>
              )}
            </div>

            {/* Foreground event image - mobile floating square */}
            {event.logoUrl && (
              <button
                onClick={() => setShowImagePreview(true)}
                className="sm:hidden absolute right-4 bottom-0 translate-y-1/2 z-10 cursor-pointer"
              >
                <div className="w-32 h-32 rounded-lg overflow-hidden shadow-lg border-2 border-slate-800 bg-black/40 flex items-center justify-center">
                  <img
                    src={resolveAssetUrl(event.logoUrl) || undefined}
                    alt={`${event.name}`}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              </button>
            )}
          </div>

          {/* Price tiers inside content card */}
          <div className="p-6 sm:p-8 pt-[2em] sm:pt-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-4">Tickets</h2>

            {isPastEvent ? (
              <div className="text-center py-10">
                <svg className="w-14 h-14 mx-auto mb-4 text-gray-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300 mb-2">This event has ended</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm mx-auto">
                  This event took place on {formattedDate}. Tickets are no longer available for purchase.
                </p>
              </div>
            ) : isSoldOut ? (
              <div className="text-center py-8">
                <span className="inline-block bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 px-6 py-3 rounded-full text-lg font-semibold">
                  Sold Out
                </span>
              </div>
            ) : activeTiers.length === 0 ? (
              <p className="text-gray-500 dark:text-slate-400 text-center py-4">
                No ticket tiers available
              </p>
            ) : (
              <div className="space-y-3">
                {activeTiers.map((tier) => {
                  const tierSoldOut = tier.quantityAvailable === 0;
                  // Only surface the remaining count once it's low enough to
                  // create urgency; a large number is just noise.
                  const availabilityText = tierSoldOut
                    ? 'Sold out'
                    : tier.quantityAvailable < 10
                      ? `${tier.quantityAvailable} available`
                      : null;
                  const quantity = quantities[tier.id] ?? 0;
                  const minQuantity = tier.minPerOrder ?? 1;
                  const maxQuantity = Math.min(
                    tier.quantityAvailable,
                    tier.maxPerOrder ?? 10,
                    10
                  );

                  return (
                    <div
                      key={tier.id}
                      className={`w-full p-4 rounded-lg border-2 transition-all duration-200 ${
                        quantity > 0
                          ? 'border-brand-link bg-gray-50 dark:bg-slate-900/40'
                          : tierSoldOut
                            ? 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 opacity-60 cursor-not-allowed'
                            : 'border-gray-200 dark:border-slate-700 hover:border-brand-link bg-white dark:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-stretch justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
                            {tier.name}
                            {tier.description && (
                              <button
                                type="button"
                                onClick={() => setShowTierDescription(tier)}
                                className="text-gray-400 dark:text-slate-500 hover:text-brand-link transition-colors"
                                aria-label={`${tier.name} details`}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                            )}
                          </h3>
                          {availabilityText && (
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                              {availabilityText}
                            </p>
                          )}
                          {(() => {
                            const fees = computeTierAllInPrice(tier.price, event?.taxRate ?? 0, event?.taxInclusivePricing === true);
                            return (
                              <div className="mt-1">
                                <span className="text-lg font-bold text-brand-link">
                                  {formatPrice(fees.total)}
                                </span>
                                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                                  {fees.taxInclusive ? (
                                    <>
                                      Price: {formatPrice(fees.listedPrice)}
                                      {fees.tax > 0 && <> (incl. {formatPrice(fees.tax)} tax)</>}
                                    </>
                                  ) : (
                                    <>Base: {formatPrice(fees.basePrice)}</>
                                  )}
                                  {fees.fees > 0 && <> + Fees: {formatPrice(fees.fees)}</>}
                                  {!fees.taxInclusive && fees.tax > 0 && <> + Tax: {formatPrice(fees.tax)}</>}
                                </p>
                              </div>
                            );
                          })()}
                        </div>
                        <div
                          className={`flex flex-col items-end gap-2 ${
                            tier.isRefundable ? 'justify-center' : 'justify-between'
                          }`}
                        >
                          {!tier.isRefundable && (
                            <span className="relative inline-flex items-center text-xs text-amber-600 dark:text-amber-400 font-medium group cursor-help">
                              Non-refundable
                              <svg className="w-3.5 h-3.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="invisible group-hover:visible absolute bottom-full right-0 mb-2 w-64 bg-gray-900 dark:bg-slate-700 text-white text-xs rounded-lg p-3 shadow-lg z-20 leading-relaxed">
                                <span className="font-semibold block mb-1">Non-Refundable Ticket</span>
                                This ticket is non-refundable, non-cancellable, and non-transferable after purchase. The delivery of the service is completed upon receiving this ticket by email.
                                <span className="absolute top-full right-4 border-4 border-transparent border-t-gray-900 dark:border-t-slate-700" />
                              </span>
                            </span>
                          )}
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              aria-label={`Decrease ${tier.name} quantity`}
                              onClick={() => updateQuantity(tier, -1)}
                              disabled={tierSoldOut || quantity === 0}
                              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xl font-bold leading-none text-gray-700 dark:text-slate-200 transition-colors hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30 disabled:hover:border-gray-300 dark:disabled:hover:border-slate-600"
                            >
                              −
                            </button>
                            <span
                              className="min-w-6 text-center text-lg font-semibold text-gray-900 dark:text-slate-100"
                              aria-label={`${tier.name} quantity`}
                            >
                              {quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${tier.name} quantity`}
                              onClick={() => updateQuantity(tier, 1)}
                              disabled={
                                tierSoldOut ||
                                maxQuantity < minQuantity ||
                                quantity >= maxQuantity
                              }
                              className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-fg text-xl font-bold leading-none transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add-ons (spec 012): shown once the cart holds a ticket that offers them */}
          {!isPastEvent && !isSoldOut && offered.length > 0 && (
            <div className="px-6 sm:px-8 pb-8">
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

          {/* Applications (spec 011): vendors, sponsors, press, panels */}
          <GetInvolved eventId={event.id} />
        </div>
        {/* End content card */}

        {/* Desktop sticky cart — separate column outside content card */}
      {!isPastEvent && !isSoldOut && (
        <div className="hidden lg:block lg:w-80 flex-shrink-0">
          <div className="sticky top-8">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 p-6">
              <div className="mb-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Order Summary</h3>
                  <ExpandCollapseAll
                    allOpen={allLinesOpen}
                    onToggle={toggleAllLines}
                    disabled={cartLines.length === 0}
                  />
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">Review your selection</p>
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
                    className="w-full bg-brand hover:bg-brand-hover text-brand-fg font-bold py-3 px-6 rounded-lg transition-colors duration-200 text-lg"
                  >
                    Proceed to Checkout
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Mobile floating checkout bar — slides up when tickets selected */}
      {!isPastEvent && !isSoldOut && (
        <div
          className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300 ease-out ${
            totalQuantity > 0 ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.3)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3">
              {/* Cart icon button — opens drawer */}
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

              {/* Checkout button — 75% width */}
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
        </div>
      )}

      {/* Mobile cart drawer */}
      {showMobileCart && (
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
              <p className="text-gray-700 dark:text-slate-300 text-base leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
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
              <p className="text-gray-700 dark:text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
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
