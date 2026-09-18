'use client';

// Transactions (spec 018 phase 1): every money event for the organization —
// ticket orders and application payments — in one list. Filters live in the
// URL so a filtered view is linkable. Refunds are ADMIN (the API enforces it);
// organizers see the history only.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import {
  TRANSACTION_STATUS_OPTIONS,
  formatMoney,
  isRefundable,
  shortReference,
  transactionStatusDisplay,
  transactionStatusLabel,
  type Transaction,
  type TransactionQuery,
  type TransactionRefund,
  type TransactionSort,
  type TransactionStatus,
  type TransactionType,
} from '@/lib/transactions';
import RefundTransactionDialog from './RefundTransactionDialog';
import { describeError, useTransactionsApi } from './useTransactionsApi';

const PAGE_SIZE = 50;

interface EventOption {
  id: string;
  name: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function toDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

const typePill: Record<TransactionType, string> = {
  ORDER: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  APPLICATION: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

const chipClass = (active: boolean) =>
  `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
    active
      ? 'bg-indigo-600 text-white'
      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 border border-gray-200 dark:border-slate-600'
  }`;

const selectClass = 'rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-gray-700 dark:text-slate-300 px-3 py-1.5';

function RefundHistory({ type, id, refunds, loading, error }: { type: TransactionType; id: string; refunds: TransactionRefund[] | undefined; loading: boolean; error: string | null }) {
  if (loading) return <p className="text-xs text-gray-500 dark:text-slate-400">Loading refunds…</p>;
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!refunds || refunds.length === 0) return <p className="text-xs text-gray-500 dark:text-slate-400">No refunds.</p>;
  return (
    <table className="w-full text-xs" data-testid={`refunds-${type}-${id}`}>
      <thead>
        <tr className="text-left text-gray-500 dark:text-slate-400">
          <th className="py-1 pr-4 font-medium">Date</th>
          <th className="py-1 pr-4 font-medium">Amount</th>
          <th className="py-1 pr-4 font-medium">Status</th>
          <th className="py-1 pr-4 font-medium">Detail</th>
          <th className="py-1 pr-4 font-medium">Reason</th>
          <th className="py-1 pr-4 font-medium">Stripe refund</th>
        </tr>
      </thead>
      <tbody className="text-gray-800 dark:text-slate-200">
        {refunds.map((r) => (
          <tr key={r.id} className="border-t border-gray-100 dark:border-slate-700/60">
            <td className="py-1 pr-4 whitespace-nowrap">
              {formatDate(r.createdAt)} {formatTime(r.createdAt)}
            </td>
            <td className="py-1 pr-4">{formatMoney(r.amount)}</td>
            <td className="py-1 pr-4">{r.status === 'SUCCEEDED' ? 'Succeeded' : r.status === 'FAILED' ? 'Failed' : 'Pending'}</td>
            <td className="py-1 pr-4">{r.detail ?? '—'}</td>
            <td className="py-1 pr-4">{r.reason ?? '—'}</td>
            <td className="py-1 pr-4 font-mono">{r.manual ? 'Recorded offline' : r.stripeRefundId ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TransactionsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedOrgId } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  const apiClient = useTransactionsApi();

  const query = useMemo<TransactionQuery>(
    () => ({
      type: (searchParams.get('type') as TransactionType | null) || '',
      status: (searchParams.get('status') as TransactionStatus | null) || '',
      eventId: searchParams.get('eventId') || '',
      from: searchParams.get('from') || '',
      to: searchParams.get('to') || '',
      hasRefunds: searchParams.get('hasRefunds') === 'true',
      paymentSource: (searchParams.get('paymentSource') as 'stripe' | 'offline' | null) || '',
      search: searchParams.get('search') || '',
      sort: (searchParams.get('sort') as TransactionSort | null) || '-date',
      page: Number(searchParams.get('page') || '1') || 1,
      pageSize: PAGE_SIZE,
    }),
    [searchParams]
  );

  const setQuery = useCallback(
    (patch: Partial<TransactionQuery>, { resetPage = true } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      const entries: [string, string | number | boolean | undefined][] = Object.entries({ ...patch });
      for (const [key, value] of entries) {
        if (value === undefined || value === '' || value === false || (key === 'sort' && value === '-date')) next.delete(key);
        else next.set(key, String(value));
      }
      if (resetPage) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const [rows, setRows] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [searchInput, setSearchInput] = useState(query.search || '');
  const [showFilters, setShowFilters] = useState(Boolean(query.type || query.status || query.eventId || query.from || query.to || query.hasRefunds || query.paymentSource));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refundsByKey, setRefundsByKey] = useState<Record<string, TransactionRefund[]>>({});
  const [refundsLoading, setRefundsLoading] = useState<string | null>(null);
  const [refundsError, setRefundsError] = useState<Record<string, string>>({});
  const [refundTarget, setRefundTarget] = useState<Transaction | null>(null);
  const [exporting, setExporting] = useState(false);
  const refundBtnRef = useRef<HTMLButtonElement>(null);

  const showOrg = rows.some((r) => r.organization);
  const hasFilters = Boolean(query.type || query.status || query.eventId || query.from || query.to || query.hasRefunds || query.paymentSource);

  useEffect(() => {
    setSearchInput(query.search || '');
  }, [query.search]);

  useEffect(() => {
    if (!selectedOrgId && role !== 'SYSTEM_ADMIN') return;
    api
      .get<{ events: EventOption[] }>('/admin/events')
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, [selectedOrgId, role]);

  const fetchRows = useCallback(async () => {
    if (!selectedOrgId && role !== 'SYSTEM_ADMIN') return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.list(query);
      setRows(data.data);
      setTotal(data.pagination.total);
      setTotalPages(Math.max(1, data.pagination.totalPages));
    } catch (err) {
      setError(describeError(err, 'Failed to load transactions'));
    } finally {
      setLoading(false);
    }
  }, [apiClient, query, selectedOrgId, role]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const keyOf = (t: Transaction) => `${t.type}:${t.id}`;

  const loadRefunds = useCallback(
    async (t: Transaction, force = false) => {
      const key = keyOf(t);
      if (!force && refundsByKey[key]) return;
      setRefundsLoading(key);
      setRefundsError((prev) => ({ ...prev, [key]: '' }));
      try {
        const data = await apiClient.refunds(t.type, t.id);
        setRefundsByKey((prev) => ({ ...prev, [key]: data.refunds }));
      } catch (err) {
        setRefundsError((prev) => ({ ...prev, [key]: describeError(err, 'Could not load refunds') }));
      } finally {
        setRefundsLoading((current) => (current === key ? null : current));
      }
    },
    [apiClient, refundsByKey]
  );

  const toggleExpanded = (t: Transaction) => {
    const key = keyOf(t);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    loadRefunds(t);
  };

  const handleRefunded = (next: Transaction, refunds: TransactionRefund[]) => {
    const key = keyOf(next);
    setRows((prev) => prev.map((r) => (keyOf(r) === key ? next : r)));
    setRefundsByKey((prev) => ({ ...prev, [key]: refunds }));
    setExpanded(key);
    setRefundTarget(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery({ search: searchInput.trim() });
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}${apiClient.exportUrl(query)}`;
      const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      if (selectedOrgId) headers['X-Jump-Org'] = selectedOrgId;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(describeError(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const gridCols = showOrg
    ? 'grid-cols-[110px_minmax(150px,1.4fr)_minmax(140px,1.2fr)_minmax(180px,1.8fr)_90px_90px_130px_minmax(120px,auto)]'
    : 'grid-cols-[110px_minmax(170px,1.6fr)_minmax(200px,2fr)_90px_90px_130px_minmax(120px,auto)]';

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Transactions</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">Ticket orders and application payments in one place.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
          data-testid="transactions-export"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Search + filters toggle */}
      <div className="flex items-center gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Email, name, business, order ref or Stripe id (pi_…, re_…, cs_…, ch_…)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            data-testid="transactions-search"
          />
          {query.search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setQuery({ search: '' });
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
            showFilters || hasFilters
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
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Type</label>
            <div className="flex gap-1.5">
              {(['', 'ORDER', 'APPLICATION'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setQuery({ type: t })} className={chipClass(query.type === t)}>
                  {t === '' ? 'All' : t === 'ORDER' ? 'Orders' : 'Applications'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="tx-status" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Status
            </label>
            <select id="tx-status" value={query.status} onChange={(e) => setQuery({ status: e.target.value as TransactionStatus | '' })} className={selectClass}>
              {TRANSACTION_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {events.length > 0 && (
            <div>
              <label htmlFor="tx-event" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
                Event
              </label>
              <select id="tx-event" value={query.eventId} onChange={(e) => setQuery({ eventId: e.target.value })} className={selectClass}>
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
            <label htmlFor="tx-from" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              From
            </label>
            <input id="tx-from" type="date" value={toDateInput(query.from)} onChange={(e) => setQuery({ from: e.target.value })} className={selectClass} />
          </div>
          <div>
            <label htmlFor="tx-to" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              To
            </label>
            <input id="tx-to" type="date" value={toDateInput(query.to)} onChange={(e) => setQuery({ to: e.target.value })} className={selectClass} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 pb-1.5">
            <input type="checkbox" checked={Boolean(query.hasRefunds)} onChange={(e) => setQuery({ hasRefunds: e.target.checked })} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Has refunds
          </label>
          <div>
            <label htmlFor="tx-source" className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              Source
            </label>
            <select id="tx-source" value={query.paymentSource} onChange={(e) => setQuery({ paymentSource: e.target.value as 'stripe' | 'offline' | '' })} className={selectClass}>
              <option value="">Stripe + offline</option>
              <option value="stripe">Stripe</option>
              <option value="offline">Offline</option>
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setQuery({ type: '', status: '', eventId: '', from: '', to: '', hasRefunds: false, paymentSource: '' })}
              className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
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

      {!loading && rows.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 dark:text-slate-400">{query.search || hasFilters ? 'No transactions match your filters.' : 'No transactions yet.'}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
          <div className={`hidden lg:grid ${gridCols} gap-x-4 px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider`}>
            <div>Type</div>
            <div>Customer</div>
            {showOrg && <div>Organization</div>}
            <div>Event · Description</div>
            <div className="text-right">Gross</div>
            <div className="text-right">Net</div>
            <button
              type="button"
              onClick={() => setQuery({ sort: query.sort === 'date' ? '-date' : 'date' }, { resetPage: false })}
              className="flex items-center gap-1 justify-end hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
            >
              Date
              <svg className={`w-3 h-3 transition-transform ${query.sort === 'date' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="text-right">Status</div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {rows.map((t) => {
              const key = keyOf(t);
              const isOpen = expanded === key;
              const status = transactionStatusDisplay[t.status];
              return (
                <div key={key} data-testid={`transaction-${t.type}-${t.id}`}>
                  <div className={`hidden lg:grid ${gridCols} gap-x-4 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors`}>
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typePill[t.type]}`}>{t.type === 'ORDER' ? 'Order' : 'Application'}</span>
                      <p className="mt-1 text-xs font-mono text-gray-500 dark:text-slate-400">
                        <Link href={t.detailUrl} className="hover:underline">
                          {shortReference(t)}
                        </Link>
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.businessName || t.contact.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {t.businessName ? `${t.contact.name} · ` : ''}
                        {t.contact.email}
                      </p>
                    </div>
                    {showOrg && <div className="text-sm text-gray-700 dark:text-slate-300 truncate">{t.organization?.name ?? '—'}</div>}
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate">{t.event.name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{t.description || '—'}</p>
                    </div>
                    <div className="text-right text-sm text-gray-900 dark:text-white">
                      {t.amountDue != null && t.gross === 0 ? (
                        <span className="text-gray-500 dark:text-slate-400" title="Amount due">
                          {formatMoney(t.amountDue)} due
                        </span>
                      ) : (
                        formatMoney(t.gross)
                      )}
                    </div>
                    <div className="text-right text-sm text-gray-900 dark:text-white">
                      {formatMoney(t.net)}
                      {t.refunded > 0 && <p className="text-xs text-gray-500 dark:text-slate-400">−{formatMoney(t.refunded)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-900 dark:text-white">{formatDate(t.occurredAt)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{formatTime(t.occurredAt)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="flex items-center gap-1">
                        {t.paymentSource === 'offline' && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200" title="Recorded outside Stripe">
                            Offline
                          </span>
                        )}
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${status?.color || 'bg-gray-100 text-gray-600'}`}>{transactionStatusLabel(t)}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => toggleExpanded(t)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                          {isOpen ? 'hide refunds' : t.refunded > 0 ? 'refunds' : 'details'}
                        </button>
                        {isRefundable(t) && (
                          <button
                            type="button"
                            ref={refundTarget?.id === t.id ? refundBtnRef : undefined}
                            onClick={() => setRefundTarget(t)}
                            disabled={!isAdmin}
                            title={isAdmin ? undefined : 'Refunds require the Admin role'}
                            className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                            data-testid={`refund-${t.type}-${t.id}`}
                          >
                            refund
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="lg:hidden p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="min-w-0">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typePill[t.type]}`}>{t.type === 'ORDER' ? 'Order' : 'Application'}</span>
                        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white truncate">{t.businessName || t.contact.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{t.contact.email}</p>
                      </div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${status?.color || 'bg-gray-100 text-gray-600'}`}>{transactionStatusLabel(t)}</span>
                    </div>
                    <p className="text-sm text-gray-900 dark:text-white truncate">{t.event.name}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{t.description || '—'}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {t.amountDue != null && t.gross === 0 ? `${formatMoney(t.amountDue)} due` : formatMoney(t.net)}
                      </span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500 dark:text-slate-400">{formatDate(t.occurredAt)}</span>
                        <Link href={t.detailUrl} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          open
                        </Link>
                        <button type="button" onClick={() => toggleExpanded(t)} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          {isOpen ? 'hide' : 'refunds'}
                        </button>
                        {isRefundable(t) && isAdmin && (
                          <button type="button" onClick={() => setRefundTarget(t)} className="text-red-600 dark:text-red-400 hover:underline">
                            refund
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-gray-50/60 dark:bg-slate-900/30 border-t border-dashed border-gray-200 dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-2 text-xs text-gray-500 dark:text-slate-400">
                        {t.stripePaymentIntentId && (
                          <span>
                            Payment intent <span className="font-mono text-gray-700 dark:text-slate-300">{t.stripePaymentIntentId}</span>
                          </span>
                        )}
                        {t.stripeCheckoutSessionId && (
                          <span>
                            Checkout <span className="font-mono text-gray-700 dark:text-slate-300">{t.stripeCheckoutSessionId}</span>
                          </span>
                        )}
                        {t.stripeAccountId && (
                          <span>
                            Connected account <span className="font-mono text-gray-700 dark:text-slate-300">{t.stripeAccountId}</span>
                          </span>
                        )}
                        <span>
                          Fees {formatMoney(t.platformFee + t.processingFee)} · Tax {formatMoney(t.tax)}
                        </span>
                        {t.dueAt && t.amountDue != null && <span>Due {formatDate(t.dueAt)}</span>}
                        <Link href={t.detailUrl} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          Open {t.type === 'ORDER' ? 'order' : 'application'} →
                        </Link>
                      </div>
                      <RefundHistory type={t.type} id={t.id} refunds={refundsByKey[key]} loading={refundsLoading === key} error={refundsError[key] || null} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-700">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {total} transaction{total !== 1 ? 's' : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuery({ page: Math.max(1, (query.page || 1) - 1) }, { resetPage: false })}
                  disabled={(query.page || 1) <= 1}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  {query.page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setQuery({ page: Math.min(totalPages, (query.page || 1) + 1) }, { resetPage: false })}
                  disabled={(query.page || 1) >= totalPages}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {refundTarget && (
        <RefundTransactionDialog transaction={refundTarget} returnFocusRef={refundBtnRef} onClose={() => setRefundTarget(null)} onRefunded={handleRefunded} />
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsPageInner />
    </Suspense>
  );
}
