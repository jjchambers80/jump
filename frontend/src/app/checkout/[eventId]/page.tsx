'use client';

// Guest checkout page — collects contact info (name + email) and initiates order
// Uses new order-based flow: POST /orders with contact, eventId, priceTierId, quantity
// Returns stripeCheckoutUrl for redirect per FR-042, contracts/api.yaml

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../services/api';

interface EventVenue {
  id: string;
  name: string;
  address: string;
}

interface PriceTier {
  id: string;
  name: string;
  price: number;
  quantityAvailable: number;
  isActive: boolean;
}

interface Event {
  id: string;
  name: string;
  description?: string;
  date: string;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
}

interface CreateOrderResponse {
  orderId: string;
  orderRef: string;
  stripeCheckoutUrl: string;
  totalAmount: number;
}

function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

export default function CheckoutPage({ params }: { params: { eventId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // Contact form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Get tier and quantity from URL params (set by event detail page)
  const tierId = searchParams.get('tierId');
  const quantity = parseInt(searchParams.get('quantity') || '1', 10);

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
    } finally {
      setLoading(false);
    }
  };

  const selectedTier = event?.priceTiers?.find((t) => t.id === tierId) ?? null;

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) {
      errors.firstName = 'First name is required';
    }
    if (!lastName.trim()) {
      errors.lastName = 'Last name is required';
    }
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !selectedTier) return;

    try {
      setProcessing(true);
      setError(null);

      const response = await api.post<CreateOrderResponse>('/orders', {
        eventId: params.eventId,
        priceTierId: tierId,
        quantity,
        contact: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
        },
      });

      // Redirect to Stripe Checkout
      window.location.href = response.stripeCheckoutUrl;
    } catch (err: any) {
      if (err.status === 409) {
        setError('Sorry, these tickets are no longer available. Please go back and try again.');
      } else {
        setError(err.message || 'Failed to process checkout. Please try again.');
      }
      setProcessing(false);
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
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-gray-600 dark:text-slate-400">Loading checkout...</p>
        </div>
      </div>
    );
  }

  if ((error && !event) || !event) {
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Error</h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">{error || 'Event not found'}</p>
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

  if (!selectedTier) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            No Ticket Tier Selected
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">
            Please go back and select a ticket tier.
          </p>
          <button
            onClick={() => router.push(`/events/${params.eventId}`)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
          >
            Back to Event
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

  const totalAmount = selectedTier.price * quantity;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <button
          onClick={() => router.push(`/events/${params.eventId}`)}
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
          Back to Event Details
        </button>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">Checkout</h1>

          {/* Order Summary */}
          <div className="mb-8 pb-8 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Order Summary
            </h2>

            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-6">
              <h3 className="font-bold text-lg text-gray-900 dark:text-slate-100 mb-2">
                {event.name}
              </h3>
              <p className="text-gray-600 dark:text-slate-400 mb-1">
                <span className="font-semibold">Date:</span> {formattedDate} at {formattedTime}
              </p>
              {event.venue && (
                <p className="text-gray-600 dark:text-slate-400 mb-4">
                  <span className="font-semibold">Venue:</span> {event.venue.name}
                </p>
              )}

              <div className="border-t border-gray-200 dark:border-slate-700 pt-4 space-y-2">
                <div className="flex justify-between text-gray-700 dark:text-slate-300">
                  <span>Tier:</span>
                  <span className="font-semibold">{selectedTier.name}</span>
                </div>
                <div className="flex justify-between text-gray-700 dark:text-slate-300">
                  <span>Price per ticket:</span>
                  <span>{formatPrice(selectedTier.price)}</span>
                </div>
                <div className="flex justify-between text-gray-700 dark:text-slate-300">
                  <span>Quantity:</span>
                  <span>{quantity}</span>
                </div>
                <div className="flex justify-between text-xl font-bold text-gray-900 dark:text-slate-100 pt-2 border-t border-gray-200 dark:border-slate-700">
                  <span>Total:</span>
                  <span>{formatPrice(totalAmount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 mr-3 flex-shrink-0"
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
                <p className="text-red-800 dark:text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Guest Contact Form */}
          <form onSubmit={handleSubmit}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Your Details
            </h2>
            <p className="text-gray-600 dark:text-slate-400 mb-6 text-sm">
              No account required — just enter your details to purchase tickets.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* First Name */}
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2"
                >
                  First Name
                </label>
                <input
                  type="text"
                  id="firstName"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    if (formErrors.firstName) setFormErrors((prev) => ({ ...prev, firstName: '' }));
                  }}
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 ${
                    formErrors.firstName
                      ? 'border-red-500'
                      : 'border-gray-300 dark:border-slate-600'
                  }`}
                  placeholder="John"
                  disabled={processing}
                />
                {formErrors.firstName && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {formErrors.firstName}
                  </p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label
                  htmlFor="lastName"
                  className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2"
                >
                  Last Name
                </label>
                <input
                  type="text"
                  id="lastName"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    if (formErrors.lastName) setFormErrors((prev) => ({ ...prev, lastName: '' }));
                  }}
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 ${
                    formErrors.lastName ? 'border-red-500' : 'border-gray-300 dark:border-slate-600'
                  }`}
                  placeholder="Doe"
                  disabled={processing}
                />
                {formErrors.lastName && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {formErrors.lastName}
                  </p>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="mb-6">
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2"
              >
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (formErrors.email) setFormErrors((prev) => ({ ...prev, email: '' }));
                }}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-500 ${
                  formErrors.email ? 'border-red-500' : 'border-gray-300 dark:border-slate-600'
                }`}
                placeholder="your.email@example.com"
                disabled={processing}
              />
              {formErrors.email && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{formErrors.email}</p>
              )}
              <p className="mt-2 text-sm text-gray-500 dark:text-slate-500">
                Your tickets and order confirmation will be sent to this email address.
              </p>
            </div>

            {/* Payment Notice */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-blue-600 dark:text-indigo-400 mr-2 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm text-blue-800 dark:text-blue-300 font-semibold mb-1">
                    Secure Payment
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    You will be redirected to Stripe for secure payment processing. Your payment
                    information is never stored on our servers.
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={processing}
              className={`w-full py-3 px-6 rounded-lg font-bold text-white transition-colors duration-200 text-lg ${
                processing
                  ? 'bg-gray-400 dark:bg-slate-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 dark:bg-indigo-600 dark:hover:bg-indigo-700'
              }`}
            >
              {processing ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Processing...
                </span>
              ) : (
                `Proceed to Payment — ${formatPrice(totalAmount)}`
              )}
            </button>

            {/* Terms */}
            <p className="mt-4 text-xs text-gray-500 dark:text-slate-500 text-center">
              By completing this purchase, you agree to our{' '}
              <a href="/terms" className="text-blue-600 dark:text-indigo-400 hover:underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-blue-600 dark:text-indigo-400 hover:underline">
                Privacy Policy
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
