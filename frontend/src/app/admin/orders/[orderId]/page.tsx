'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import api from '@/services/api';

interface OrderTicket {
  id: string;
  barcode: string;
  priceTierName: string;
  pricePaid: number;
  status: string;
  redeemedAt: string | null;
  createdAt: string;
}

interface OrderItem {
  priceTierId: string;
  priceTierName: string;
  quantity: number;
  unitPrice: number;
  platformFee: number;
  processingFee: number;
  lineTotal: number;
}

interface OrderDetail {
  id: string;
  orderRef: string;
  event: {
    id: string;
    name: string;
    date: string;
    venue?: { id: string; name: string; address: string };
  };
  contact: { firstName: string; lastName: string; email: string };
  quantity: number;
  items: OrderItem[];
  subtotalAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  status: string;
  tickets: OrderTicket[];
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    failureReason: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const ticketStatusColors: Record<string, string> = {
  VALID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  REDEEMED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  EXPIRED: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300',
  VOIDED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const paymentStatusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  SUCCEEDED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium">{value}</span>
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    api
      .get<OrderDetail>(`/admin/orders/${orderId}`)
      .then((data) => setOrder(data))
      .catch((err: any) => setError(err.message || 'Failed to load order'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse h-32 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error || 'Order not found'}</p>
        </div>
        <Link
          href="/admin/orders"
          className="mt-4 inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono text-gray-900 dark:text-white">
              {order.orderRef}
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                statusColors[order.status] || ''
              }`}
            >
              {order.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Placed {formatDate(order.createdAt)}
          </p>
        </div>
        <Link
          href="/admin/orders"
          className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back to Orders
        </Link>
      </div>

      {/* Customer */}
      <Section title="Customer">
        <InfoRow
          label="Name"
          value={`${order.contact.firstName} ${order.contact.lastName}`}
        />
        <InfoRow label="Email" value={order.contact.email} />
      </Section>

      {/* Event */}
      <Section title="Event">
        <InfoRow label="Event" value={order.event.name} />
        <InfoRow label="Date" value={formatDate(order.event.date)} />
        {order.event.venue && (
          <>
            <InfoRow label="Venue" value={order.event.venue.name} />
            <InfoRow label="Address" value={order.event.venue.address} />
          </>
        )}
      </Section>

      {/* Line Items */}
      <Section title="Line Items">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
              <th className="pb-2">Tier</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Unit Price</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {order.items.map((item, idx) => (
              <tr key={idx} className="text-gray-900 dark:text-slate-100">
                <td className="py-2">{item.priceTierName}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Totals */}
      <Section title="Payment Summary">
        <InfoRow label="Subtotal" value={formatCurrency(order.subtotalAmount)} />
        <InfoRow label="Platform Fee" value={formatCurrency(order.platformFeeAmount)} />
        <InfoRow label="Processing Fee" value={formatCurrency(order.processingFeeAmount)} />
        {order.taxAmount > 0 && (
          <InfoRow label="Tax" value={formatCurrency(order.taxAmount)} />
        )}
        <div className="border-t border-gray-200 dark:border-slate-700 mt-2 pt-2">
          <InfoRow
            label="Total"
            value={
              <span className="text-base font-bold">
                {formatCurrency(order.totalAmount)}
              </span>
            }
          />
        </div>
        {order.payment && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">
            <div className="flex justify-between items-center py-1.5 text-sm">
              <span className="text-gray-500 dark:text-slate-400">Payment Status</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  paymentStatusColors[order.payment.status] || ''
                }`}
              >
                {order.payment.status}
              </span>
            </div>
            {order.payment.failureReason && (
              <InfoRow label="Failure Reason" value={order.payment.failureReason} />
            )}
          </div>
        )}
      </Section>

      {/* Tickets */}
      {order.tickets.length > 0 && (
        <Section title={`Tickets (${order.tickets.length})`}>
          <div className="space-y-2">
            {order.tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0"
              >
                <div>
                  <p className="text-sm font-mono text-gray-900 dark:text-white">
                    {ticket.barcode}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {ticket.priceTierName} &middot; {formatCurrency(ticket.pricePaid)}
                  </p>
                  {ticket.redeemedAt && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Redeemed {formatDate(ticket.redeemedAt)}
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    ticketStatusColors[ticket.status] || ''
                  }`}
                >
                  {ticket.status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
