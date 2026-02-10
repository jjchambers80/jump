// Guest Order Lookup page (T104)
// Email + orderRef form for guests to retrieve their order and ticket QR codes
// Per FR-047: generic "order not found" on miss (no enumeration)

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import api, { OrderDetail, OrderTicket } from '@/services/api';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amountCents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function isUpcoming(dateStr: string): boolean {
  return new Date(dateStr).getTime() > Date.now();
}

function ticketStatusBadge(status: string) {
  const config: Record<string, { color: string; label: string }> = {
    VALID: {
      color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      label: 'Valid',
    },
    REDEEMED: {
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      label: 'Redeemed',
    },
    EXPIRED: {
      color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
      label: 'Expired',
    },
    VOIDED: {
      color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      label: 'Voided',
    },
  };
  const c = config[status] || {
    color: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300',
    label: status,
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}

export default function OrderLookupPage() {
  const [email, setEmail] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !orderRef.trim()) return;

    setLoading(true);
    setError(null);
    setOrder(null);

    try {
      const data = await api.post<OrderDetail>('/orders/lookup', {
        email: email.trim().toLowerCase(),
        orderRef: orderRef.trim().toUpperCase(),
      });
      setOrder(data);
    } catch (err: any) {
      if (err.status === 404 || err.status === 400) {
        // Generic message — no enumeration per FR-047
        setError('Order not found. Please check your email and order reference.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setOrder(null);
    setError(null);
    setEmail('');
    setOrderRef('');
  }

  const eventUpcoming = order ? isUpcoming(order.event.date) : false;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">
          Look Up Your Order
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">
          Enter your email address and order reference to view your tickets. You can find your order
          reference in your confirmation email.
        </p>

        {/* Lookup form */}
        {!order && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="orderRef"
                className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
              >
                Order Reference
              </label>
              <input
                id="orderRef"
                type="text"
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value.toUpperCase())}
                placeholder="e.g. ABC12345"
                required
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition text-sm font-mono uppercase"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !orderRef.trim()}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Looking up…
                </span>
              ) : (
                'Find My Order'
              )}
            </button>
          </form>
        )}

        {/* Order result */}
        {order && (
          <div>
            {/* Back to lookup */}
            <button
              onClick={handleReset}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mb-6 inline-block"
            >
              ← Look up another order
            </button>

            {/* Order header */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-1">
                {order.event.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {formatDate(order.event.date)} at {formatTime(order.event.date)}
              </p>
              {order.event.venue && (
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  📍 {order.event.venue.name}
                  {order.event.venue.address ? ` — ${order.event.venue.address}` : ''}
                </p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 mt-4 border-t border-gray-100 dark:border-slate-700">
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Order Ref</p>
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-slate-100">
                    {order.orderRef}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Tickets</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                    {order.quantity}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Total</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                    {formatCurrency(order.totalAmount, order.currency)}
                  </p>
                </div>
              </div>
            </div>

            {/* Tickets */}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
              Your Tickets
            </h3>

            {!eventUpcoming && (
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
                This event has passed. QR codes are no longer displayed.
              </p>
            )}

            <div className="space-y-3">
              {order.tickets.map((ticket, i) => (
                <div
                  key={ticket.id}
                  className={`rounded-lg border p-4 ${
                    ticket.status === 'EXPIRED' || ticket.status === 'VOIDED'
                      ? 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 opacity-75'
                      : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                        Ticket #{i + 1}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {ticket.priceTierName} — {formatCurrency(ticket.pricePaid)}
                      </p>
                    </div>
                    {ticketStatusBadge(ticket.status)}
                  </div>

                  {/* QR Code for VALID tickets at upcoming events */}
                  {eventUpcoming && ticket.status === 'VALID' && ticket.qrCodeDataUrl && (
                    <div className="flex justify-center my-4">
                      <div className="p-3 bg-white rounded-lg shadow-sm">
                        <img
                          src={ticket.qrCodeDataUrl}
                          alt={`QR code for ticket ${ticket.barcode}`}
                          className="w-40 h-40"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 text-xs text-gray-500 dark:text-slate-400">
                    <div className="flex items-center justify-between">
                      <span>Barcode</span>
                      <span className="font-mono text-gray-700 dark:text-slate-300">
                        {ticket.barcode}
                      </span>
                    </div>
                    {ticket.redeemedAt && (
                      <div className="flex items-center justify-between">
                        <span>Redeemed</span>
                        <span>
                          {formatDate(ticket.redeemedAt)} {formatTime(ticket.redeemedAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sign in prompt */}
        {!order && (
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Have an account?{' '}
              <Link
                href="/auth/signin"
                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
              >
                Sign in
              </Link>{' '}
              to see all your orders.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
