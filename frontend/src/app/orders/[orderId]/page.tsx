// Order Detail page — shows individual tickets with QR codes and statuses (T103)
// Displays event info, order summary, and per-ticket details
// Per FR-043: show ticket QR codes for upcoming events, statuses for all

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '../../../components/ProtectedRoute';
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

function orderStatusBadge(status: string) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300'}`}
    >
      {status}
    </span>
  );
}

function TicketCard({
  ticket,
  showQr,
  index,
}: {
  ticket: OrderTicket;
  showQr: boolean;
  index: number;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        ticket.status === 'EXPIRED' || ticket.status === 'VOIDED'
          ? 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 opacity-75'
          : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Ticket #{index + 1}
          </h4>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {ticket.priceTierName} — {formatCurrency(ticket.pricePaid)}
          </p>
        </div>
        {ticketStatusBadge(ticket.status)}
      </div>

      {/* QR Code — only for VALID tickets at upcoming events */}
      {showQr && ticket.status === 'VALID' && ticket.qrCodeDataUrl && (
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

      {/* Ticket details */}
      <div className="space-y-1 text-xs text-gray-500 dark:text-slate-400">
        <div className="flex items-center justify-between">
          <span>Barcode</span>
          <span className="font-mono text-gray-700 dark:text-slate-300">{ticket.barcode}</span>
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
  );
}

export default function OrderDetailPage() {
  return (
    <ProtectedRoute>
      <OrderDetailContent />
    </ProtectedRoute>
  );
}

function OrderDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = params.orderId as string;
  const isSuccessRedirect = searchParams.get('status') === 'success';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    const MAX_POLLS = 10;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let data: OrderDetail;

        if (isSuccessRedirect) {
          // Coming back from Stripe — verify payment and complete the order
          data = await api.post<OrderDetail>(`/orders/${orderId}/verify-payment`, {});
        } else {
          data = await api.get<OrderDetail>(`/orders/${orderId}`);
        }

        setOrder(data);

        // If still PENDING after Stripe redirect, poll a few times
        // (Stripe session retrieval may take a moment)
        if (isSuccessRedirect && data.status === 'PENDING' && pollCount < MAX_POLLS) {
          pollCount++;
          pollTimer = setTimeout(async () => {
            try {
              const refreshed = await api.post<OrderDetail>(
                `/orders/${orderId}/verify-payment`,
                {}
              );
              setOrder(refreshed);
              if (refreshed.status === 'PENDING' && pollCount < MAX_POLLS) {
                pollCount++;
                pollTimer = setTimeout(arguments.callee as any, 2000);
              }
            } catch {
              /* stop polling on error */
            }
          }, 2000);
        }
      } catch (err: any) {
        if (err.status === 403) {
          setError('You do not have access to this order.');
        } else if (err.status === 404) {
          setError('Order not found.');
        } else {
          setError(err.message || 'Failed to load order');
        }
      } finally {
        setLoading(false);
      }
    }
    load();

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [orderId, isSuccessRedirect]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 transition-colors">
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="text-4xl mb-4">😕</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-2">
            {error || 'Order not found'}
          </h2>
          <Link
            href="/orders"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Back to My Orders
          </Link>
        </div>
      </div>
    );
  }

  const eventUpcoming = isUpcoming(order.event.date);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link
          href="/orders"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mb-6 inline-block"
        >
          ← Back to My Orders
        </Link>

        {/* Order header */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                {order.event.name}
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                {formatDate(order.event.date)} at {formatTime(order.event.date)}
              </p>
              {order.event.venue && (
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  📍 {order.event.venue.name}
                  {order.event.venue.address ? ` — ${order.event.venue.address}` : ''}
                </p>
              )}
            </div>
            {orderStatusBadge(order.status)}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-100 dark:border-slate-700">
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
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Ordered</p>
              <p className="text-sm text-gray-900 dark:text-slate-100">
                {formatDate(order.createdAt)}
              </p>
            </div>
          </div>
        </div>

        {/* Tickets */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Tickets</h2>

          {!eventUpcoming && (
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
              This event has passed. QR codes are no longer displayed.
            </p>
          )}

          <div className="space-y-3">
            {order.tickets.map((ticket, i) => (
              <TicketCard key={ticket.id} ticket={ticket} showQr={eventUpcoming} index={i} />
            ))}
          </div>
        </div>

        {/* Payment info */}
        {order.payment && (
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">
              Payment
            </h3>
            <div className="space-y-1 text-sm text-gray-500 dark:text-slate-400">
              <div className="flex justify-between">
                <span>Amount</span>
                <span className="text-gray-900 dark:text-slate-100">
                  {formatCurrency(order.payment.amount, order.payment.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span className="text-gray-900 dark:text-slate-100 capitalize">
                  {order.payment.status.toLowerCase()}
                </span>
              </div>
              {order.payment.failureReason && (
                <div className="flex justify-between">
                  <span>Failure Reason</span>
                  <span className="text-red-600 dark:text-red-400">
                    {order.payment.failureReason}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
