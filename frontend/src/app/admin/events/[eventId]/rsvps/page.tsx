'use client';

// Admin › Event › RSVPs (spec 034 phase 2): headcount summary, table,
// CSV export. Hidden for ticketed events.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { rsvpApi, getActiveOrganizationId, type RsvpRow, type RsvpListResponse } from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { useAccountFormat } from '@/lib/accountFormat';
import { Download, RefreshCw } from 'lucide-react';

// How often the headcount re-reads itself while the tab is in front. RSVPs
// arrive right up to the door, so an organizer watching this page should not
// have to reload to see the number move.
const REFRESH_INTERVAL_MS = 30_000;

export default function RsvpsListPage({ params }: { params: { eventId: string } }) {
  const { data: session } = useSession();
  const { selectedOrgId } = useOrg();
  const { formatDateTime } = useAccountFormat();
  const [data, setData] = useState<RsvpListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keeps a slow poll from stacking on top of a still-running one.
  const inFlight = useRef(false);

  const fetchRsvps = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        if (silent) setRefreshing(true);
        else setLoading(true);
        setError(null);
        const result = await rsvpApi.listAdmin(params.eventId);
        setData(result);
        setUpdatedAt(new Date());
      } catch (err: any) {
        // A failed background poll keeps the last good numbers on screen
        // rather than replacing the table with an error page.
        if (!silent) setError(err.message || 'Failed to load RSVPs');
      } finally {
        inFlight.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    },
    [params.eventId]
  );

  // Wait for OrgContext: until it sets X-Jump-Org, a direct load or reload
  // resolves no organization and the backend answers 404.
  useEffect(() => {
    if (!selectedOrgId) return;
    fetchRsvps();
  }, [params.eventId, selectedOrgId, fetchRsvps]);

  // Poll only while the tab is in front, and catch up as soon as it is again.
  useEffect(() => {
    if (!selectedOrgId) return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchRsvps({ silent: true });
    };
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) fetchRsvps({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedOrgId, fetchRsvps]);

  const handleCsvExport = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
      const headers: Record<string, string> = {
        Authorization: `Bearer ${(session as any)?.accessToken || ''}`,
      };
      const activeOrg = getActiveOrganizationId();
      if (activeOrg) headers['X-Jump-Org'] = activeOrg;
      const response = await fetch(`${API_URL}/admin/events/${params.eventId}/rsvps?format=csv`, { headers });
      if (!response.ok) {
        setError('Failed to export CSV');
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rsvps-${params.eventId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export CSV');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-48" />
          <div className="h-20 bg-gray-200 dark:bg-slate-700 rounded" />
          <div className="h-64 bg-gray-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { headcount, rsvpCount, cancelledCount } = data;
  const going = data.data.filter((r) => r.status === 'GOING');

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Headers */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">RSVPs</h2>
          {updatedAt && (
            <span className="text-xs text-gray-500 dark:text-slate-400" data-testid="rsvp-updated-at">
              Updated {formatDateTime(updatedAt, { timeStyle: 'medium' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchRsvps({ silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          <Link
            href={`/admin/customers?rsvp=going&eventId=${encodeURIComponent(params.eventId)}`}
            className="inline-flex items-center rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            View customers
          </Link>
          <button
            onClick={handleCsvExport}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </button>
        </div>
      </div>

      {/* Headcount summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">Expected Headcount</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1" data-testid="rsvp-headcount">{headcount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">RSVPs</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">{rsvpCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">Cancelled</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">{cancelledCount}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
        {data.data.length === 0 ? (
          <p className="text-gray-500 dark:text-slate-400 text-center py-8">
            No RSVPs yet.
          </p>
        ) : (
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Party Size</th>
                <th className="px-4 py-3">Subscribed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">RSVP&apos;d At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {going.map((row: RsvpRow) => (
                <tr key={row.id} className="text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 font-medium">{row.firstName} {row.lastName}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{row.email}</td>
                  <td className="px-4 py-3">{row.partySize}</td>
                  <td className="px-4 py-3">
                    {row.subscribed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Subscribed
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                      Going
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </td>
                </tr>
              ))}
              {/* Cancelled rows shown dimmed */}
              {data.data.filter((r) => r.status === 'CANCELLED').map((row) => (
                <tr key={row.id} className="text-gray-400 dark:text-slate-600 bg-gray-50 dark:bg-slate-900/30">
                  <td className="px-4 py-3"><s>{row.firstName} {row.lastName}</s></td>
                  <td className="px-4 py-3"><s>{row.email}</s></td>
                  <td className="px-4 py-3"><s>{row.partySize}</s></td>
                  <td className="px-4 py-3">—</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">
                      Cancelled
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <s>{formatDateTime(row.createdAt)}</s>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}