'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../services/api';
import { PaymentForm } from '../../../components/PaymentForm';

interface Event {
  id: string;
  name: string;
  venue: string;
  date: string;
  ticketPrice: string;
}

interface EventResponse {
  event: Event;
}

interface CheckoutPageProps {
  params: { eventId: string };
  searchParams: { quantity?: string };
}

export default function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const quantity = parseInt(searchParams.quantity || '1', 10);

  useEffect(() => {
    fetchEventDetails();
  }, [params.eventId]);

  const fetchEventDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get<EventResponse>(`/events/${params.eventId}`);
      setEvent(response.event);
    } catch (err: any) {
      setError(err.message || 'Failed to load event details');
      console.error('Error fetching event:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: { email: string }) => {
    if (!event) return;

    try {
      setProcessing(true);
      setError(null);

      const response = await api.post<{ checkoutUrl: string }>('/tickets/purchase', {
        eventId: params.eventId,
        quantity,
        email: data.email,
      });

      // Redirect to Stripe checkout
      window.location.href = response.checkoutUrl;
    } catch (err: any) {
      setError(err.message || 'Failed to process checkout');
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
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-600 dark:text-slate-400">Loading checkout...</p>
        </div>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
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
          <p className="text-gray-600 dark:text-slate-400 mb-6">{error}</p>
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

  if (!event) {
    return null;
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

  const ticketPriceNum = parseFloat(event.ticketPrice);
  const total = (ticketPriceNum * quantity) / 100;

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
              <p className="text-gray-600 dark:text-slate-400 mb-4">
                <span className="font-semibold">Venue:</span> {event.venue}
              </p>

              <div className="border-t border-gray-200 dark:border-slate-700 pt-4 space-y-2">
                <div className="flex justify-between text-gray-700 dark:text-slate-300">
                  <span>Ticket Price:</span>
                  <span>${(ticketPriceNum / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700 dark:text-slate-300">
                  <span>Quantity:</span>
                  <span>{quantity}</span>
                </div>
                <div className="flex justify-between text-xl font-bold text-gray-900 dark:text-slate-100 pt-2 border-t border-gray-200 dark:border-slate-700">
                  <span>Total:</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-red-600 mt-0.5 mr-3"
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

          <PaymentForm
            event={{ id: event.id, name: event.name, ticketPrice: ticketPriceNum }}
            quantity={quantity}
            onSubmit={handleSubmit}
            isLoading={processing}
          />
        </div>
      </div>
    </div>
  );
}
