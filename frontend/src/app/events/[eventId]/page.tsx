'use client';

// Event detail page — displays event info with price tiers per FR-041
// Uses new schema: venue object, priceTiers array, computed quantityAvailable

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../services/api';
import { resolveAssetUrl } from '../../../lib/assets';

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
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  createdAt: string;
  updatedAt: string;
}

function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

// Fee computation mirroring backend FeeService (FTC all-in pricing)
const FEE_CONFIG = {
  platformFeePercent: 0.05,
  stripeFeePercent: 0.029,
  stripeFeeFixed: 0.30,
};

function computeTierAllInPrice(basePrice: number, taxRate: number = 0) {
  const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const platformFee = round(basePrice * FEE_CONFIG.platformFeePercent);
  const processingFee = round(
    (basePrice + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed
  );
  const tax = round(basePrice * taxRate);
  const total = round(basePrice + platformFee + processingFee + tax);
  return { basePrice, platformFee, processingFee, tax, total };
}

export default function EventDetailPage({ params }: { params: { eventId: string } }) {
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    fetchEventDetails();
  }, [params.eventId]);

  const fetchEventDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await api.get<Event>(`/events/${params.eventId}`);
      setEvent(data);
    } catch (err: any) {
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

  const handleProceedToCheckout = () => {
    if (cartItems.length > 0) {
      const search = new URLSearchParams({ items: JSON.stringify(cartItems) });
      router.push(`/checkout/${params.eventId}?${search.toString()}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 text-blue-600 dark:text-indigo-400 mx-auto mb-4"
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
          <button
            onClick={() => router.push('/events')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
          >
            Back to Events
          </button>
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

  const activeTiers = event.priceTiers.filter((t) => t.isActive);
  const cartItems = activeTiers
    .map((tier) => ({ priceTierId: tier.id, quantity: quantities[tier.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  // Compute all-in total with fees
  const cartFeeItems = activeTiers
    .filter((tier) => (quantities[tier.id] ?? 0) > 0)
    .map((tier) => ({ price: tier.price, quantity: quantities[tier.id] ?? 0 }));
  const cartSubtotal = cartFeeItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartFees = cartSubtotal > 0 ? computeTierAllInPrice(cartSubtotal) : { total: 0 };
  const totalAmount = cartFees.total;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <button
          onClick={() => router.push('/events')}
          className="mb-6 text-blue-600 dark:text-indigo-400 hover:text-blue-800 dark:hover:text-indigo-300 font-semibold flex items-center transition-colors duration-200"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Events
        </button>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 overflow-hidden">
          <div className="p-8">
            {event.logoUrl && (
              <div className="mb-4">
                <img
                  src={resolveAssetUrl(event.logoUrl) || undefined}
                  alt={`${event.name} logo`}
                  className="h-16 w-auto object-contain"
                />
              </div>
            )}
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-slate-100">{event.name}</h1>
              {event.category && (
                <span className="inline-block bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 text-sm font-medium px-3 py-1 rounded-full">
                  {event.category}
                </span>
              )}
            </div>

            <div className="flex items-center text-gray-600 dark:text-slate-400 mb-2">
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="text-lg">
                {formattedDate} at {formattedTime}
              </span>
            </div>

            {event.venue && (
              <div className="flex items-center text-gray-600 dark:text-slate-400 mb-6">
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      className="text-lg text-blue-600 dark:text-indigo-400 hover:underline"
                    >
                      {event.venue.name}
                    </Link>
                  ) : (
                    <span className="text-lg">{event.venue.name}</span>
                  )}
                  <span className="text-sm text-gray-500 dark:text-slate-500 block">
                    {event.venue.address}
                  </span>
                </div>
              </div>
            )}

            {event.description && (
              <button
                onClick={() => setShowDescription(true)}
                className="flex items-center text-blue-600 dark:text-indigo-400 hover:text-blue-800 dark:hover:text-indigo-300 font-medium mb-6 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-lg">Event Information</span>
              </button>
            )}

            {/* Price Tiers Section */}
            <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-4">Tickets</h2>

              {isSoldOut ? (
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
                <div className="space-y-3 mb-6">
                  {activeTiers.map((tier) => {
                    const tierSoldOut = tier.quantityAvailable === 0;
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
                            ? 'border-blue-600 dark:border-indigo-400 bg-blue-50 dark:bg-indigo-900/20'
                            : tierSoldOut
                              ? 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 opacity-60 cursor-not-allowed'
                              : 'border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-indigo-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-slate-100">
                              {tier.name}
                            </h3>
                            {tier.description && (
                              <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{tier.description}</p>
                            )}
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                              {tierSoldOut ? 'Sold out' : `${tier.quantityAvailable} available`}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              {(() => {
                                const fees = computeTierAllInPrice(tier.price, event?.taxRate ?? 0);
                                return (
                                  <>
                                    <span className="text-2xl font-bold text-blue-600 dark:text-indigo-400">
                                      {formatPrice(fees.total)}
                                    </span>
                                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 max-w-[200px]">
                                      Includes Base Price: {formatPrice(fees.basePrice)}
                                      {fees.processingFee > 0 && <>, Processing: {formatPrice(fees.processingFee)}</>}
                                      {fees.tax > 0 && <>, Tax: {formatPrice(fees.tax)}</>}
                                    </p>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="flex items-center rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                              <button
                                type="button"
                                aria-label={`Decrease ${tier.name} quantity`}
                                onClick={() => updateQuantity(tier, -1)}
                                disabled={tierSoldOut || quantity === 0}
                                className="h-10 w-10 text-xl font-bold text-gray-700 dark:text-slate-200 disabled:opacity-30"
                              >
                                −
                              </button>
                              <span
                                className="w-10 text-center font-semibold text-gray-900 dark:text-slate-100"
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
                                className="h-10 w-10 text-xl font-bold text-gray-700 dark:text-slate-200 disabled:opacity-30"
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

              {/* Cart total & checkout */}
              {!isSoldOut && (
                <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-gray-700 dark:text-slate-300 font-semibold">
                      Total ({totalQuantity} {totalQuantity === 1 ? 'ticket' : 'tickets'}):
                    </span>
                    <span className="text-3xl font-bold text-gray-900 dark:text-slate-100">
                      {formatPrice(totalAmount)}
                    </span>
                  </div>

                  <button
                    onClick={handleProceedToCheckout}
                    disabled={cartItems.length === 0}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors duration-200 text-lg"
                  >
                    Proceed to Checkout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Event Information Dialog */}
      {showDescription && event?.description && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowDescription(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto"
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
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
    </div>
  );
}
