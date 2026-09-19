'use client';

// Order-level rows of the Orders page (spec 024 phase 2): ticket orders and
// application orders in one list, newest first, with search (order number,
// name, email, business, Stripe id), kind / status / event / date filters,
// CSV export and a link into the order detail.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import api, { getActiveOrganizationId } from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import {
  formatMoney,
  ORDER_KIND_LABEL,
  ORDER_STATUS_CLASS,
  orderListQueryString,
  orderStatusLabel,
  type OrderKind,
  type OrderListQuery,
  type OrderListResponse,
  type OrderRow,
} from '@/lib/orders';

interface EventOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All open' },
  { value: 'COMPLETED', label: 'Paid' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'FAILED', label: 'Failed' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

export default function OrdersListView() {
  const { selectedOrgId } = useOrg();
  const { data: session } = useSession();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<OrderKind | ''>('');
  const [status, setStatus] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [exporting, setExporting] = useState(false);

  const query: OrderListQuery = { page, limit: 25, kind, status, eventId: eventFilter, from, to, search, sort: 'createdAt', dir: sortDir };
  const filtersActive = Boolean(kind || status || eventFilter || from || to);

  useEffect(() => {
    if (!selectedOrgId) return;
    api
      .get<{ events: EventOption[] }>('/admin/events')
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, [selectedOrgId]);

  const fetchRows = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<OrderListResponse>(`/admin/orders?${orderListQueryString(query)}`);
      setRows(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, page, kind, status, eventFilter, from, to, search, sortDir]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setPage(1);
  }, [selectedOrgId, kind, status, eventFilter, from, to, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setKind('');
    setStatus('');
    setEventFilter('');
    setFrom('');
    setTo('');
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const { page: _page, limit: _limit, ...rest } = query;
      const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'}/admin/orders/export.csv?${orderListQueryString(rest)}`;
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const activeOrg = getActiveOrganizationId();
      if (activeOrg) headers['X-Jump-Org'] = activeOrg;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const showOrg = rows.some((r) => r.organization);

  return (
    <div data-testid="orders-list-view">
      {/* Search bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <form onSubmit={handleSearch} className="flex-1 min-w-[260px] relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search by order number, name, email, business, or Stripe id…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            data-testid="orders-search"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
              }}
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
            showFilters || filtersActive
              ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
              : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || loading}
          data-testid="orders-export"
          className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Kind</label>
            <div className="flex gap-1.5">
              {(
                [
                  ['', 'All'],
                  ['TICKET', 'Tickets'],
                  ['APPLICATION', 'Applications'],
                ] as [OrderKind | '', string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  data-testid={`orders-kind-${value || 'all'}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    kind === value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 border border-gray-200 dark:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="orders-status" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Status
            </label>
            <select
              id="orders-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {events.length > 0 && (
            <div>
              <label htmlFor="orders-event" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
                Event
              </label>
              <select
                id="orders-event"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5"
              >
                <option value="">All events</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="orders-from" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              From
            </label>
            <input id="orders-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5" />
          </div>
          <div>
            <label htmlFor="orders-to" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              To
            </label>
            <input id="orders-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5" />
          </div>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="animate-pulse h-[64px] bg-gray-100 dark:bg-slate-700/50 rounded" />
          ))}
        </div>
      )}

      {!loading && selectedOrgId && rows.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 dark:text-slate-400">{search || filtersActive ? 'No orders match your filters.' : 'No orders yet.'}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="orders-table">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider text-left">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Kind</th>
                  {showOrg && <th className="px-4 py-3">Organization</th>}
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-700 dark:hover:text-slate-200">
                      Date
                      <svg className={`w-3 h-3 transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {rows.map((row) => (
                  <tr key={row.id} data-testid="order-row" data-kind={row.kind} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/admin/orders/${row.id}`} className="font-mono text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                        {row.orderRef}
                      </Link>
                    </td>
                    <td className="px-4 py-3 min-w-[160px]">
                      {row.contact ? (
                        <>
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {row.contact.firstName} {row.contact.lastName}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{row.contact.email}</p>
                          {row.businessName && <p className="text-xs text-gray-600 dark:text-slate-300 truncate">{row.businessName}</p>}
                        </>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.kind === 'APPLICATION' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {ORDER_KIND_LABEL[row.kind]}
                      </span>
                    </td>
                    {showOrg && <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 whitespace-nowrap">{row.organization?.name ?? '—'}</td>}
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100 min-w-[140px]">{row.eventName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 min-w-[160px]">
                      {row.description || '—'}
                      {row.paymentSource === 'offline' && <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">(offline)</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white whitespace-nowrap">
                      {formatMoney(row.totalAmount)}
                      {row.refunded > 0 && <p className="text-xs text-purple-700 dark:text-purple-300">−{formatMoney(row.refunded)}</p>}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_CLASS[row.status] || 'bg-gray-100 text-gray-600'}`} data-testid="order-status">
                        {orderStatusLabel(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-700">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {total} order{total !== 1 ? 's' : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
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
                  type="button"
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
    </div>
  );
}
