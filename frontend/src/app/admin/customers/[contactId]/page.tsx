'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';

interface OrderEvent {
  id: string;
  name: string;
  date: string;
  logoUrl: string | null;
}

interface CustomerOrder {
  id: string;
  orderRef: string;
  totalAmount: number;
  quantity: number;
  status: string;
  createdAt: string;
  ticketCount: number;
  event: OrderEvent;
}

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  location: string | null;
  note: string | null;
  emailSubscribed: boolean;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
  lastOrderDate: string | null;
  orders: CustomerOrder[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    REFUNDED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.PENDING}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export default function CustomerDetailPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const { selectedOrgId } = useOrg();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [editingField, setEditingField] = useState<'note' | 'location' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchCustomer = useCallback(async () => {
    if (!selectedOrgId || !contactId) return;
    try {
      setLoading(true);
      setError(null);
      const result = await api.get<CustomerDetail>(`/admin/customers/${contactId}`);
      setCustomer(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, contactId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const startEdit = (field: 'note' | 'location') => {
    if (!customer) return;
    setEditingField(field);
    setEditValue(field === 'note' ? (customer.note || '') : (customer.location || ''));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!customer || !editingField) return;
    try {
      setSaving(true);
      await api.patch(`/admin/customers/${customer.id}`, { [editingField]: editValue || null });
      setCustomer({ ...customer, [editingField]: editValue || null });
      cancelEdit();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleSubscription = async () => {
    if (!customer) return;
    try {
      const newValue = !customer.emailSubscribed;
      await api.patch(`/admin/customers/${customer.id}`, { emailSubscribed: newValue });
      setCustomer({ ...customer, emailSubscribed: newValue });
    } catch (err: any) {
      setError(err.message || 'Failed to update subscription');
    }
  };

  const copyEmail = () => {
    if (!customer) return;
    navigator.clipboard.writeText(customer.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-48" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-6 text-center">
          <p className="text-red-800 dark:text-red-300">{error || 'Customer not found'}</p>
          <Link href="/admin/customers" className="mt-3 inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Breadcrumb + Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 mb-4">
        <Link href="/admin/customers" className="hover:text-indigo-600 dark:hover:text-indigo-400">
          Customers
        </Link>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-900 dark:text-white font-medium">
          {customer.firstName} {customer.lastName}
        </span>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Amount spent', value: formatCurrency(customer.totalSpent) },
          { label: 'Orders', value: String(customer.orderCount) },
          { label: 'Customer since', value: formatRelative(customer.createdAt) },
          { label: 'Last order', value: customer.lastOrderDate ? formatRelative(customer.lastOrderDate) : 'N/A' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{stat.label}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Order history */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Order history</h2>
            </div>

            {customer.orders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
                No orders found.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {customer.orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    {/* Event logo */}
                    <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {order.event.logoUrl ? (
                        <img src={order.event.logoUrl} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>

                    {/* Order info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">#{order.orderRef}</span>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {order.event.name} &middot; {formatDate(order.event.date)}
                      </p>
                    </div>

                    {/* Ticket count + amount */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(order.totalAmount)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {order.ticketCount} ticket{order.ticketCount !== 1 ? 's' : ''}
                      </p>
                    </div>

                    {/* Chevron */}
                    <svg className="w-4 h-4 text-gray-400 dark:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Contact info */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Contact information</h2>
            </div>
            <div className="px-4 py-3 space-y-3">
              {/* Email */}
              <div className="flex items-center justify-between">
                <a href={`mailto:${customer.email}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline truncate">
                  {customer.email}
                </a>
                <button
                  onClick={copyEmail}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 flex-shrink-0 ml-2"
                  title="Copy email"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Email subscription */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-slate-300">Email subscription</span>
                <button
                  onClick={toggleSubscription}
                  className={`inline-flex items-center justify-center w-9 h-5 rounded-full transition-colors ${
                    customer.emailSubscribed
                      ? 'bg-green-500'
                      : 'bg-gray-300 dark:bg-slate-600'
                  }`}
                  title={customer.emailSubscribed ? 'Subscribed' : 'Unsubscribed'}
                >
                  <span
                    className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                      customer.emailSubscribed ? 'translate-x-1.5' : '-translate-x-1.5'
                    }`}
                  />
                </button>
              </div>

              {/* Location */}
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Location</p>
                {editingField === 'location' ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      autoFocus
                      className="w-full px-2 py-1 text-sm rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500"
                      placeholder="City, State"
                    />
                    <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit('location')}
                    className="text-sm text-gray-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {customer.location || <span className="text-gray-400 dark:text-slate-500 italic">Add location...</span>}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Notes</h2>
              {editingField !== 'note' && (
                <button
                  onClick={() => startEdit('note')}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
                  title="Edit notes"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {editingField === 'note' ? (
                <div className="space-y-2">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                    autoFocus
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500 resize-none"
                    placeholder="Add a note about this customer..."
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={cancelEdit} className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-700">
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving} className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50">
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-700 dark:text-slate-300">
                  {customer.note || <span className="text-gray-400 dark:text-slate-500 italic">No notes</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
