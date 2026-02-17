'use client';

// Purchase confirmation page — displays order reference, ticket details with QR codes
// Uses order lookup via POST /orders/lookup with email + orderRef
// Also supports direct order fetch via GET /orders/:orderId with session params
// Per FR-043, T083

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../services/api';

interface TicketInfo {
  id: string;
  barcode: string;
  status: string;
  pricePaid: number;
  priceTierName?: string;
  qrCodeDataUrl?: string;
}

interface OrderDetail {
  id: string;
  orderRef: string;
  status: string;
  totalAmount: number;
  quantity: number;
  createdAt: string;
  contact: {
    firstName: string;
    lastName: string;
    email: string;
  };
  event: {
    id: string;
    name: string;
    date: string;
    venue: {
      name: string;
      address: string;
    } | null;
  };
  priceTier?: {
    name: string;
    price: number;
  };
  tickets: TicketInfo[];
}

function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

export default function ConfirmationPage() {
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Support both flows:
  // 1. Redirect from Stripe success: ?orderId=xxx
  // 2. Guest lookup: ?orderRef=xxx&email=xxx
  const orderId = searchParams.get('orderId');
  const orderRef = searchParams.get('orderRef');
  const email = searchParams.get('email');

  useEffect(() => {
    if (orderId) {
      fetchOrderById(orderId);
    } else if (orderRef && email) {
      fetchOrderByLookup(email, orderRef);
    } else {
      setError(
        'No order information provided. Please check your confirmation email for the lookup link.'
      );
      setLoading(false);
    }
  }, [orderId, orderRef, email]);

  const fetchOrderById = async (id: string) => {
    try {
      setLoading(true);
      setError(null);

      // Coming from Stripe redirect — verify payment to complete the order
      let data: OrderDetail;
      try {
        data = await api.post<OrderDetail>(`/orders/${id}/verify-payment`, {});
      } catch {
        // Fallback to plain GET if verify-payment fails (e.g. already completed)
        data = await api.get<OrderDetail>(`/orders/${id}`);
      }
      setOrder(data);

      // If still PENDING, poll verify-payment a few times
      // (Stripe webhook / session retrieval may take a moment)
      if (data.status === 'PENDING') {
        let pollCount = 0;
        const MAX_POLLS = 8;
        const poll = async () => {
          if (pollCount >= MAX_POLLS) return;
          pollCount++;
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const refreshed = await api.post<OrderDetail>(`/orders/${id}/verify-payment`, {});
            setOrder(refreshed);
            if (refreshed.status === 'PENDING') {
              await poll();
            }
          } catch {
            /* stop polling on error */
          }
        };
        poll();
      }
    } catch (err: any) {
      if (err.status === 404) {
        setError(
          'Order not found. It may still be processing — please check back in a few minutes.'
        );
      } else {
        setError(err.message || 'Failed to retrieve order details');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderByLookup = async (lookupEmail: string, lookupRef: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.post<OrderDetail>('/orders/lookup', {
        email: lookupEmail,
        orderRef: lookupRef,
      });
      setOrder(data);
    } catch (err: any) {
      if (err.status === 404) {
        setError('Order not found. Please check your email and order reference.');
      } else {
        setError(err.message || 'Failed to retrieve order details');
      }
    } finally {
      setLoading(false);
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
          <p className="text-gray-600 dark:text-slate-400">Retrieving your order...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
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
            Unable to Retrieve Order
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">
            {error || 'Something went wrong'}
          </p>
          <Link
            href="/events"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const eventDate = new Date(order.event.date);
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

  const isCompleted = order.status === 'COMPLETED';
  const isPending = order.status === 'PENDING';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 p-8 mb-8">
          {/* Success / Pending Header */}
          <div className="text-center mb-8">
            {isCompleted ? (
              <>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
                  <svg
                    className="w-8 h-8 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
                  Purchase Successful!
                </h1>
                <p className="text-gray-600 dark:text-slate-400 text-lg">
                  A confirmation email has been sent to{' '}
                  <span className="font-semibold">{order.contact.email}</span>
                </p>
              </>
            ) : isPending ? (
              <>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full mb-4">
                  <svg
                    className="w-8 h-8 text-yellow-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
                  Payment Processing
                </h1>
                <p className="text-gray-600 dark:text-slate-400 text-lg">
                  Your order is being processed. Tickets will be issued once payment is confirmed.
                </p>
              </>
            ) : (
              <>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full mb-4">
                  <svg
                    className="w-8 h-8 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
                  Order {order.status.charAt(0) + order.status.slice(1).toLowerCase()}
                </h1>
                <p className="text-gray-600 dark:text-slate-400 text-lg">
                  This order was not completed. Please try again.
                </p>
              </>
            )}
          </div>

          {/* Order Reference */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 mb-6 text-center">
            <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-1">Order Reference</p>
            <p className="text-2xl font-mono font-bold text-indigo-900 dark:text-indigo-200 tracking-wider">
              {order.orderRef}
            </p>
            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
              Save this reference to look up your order later
            </p>
          </div>

          {/* Order Details */}
          <div className="border-t border-gray-200 dark:border-slate-700 pt-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Order Details
            </h2>
            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Event</span>
                  <span className="font-semibold text-gray-900 dark:text-slate-100">
                    {order.event.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Date</span>
                  <span className="text-gray-900 dark:text-slate-100">
                    {formattedDate} at {formattedTime}
                  </span>
                </div>
                {order.event.venue && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-slate-400">Venue</span>
                    <span className="text-gray-900 dark:text-slate-100">
                      {order.event.venue.name}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Tier</span>
                  <span className="text-gray-900 dark:text-slate-100">
                    {order.tickets?.[0]?.priceTierName || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Tickets</span>
                  <span className="text-gray-900 dark:text-slate-100">{order.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Customer</span>
                  <span className="text-gray-900 dark:text-slate-100">
                    {order.contact.firstName} {order.contact.lastName}
                  </span>
                </div>
                <div className="border-t border-gray-200 dark:border-slate-700 pt-3 flex justify-between">
                  <span className="text-lg font-bold text-gray-900 dark:text-slate-100">Total</span>
                  <span className="text-lg font-bold text-blue-600 dark:text-indigo-400">
                    {formatPrice(order.totalAmount)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Tickets Message */}
          {isPending && (
            <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-yellow-600 dark:text-yellow-500 mr-3 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm text-yellow-800 dark:text-yellow-200 font-semibold mb-1">
                      Tickets Pending
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300">
                      Your tickets will be issued once payment is confirmed. This usually takes just
                      a moment. Check back using your order reference:{' '}
                      <strong>{order.orderRef}</strong>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Important Info */}
          {isCompleted && (
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-slate-600 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-indigo-400 mt-0.5 mr-3"
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
                  <div className="text-blue-800 dark:text-blue-300">
                    <p className="font-semibold mb-1">Important Information:</p>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      <li>
                        A confirmation email has been sent to {order.contact.email}. If you do not
                        receive your email in the next 10 minutes, please search your spam or junk
                        folder.
                      </li>
                      <li>View your tickets by clicking the "View Tickets" button in your email</li>
                      <li>
                        Look up your order anytime with reference: <strong>{order.orderRef}</strong>
                      </li>
                      <li>Arrive at least 30 minutes before the event starts</li>
                      <li>Present your QR code at the entrance for scanning</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="text-center mt-6">
            <Link
              href="/events"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition-colors duration-200"
            >
              Browse More Events
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
