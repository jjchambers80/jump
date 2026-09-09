'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';

interface TicketRow {
  id: string;
  barcode: string;
  ticketNumber: number;
  priceTierName: string;
  pricePaid: number;
  status: string;
  redeemedAt: string | null;
  createdAt: string;
  eventName: string;
  orderRef: string;
  orderId: string;
  purchaser: { firstName: string; lastName: string; email: string } | null;
  attendee: { firstName: string; lastName: string; email: string } | null;
}

interface TicketListResponse {
  data: TicketRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface EventOption {
  id: string;
  name: string;
}

interface TicketDetail {
  id: string;
  ticketNumber: number;
  barcode: string;
  qrCodeImage: string | null;
  priceTierName: string;
  pricePaid: number;
  status: string;
  redeemedAt: string | null;
  createdAt: string;
  attendee: { id: string; firstName: string; lastName: string; email: string } | null;
  purchaser: { firstName: string; lastName: string; email: string } | null;
  event: { id: string; name: string; date: string; venue: string };
  order: { id: string; orderRef: string; totalAmount: number; currency: string };
  payment: {
    status: string;
    amount: number;
    currency: string;
    stripePaymentIntentId: string | null;
    createdAt: string;
  } | null;
  siblingTickets: {
    id: string;
    barcode: string;
    ticketNumber: number;
    priceTierName: string;
    pricePaid: number;
    status: string;
    attendee: { firstName: string; lastName: string; email: string } | null;
  }[];
}

type StatusFilter = '' | 'VALID' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';

const statusDisplay: Record<string, { label: string; color: string }> = {
  VALID: {
    label: 'Active',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  REDEEMED: {
    label: 'Checked in',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  EXPIRED: {
    label: 'Expired',
    color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  },
  VOIDED: {
    label: 'Voided',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

// ─── Ticket Detail Modal ───

function TicketDetailModal({
  ticketId,
  onClose,
  onTicketUpdated,
}: {
  ticketId: string;
  onClose: () => void;
  onTicketUpdated: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAttendee, setEditingAttendee] = useState(false);
  const [attendeeForm, setAttendeeForm] = useState({ firstName: '', lastName: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<TicketDetail>(`/admin/tickets/${ticketId}`);
      setDetail(data);
      if (data.attendee) {
        setAttendeeForm({
          firstName: data.attendee.firstName,
          lastName: data.attendee.lastName,
          email: data.attendee.email,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const handleSaveAttendee = async () => {
    if (!detail) return;
    try {
      setSaving(true);
      await api.patch(`/admin/tickets/${ticketId}/attendee`, attendeeForm);
      setEditingAttendee(false);
      await fetchDetail();
      onTicketUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update attendee');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckIn = async () => {
    if (!detail) return;
    try {
      setActionLoading(true);
      if (detail.status === 'REDEEMED') {
        await api.post(`/admin/tickets/${ticketId}/undo-check-in`, {});
      } else {
        await api.post(`/admin/tickets/${ticketId}/check-in`, {});
      }
      await fetchDetail();
      onTicketUpdated();
    } catch (err: any) {
      setError(err.message || 'Check-in action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const checkInLabel = detail?.status === 'REDEEMED' ? 'Undo check in' : 'Check in';

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8"
    >
      <div className="relative w-full max-w-3xl mx-4 bg-white dark:bg-slate-800 rounded-xl shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Loading */}
        {loading && (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse h-20 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="p-6">
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Content */}
        {detail && !loading && (
          <div className="p-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Ticket information</h2>

            {/* Main ticket card */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* QR Code */}
                <div className="flex-shrink-0 flex flex-col items-center gap-2">
                  {detail.qrCodeImage ? (
                    <img
                      src={detail.qrCodeImage}
                      alt="Ticket QR Code"
                      className="w-28 h-28 rounded"
                    />
                  ) : (
                    <div className="w-28 h-28 rounded bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-xs text-gray-400">
                      No QR
                    </div>
                  )}
                  {detail.status === 'REDEEMED' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Checked in
                    </span>
                  )}
                </div>

                {/* Ticket + Attendee info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:gap-8">
                    {/* Attendee info */}
                    <div className="flex-1 mb-3 sm:mb-0">
                      <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                        {detail.priceTierName}
                      </p>
                      <div className="flex items-start gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-0.5">Attendee information</p>
                          {editingAttendee ? (
                            <div className="space-y-2 mt-1">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={attendeeForm.firstName}
                                  onChange={(e) => setAttendeeForm({ ...attendeeForm, firstName: e.target.value })}
                                  placeholder="First name"
                                  className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                                />
                                <input
                                  type="text"
                                  value={attendeeForm.lastName}
                                  onChange={(e) => setAttendeeForm({ ...attendeeForm, lastName: e.target.value })}
                                  placeholder="Last name"
                                  className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                                />
                              </div>
                              <input
                                type="email"
                                value={attendeeForm.email}
                                onChange={(e) => setAttendeeForm({ ...attendeeForm, email: e.target.value })}
                                placeholder="Email"
                                className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleSaveAttendee}
                                  disabled={saving}
                                  className="px-3 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingAttendee(false);
                                    if (detail.attendee) {
                                      setAttendeeForm({
                                        firstName: detail.attendee.firstName,
                                        lastName: detail.attendee.lastName,
                                        email: detail.attendee.email,
                                      });
                                    }
                                  }}
                                  className="px-3 py-1 text-xs font-medium rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {detail.attendee ? (
                                <div>
                                  <p className="text-sm text-gray-900 dark:text-white">
                                    <span className="font-medium">Name:</span> {detail.attendee.firstName} {detail.attendee.lastName}
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-white">
                                    <span className="font-medium">Email:</span> {detail.attendee.email}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-400">No attendee info</p>
                              )}
                              <button
                                onClick={() => setEditingAttendee(true)}
                                className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                edit
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Ticket details */}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-2">Ticket details</p>
                      <div className="space-y-1.5 text-sm text-gray-900 dark:text-white">
                        {detail.event.venue && (
                          <p><span className="font-medium">Location:</span> {detail.event.venue}</p>
                        )}
                        <p><span className="font-medium">Date & Time:</span> {formatDate(detail.event.date)}</p>
                        <p><span className="font-medium">Amount charged:</span> {formatCurrency(detail.pricePaid)}</p>
                        <p><span className="font-medium">Confirmation:</span> {detail.barcode}</p>
                        <p><span className="font-medium">Order:</span>{' '}
                          <Link href={`/admin/orders/${detail.order.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                            {detail.order.orderRef}
                          </Link>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Purchased date + check-in */}
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-gray-500 dark:text-slate-400">
                      Purchased: {formatDate(detail.createdAt)}
                    </span>
                    {detail.redeemedAt && (
                      <span className="text-gray-500 dark:text-slate-400">
                        Checked in: {formatDate(detail.redeemedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Check-in action */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleCheckIn}
                disabled={actionLoading || detail.status === 'VOIDED' || detail.status === 'EXPIRED'}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  detail.status === 'REDEEMED'
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {detail.status === 'REDEEMED' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {actionLoading ? 'Processing...' : checkInLabel}
              </button>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusDisplay[detail.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                {statusDisplay[detail.status]?.label || detail.status}
              </span>
            </div>

            {/* Payment information */}
            {detail.payment && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Payment information</h3>
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      detail.payment.status === 'SUCCEEDED'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : detail.payment.status === 'PENDING'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {detail.payment.status}
                    </span>
                    <span className="text-gray-900 dark:text-white font-medium">
                      {formatCurrency(detail.payment.amount)}
                    </span>
                    {detail.payment.stripePaymentIntentId && (
                      <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                        {detail.payment.stripePaymentIntentId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Other tickets in order */}
            {detail.siblingTickets.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Other tickets in order: {detail.order.orderRef}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {detail.siblingTickets.map((sibling) => (
                    <div
                      key={sibling.id}
                      className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
                    >
                      <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
                        {sibling.priceTierName}
                      </p>
                      <div className="text-sm text-gray-900 dark:text-white">
                        {sibling.attendee ? (
                          <>
                            <p><span className="font-medium">Name:</span> {sibling.attendee.firstName} {sibling.attendee.lastName}</p>
                            <p><span className="font-medium">Email:</span> {sibling.attendee.email}</p>
                          </>
                        ) : (
                          <p className="text-gray-400">No attendee info</p>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                          {formatCurrency(sibling.pricePaid)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-500 dark:text-slate-400">
                            {sibling.barcode}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusDisplay[sibling.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                            {statusDisplay[sibling.status]?.label || sibling.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminOrdersPage() {
  const { selectedOrgId } = useOrg();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [eventFilter, setEventFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [resendingTicketId, setResendingTicketId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ ticketId: string; success: boolean } | null>(null);

  const handleResendConfirmation = async (ticketId: string, orderId: string) => {
    setResendingTicketId(ticketId);
    setResendResult(null);
    try {
      await api.post(`/admin/orders/${orderId}/resend-confirmation`, {});
      setResendResult({ ticketId, success: true });
    } catch {
      setResendResult({ ticketId, success: false });
    } finally {
      setResendingTicketId(null);
      setTimeout(() => setResendResult(null), 3000);
    }
  };

  // Load events for filter dropdown
  useEffect(() => {
    if (!selectedOrgId) return;
    api
      .get<{ events: EventOption[] }>(`/admin/events`)
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, [selectedOrgId]);

  const fetchTickets = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (eventFilter) params.set('eventId', eventFilter);
      if (search) params.set('search', search);
      const data = await api.get<TicketListResponse>(`/admin/tickets?${params.toString()}`);
      setTickets(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, page, statusFilter, eventFilter, search]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    setPage(1);
  }, [selectedOrgId, statusFilter, eventFilter, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const sortedTickets = [...tickets].sort((a, b) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return sortDir === 'desc' ? db - da : da - db;
  });

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Orders</h1>
        </div>
        <Link
          href="/admin/orders/scan"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Check In
        </Link>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search using name, email address, confirmation code, or order reference..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(e); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); }}
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            showFilters || statusFilter || eventFilter
              ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
              : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Status</label>
            <div className="flex gap-1.5">
              {(['', 'VALID', 'REDEEMED', 'EXPIRED', 'VOIDED'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 border border-gray-200 dark:border-slate-600'
                  }`}
                >
                  {s ? (statusDisplay[s]?.label || s) : 'All'}
                </button>
              ))}
            </div>
          </div>

          {events.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Event</label>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5"
              >
                <option value="">All Events</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.name}</option>
                ))}
              </select>
            </div>
          )}

          {(statusFilter || eventFilter) && (
            <button
              onClick={() => { setStatusFilter(''); setEventFilter(''); }}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="animate-pulse h-[72px] bg-gray-100 dark:bg-slate-700/50 rounded" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && selectedOrgId && tickets.length === 0 && (
        <div className="text-center py-16">
          <svg className="mx-auto w-12 h-12 text-gray-300 dark:text-slate-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
          <p className="text-gray-500 dark:text-slate-400">
            {search || statusFilter || eventFilter
              ? 'No tickets match your filters.'
              : 'No tickets yet.'}
          </p>
        </div>
      )}

      {/* Ticket table */}
      {!loading && sortedTickets.length > 0 && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[minmax(160px,1.5fr)_minmax(160px,1.5fr)_minmax(200px,2fr)_90px_100px_130px_minmax(60px,auto)] gap-x-4 px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
            <div>Purchaser</div>
            <div>Attendee</div>
            <div>Ticket</div>
            <div className="text-right">Amount</div>
            <div className="text-center">Status</div>
            <button
              onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1 text-right justify-end hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
            >
              Date
              <svg className={`w-3 h-3 transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="text-right">Action</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {sortedTickets.map((ticket) => (
              <div key={ticket.id}>
                {/* Desktop row */}
                <div className="hidden lg:grid grid-cols-[minmax(160px,1.5fr)_minmax(160px,1.5fr)_minmax(200px,2fr)_90px_100px_130px_minmax(60px,auto)] gap-x-4 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  {/* Purchaser */}
                  <div className="min-w-0">
                    {ticket.purchaser ? (
                      <>
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {ticket.purchaser.firstName} {ticket.purchaser.lastName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {ticket.purchaser.email}
                        </p>
                      </>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </div>

                  {/* Attendee */}
                  <div className="min-w-0">
                    {ticket.attendee ? (
                      <>
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {ticket.attendee.firstName} {ticket.attendee.lastName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {ticket.attendee.email}
                        </p>
                      </>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </div>

                  {/* Ticket info */}
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white truncate">
                      {ticket.eventName} – {ticket.priceTierName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                      Conf #: {ticket.barcode}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                      Order #: <Link href={`/admin/orders/${ticket.orderId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{ticket.orderRef}</Link>
                    </p>
                  </div>

                  {/* Amount */}
                  <div className="text-right text-sm text-gray-900 dark:text-white">
                    {formatCurrency(ticket.pricePaid)}
                  </div>

                  {/* Status */}
                  <div className="text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusDisplay[ticket.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                      {ticket.status === 'REDEEMED' && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {statusDisplay[ticket.status]?.label || ticket.status}
                    </span>
                  </div>

                  {/* Date */}
                  <div className="text-right">
                    <p className="text-xs text-gray-900 dark:text-white">{formatDate(ticket.createdAt)}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{formatTime(ticket.createdAt)}</p>
                  </div>

                  {/* Action */}
                  <div className="text-right flex flex-col items-end gap-1">
                    <button
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      view ticket
                    </button>
                    {resendingTicketId === ticket.id ? (
                      <span className="text-xs text-gray-400">sending...</span>
                    ) : resendResult?.ticketId === ticket.id ? (
                      <span className={`text-xs ${resendResult.success ? 'text-green-500' : 'text-red-500'}`}>
                        {resendResult.success ? 'Sent!' : 'Failed'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleResendConfirmation(ticket.id, ticket.orderId)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        resend confirmation
                      </button>
                    )}
                  </div>
                </div>

                {/* Mobile card */}
                <div className="lg:hidden p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      {ticket.purchaser && (
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {ticket.purchaser.firstName} {ticket.purchaser.lastName}
                        </p>
                      )}
                      {ticket.attendee && (
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          Attendee: {ticket.attendee.firstName} {ticket.attendee.lastName}
                        </p>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusDisplay[ticket.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                      {statusDisplay[ticket.status]?.label || ticket.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white">
                    {ticket.eventName} – {ticket.priceTierName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Conf #: {ticket.barcode}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(ticket.pricePaid)}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 dark:text-slate-400">
                        {formatDate(ticket.createdAt)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedTicketId(ticket.id)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          view ticket
                        </button>
                        {resendingTicketId === ticket.id ? (
                          <span className="text-xs text-gray-400">sending...</span>
                        ) : resendResult?.ticketId === ticket.id ? (
                          <span className={`text-xs ${resendResult.success ? 'text-green-500' : 'text-red-500'}`}>
                            {resendResult.success ? 'Sent!' : 'Failed'}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleResendConfirmation(ticket.id, ticket.orderId)}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            resend
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer with count + pagination */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-700">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {total} ticket{total !== 1 ? 's' : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicketId && (
        <TicketDetailModal
          ticketId={selectedTicketId}
          onClose={() => setSelectedTicketId(null)}
          onTicketUpdated={fetchTickets}
        />
      )}
    </div>
  );
}
