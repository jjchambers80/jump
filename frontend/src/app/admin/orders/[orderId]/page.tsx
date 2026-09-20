'use client';

// Order detail: a ticket order (items, tickets, per-ticket / per-line
// refunds) or, since spec 024, an application order (tier / add-on /
// adjustment lines, the payment's source, an amount-based refund and a panel
// linking to the application review page).

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import type { OrderAddOnLine } from '@/lib/addOns';
import { ORDER_KIND_LABEL, ORDER_STATUS_CLASS, ORDER_STATUS_LABEL, type OrderItemKind, type OrderKind, type OrderStatus } from '@/lib/orders';

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
  id?: string;
  kind: OrderItemKind;
  priceTierId: string | null;
  priceTierName: string | null;
  applicationTierId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  platformFee: number;
  processingFee: number;
  tax?: number;
  lineTotal: number;
  createdAt?: string;
}

interface OrderDetail {
  id: string;
  orderRef: string;
  kind: OrderKind;
  event: {
    id: string;
    name: string;
    date: string;
    venue?: { id: string; name: string; address: string };
  };
  contact: { firstName: string; lastName: string; email: string };
  quantity: number;
  items: OrderItem[];
  /** Add-on lines (spec 012) */
  addOns?: OrderAddOnLine[];
  subtotalAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  taxAmount: number;
  totalAmount: number;
  orgReceives?: number;
  feeMode?: 'PASS' | 'ABSORB';
  currency: string;
  status: OrderStatus;
  paidAt?: string | null;
  dueAt?: string | null;
  tickets: OrderTicket[];
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    failureReason: string | null;
    source?: 'STRIPE' | 'OFFLINE';
    offlineMethod?: string | null;
    offlineReference?: string | null;
    stripePaymentIntentId?: string | null;
    createdAt: string;
  } | null;
  /** The application behind an APPLICATION order (spec 024). */
  application?: {
    id: string;
    eventId: string;
    status: string;
    paymentStatus: string;
    capacitySlot: string;
    formName: string | null;
    formKind: string | null;
    tierName: string | null;
    businessName: string | null;
  } | null;
  createdAt: string;
}

interface RefundRecord {
  id: string;
  amount: number;
  /** Kept by the organization on a self-serve refund (spec 031). */
  feeAmount?: number;
  reason: string | null;
  status: string;
  ticket: { id: string; barcode: string; ticketNumber: number } | null;
  addOn?: { id: string; name: string | null; quantity: number } | null;
  manual?: boolean;
  createdAt: string;
}

const statusColors: Record<string, string> = ORDER_STATUS_CLASS;

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  WAITLISTED: 'Waitlisted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
const APPLICATION_PAYMENT_LABEL: Record<string, string> = {
  NOT_REQUIRED: 'Nothing owed',
  AWAITING_CARD: 'Awaiting card',
  CARD_ON_FILE: 'Card on file',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  PAYMENT_DUE: 'Payment due',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
};
const OFFLINE_METHOD_LABEL: Record<string, string> = { CHEQUE: 'Cheque', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', COMPED: 'Comped', OTHER: 'Other' };

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
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  // Refunds are ADMIN on the backend (spec 018 phase 1); organizers see the history only.
  const canRefund = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundTarget, setRefundTarget] = useState<{ type: 'order' | 'ticket' | 'addOn'; id: string; label: string } | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const fetchOrder = () => {
    if (!orderId) return;
    api
      .get<OrderDetail>(`/admin/orders/${orderId}`)
      .then((data) => setOrder(data))
      .catch((err: any) => setError(err.message || 'Failed to load order'));
  };

  const fetchRefunds = () => {
    if (!orderId) return;
    api
      .get<{ refunds: RefundRecord[] }>(`/admin/orders/${orderId}/refunds`)
      .then((data) => setRefunds(data.refunds || []))
      .catch(() => {}); // non-critical
  };

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    Promise.all([
      api.get<OrderDetail>(`/admin/orders/${orderId}`).then((data) => setOrder(data)),
      api.get<{ refunds: RefundRecord[] }>(`/admin/orders/${orderId}/refunds`).then((data) => setRefunds(data.refunds || [])).catch(() => {}),
    ])
      .catch((err: any) => setError(err.message || 'Failed to load order'))
      .finally(() => setLoading(false));
  }, [orderId]);

  const isApplication = order?.kind === 'APPLICATION';
  const refundedTotal = refunds.filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + r.amount, 0);
  const refundable = order ? Math.max(0, Math.round((order.totalAmount - refundedTotal) * 100) / 100) : 0;
  const manualRefund = order?.payment?.source === 'OFFLINE';

  const openRefundDialog = (type: 'order' | 'ticket' | 'addOn', id: string, label: string) => {
    setRefundTarget({ type, id, label });
    setRefundReason('');
    setRefundAmount(refundable.toFixed(2));
    setRefundError(null);
    setShowRefundDialog(true);
  };

  const parsedAmount = Number(refundAmount);
  const amountValid = !isApplication || (Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= refundable + 1e-9);

  const executeRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    setRefundError(null);
    try {
      const endpoint = refundTarget.type === 'order'
        ? `/admin/orders/${refundTarget.id}/refund`
        : refundTarget.type === 'addOn'
          ? `/admin/orders/${orderId}/add-ons/${refundTarget.id}/refund`
          : `/admin/tickets/${refundTarget.id}/refund`;
      // Application orders (spec 024) refund by amount; the full remainder when it equals the balance.
      const full = isApplication && Math.abs(parsedAmount - refundable) < 0.005;
      await api.post(endpoint, {
        reason: refundReason || undefined,
        ...(isApplication && !full && { amount: Math.round(parsedAmount * 100) / 100 }),
      });
      setShowRefundDialog(false);
      fetchOrder();
      fetchRefunds();
    } catch (err: any) {
      setRefundError(err.message || 'Refund failed');
    } finally {
      setRefunding(false);
    }
  };

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
              data-testid="order-detail-status"
            >
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                isApplication ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
              }`}
              data-testid="order-detail-kind"
            >
              {ORDER_KIND_LABEL[order.kind ?? 'TICKET']}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Placed {formatDate(order.createdAt)}
            {order.paidAt ? ` · Paid ${formatDate(order.paidAt)}` : ''}
            {order.dueAt && order.status === 'PENDING' ? ` · Due ${formatDate(order.dueAt)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canRefund && (order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED') && (isApplication ? refundable > 0 && order.totalAmount > 0 : true) && (
            <button
              onClick={() => openRefundDialog('order', order.id, `Order ${order.orderRef}`)}
              data-testid="order-refund-button"
              className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition"
            >
              {isApplication ? (manualRefund ? 'Record refund' : 'Refund') : 'Refund Order'}
            </button>
          )}
          <Link
            href="/admin/orders"
            className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
          >
            ← Back to Orders
          </Link>
        </div>
      </div>

      {/* Customer */}
      <Section title="Customer">
        <InfoRow
          label="Name"
          value={`${order.contact.firstName} ${order.contact.lastName}`}
        />
        <InfoRow label="Email" value={order.contact.email} />
      </Section>

      {/* Application (spec 024) */}
      {isApplication && order.application && (
        <Section title="Application">
          <div data-testid="order-application-panel">
            <InfoRow label="Business" value={order.application.businessName ?? '—'} />
            <InfoRow label="Form" value={`${order.application.formName ?? 'Application'}${order.application.tierName ? ` · ${order.application.tierName}` : ''}`} />
            <InfoRow label="Review status" value={APPLICATION_STATUS_LABEL[order.application.status] ?? order.application.status} />
            <InfoRow label="Payment" value={APPLICATION_PAYMENT_LABEL[order.application.paymentStatus] ?? order.application.paymentStatus} />
            <div className="pt-2">
              <Link
                href={`/admin/events/${order.application.eventId}/applications/${order.application.id}`}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                data-testid="order-open-application"
              >
                Open application →
              </Link>
            </div>
          </div>
        </Section>
      )}

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
              <tr key={item.id ?? idx} className="text-gray-900 dark:text-slate-100" data-testid="order-item" data-kind={item.kind}>
                <td className="py-2">
                  {(item.kind === 'ADJUSTMENT' || item.kind === 'WAIVER') && (
                    <span className="text-xs uppercase tracking-wider text-gray-400 dark:text-slate-500 mr-2">{item.kind === 'WAIVER' ? 'Waived' : 'Adjustment'}</span>
                  )}
                  {item.kind === 'ADJUSTMENT' || item.kind === 'WAIVER' ? item.description : item.priceTierName ?? item.description}
                </td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatCurrency(item.kind === 'ADJUSTMENT' || item.kind === 'WAIVER' ? item.unitPrice * item.quantity : item.lineTotal)}</td>
              </tr>
            ))}
            {(order.addOns || []).map((line) => (
              <tr key={line.id} className="text-gray-900 dark:text-slate-100" data-testid="order-add-on-line">
                <td className="py-2">
                  <span className="text-xs uppercase tracking-wider text-gray-400 dark:text-slate-500 mr-2">Add-on</span>
                  {line.name ?? 'Add-on'}
                  {line.refundedAt && (
                    <span className="ml-2 text-xs font-medium text-purple-700 dark:text-purple-300">Refunded</span>
                  )}
                </td>
                <td className="py-2 text-right">{line.quantity}</td>
                <td className="py-2 text-right">{formatCurrency(line.unitPrice)}</td>
                <td className="py-2 text-right">
                  <span className={line.refundedAt ? 'line-through text-gray-400' : ''}>{formatCurrency(line.lineTotal)}</span>
                  {canRefund && !isApplication && !line.refundedAt && (order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED') && (
                    <button
                      onClick={() => openRefundDialog('addOn', line.id, `${line.quantity} × ${line.name ?? 'Add-on'}`)}
                      className="ml-3 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                    >
                      Refund
                    </button>
                  )}
                </td>
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
        {isApplication && order.orgReceives !== undefined && (
          <InfoRow label="You receive" value={formatCurrency(order.orgReceives)} />
        )}
        {refundedTotal > 0 && <InfoRow label="Refunded" value={formatCurrency(refundedTotal)} />}
        {order.payment && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700" data-testid="order-payment">
            {order.payment.source === 'OFFLINE' && (
              <InfoRow
                label="Paid by"
                value={`${OFFLINE_METHOD_LABEL[order.payment.offlineMethod ?? ''] ?? 'Offline'}${order.payment.offlineReference ? ` ${order.payment.offlineReference}` : ''} (offline)`}
              />
            )}
            {order.payment.stripePaymentIntentId && (
              <InfoRow label="Stripe payment" value={<span className="font-mono text-xs">{order.payment.stripePaymentIntentId}</span>} />
            )}
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
                <div className="flex items-center gap-2">
                  {canRefund && (ticket.status === 'VALID' || ticket.status === 'REDEEMED') && (
                    <button
                      onClick={() => openRefundDialog('ticket', ticket.id, `Ticket ${ticket.barcode}`)}
                      className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                    >
                      Refund
                    </button>
                  )}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      ticketStatusColors[ticket.status] || ''
                    }`}
                  >
                    {ticket.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Refund History */}
      {refunds.length > 0 && (
        <Section title={`Refunds (${refunds.length})`}>
          <div className="space-y-2">
            {refunds.map((refund) => (
              <div
                key={refund.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0"
              >
                <div>
                  <p className="text-sm text-gray-900 dark:text-white">
                    {formatCurrency(refund.amount)}
                    {refund.ticket && (
                      <span className="text-gray-500 dark:text-slate-400 ml-2">
                        Ticket #{refund.ticket.ticketNumber}
                      </span>
                    )}
                    {refund.addOn && (
                      <span className="text-gray-500 dark:text-slate-400 ml-2">
                        {refund.addOn.quantity} × {refund.addOn.name ?? 'Add-on'}
                      </span>
                    )}
                    {refund.manual && <span className="text-gray-500 dark:text-slate-400 ml-2">recorded outside Stripe</span>}
                    {(refund.feeAmount ?? 0) > 0 && (
                      <span className="text-gray-500 dark:text-slate-400 ml-2">· {formatCurrency(refund.feeAmount!)} fee retained</span>
                    )}
                  </p>
                  {refund.reason && (
                    <p className="text-xs text-gray-500 dark:text-slate-400">{refund.reason}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    {formatDate(refund.createdAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    refund.status === 'SUCCEEDED'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : refund.status === 'FAILED'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                >
                  {refund.status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Refund Confirmation Dialog */}
      {showRefundDialog && refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {isApplication ? (manualRefund ? 'Record refund' : 'Refund application') : 'Confirm Refund'}
            </h3>
            {isApplication ? (
              <>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                  <strong>{order.application?.businessName ?? refundTarget.label}</strong> paid {formatCurrency(order.totalAmount)}
                  {refundedTotal > 0 ? `; ${formatCurrency(refundedTotal)} already refunded` : ''}. Up to {formatCurrency(refundable)} can be{' '}
                  {manualRefund ? 'recorded as refunded' : 'returned to their card'}. The review status is not changed.
                </p>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1" htmlFor="order-refund-amount">
                    Amount
                  </label>
                  <input
                    id="order-refund-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max={refundable}
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    {manualRefund ? 'No Stripe charge — the refund is recorded here and you return the money yourself.' : 'Stripe returns the money to the original card in 5–10 business days.'}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                This will refund <strong>{refundTarget.label}</strong> and void associated tickets.
                This action cannot be undone.
              </p>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Reason (optional)
              </label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Customer requested cancellation"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
            {refundError && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">{refundError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRefundDialog(false)}
                disabled={refunding}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={executeRefund}
                disabled={refunding || !amountValid}
                data-testid="order-refund-confirm"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
              >
                {refunding ? 'Processing...' : isApplication ? `${manualRefund ? 'Record' : 'Refund'} ${amountValid ? formatCurrency(parsedAmount) : ''}` : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
