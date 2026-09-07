// Analytics overview page — admin area (T013)
// Moved from dashboard/analytics/page.tsx
// AdminRoute wrapper removed — layout.tsx handles auth guard
// Links updated from /dashboard/* to /admin/*

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useOrg } from '@/components/OrgContext';
import api from '@/services/api';

interface EventSummary {
  id: string;
  name: string;
  date: string;
  status: string;
  capacity: number;
  venue: { id: string; name: string } | null;
  priceTiers: {
    id: string;
    name: string;
    price: number;
    quantityTotal: number;
    quantitySold: number;
    quantityReserved: number;
    quantityAvailable: number;
  }[];
}

function formatCurrency(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amountCents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AnalyticsOverviewPage() {
  const { selectedOrgId } = useOrg();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Reset events when org changes
  useEffect(() => {
    setEvents([]);
  }, [selectedOrgId]);

  const fetchEvents = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const data = await api.get<{ events: EventSummary[] }>(
        `/organizations/${selectedOrgId}/events?${params.toString()}`
      );
      setEvents(data.events);
    } catch (err: any) {
      setError(err.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, dateFrom, dateTo]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Computed aggregates
  const publishedEvents = events.filter((e) => e.status === 'PUBLISHED');
  const totalSold = publishedEvents.reduce(
    (sum, e) => sum + e.priceTiers.reduce((s, t) => s + t.quantitySold, 0),
    0
  );
  const totalCapacity = publishedEvents.reduce((sum, e) => sum + e.capacity, 0);
  const totalRevenue = publishedEvents.reduce(
    (sum, e) => sum + e.priceTiers.reduce((s, t) => s + t.quantitySold * t.price, 0),
    0
  );
  const totalRemaining = publishedEvents.reduce(
    (sum, e) => sum + e.priceTiers.reduce((s, t) => s + t.quantityAvailable, 0),
    0
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 text-sm"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 border border-gray-300 dark:border-slate-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {!loading && (
        <>
          {/* Aggregate Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="rounded-lg border bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                Published Events
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
                {publishedEvents.length}
              </p>
            </div>
            <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                Total Sold
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
                {totalSold}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                of {totalCapacity} capacity
              </p>
            </div>
            <div className="rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                Remaining
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
                {totalRemaining}
              </p>
            </div>
            <div className="rounded-lg border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                Total Revenue
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
                {formatCurrency(totalRevenue)}
              </p>
            </div>
          </div>

          {/* Events Table */}
          {publishedEvents.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-slate-400 py-8">
              No published events found for this date range.
            </p>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-6 py-3">Event</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Sold</th>
                    <th className="px-6 py-3">Remaining</th>
                    <th className="px-6 py-3">Revenue</th>
                    <th className="px-6 py-3">Sell-through</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {publishedEvents
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((event) => {
                      const sold = event.priceTiers.reduce((s, t) => s + t.quantitySold, 0);
                      const avail = event.priceTiers.reduce((s, t) => s + t.quantityAvailable, 0);
                      const rev = event.priceTiers.reduce(
                        (s, t) => s + t.quantitySold * t.price,
                        0
                      );
                      const pct =
                        event.capacity > 0 ? Math.round((sold / event.capacity) * 100) : 0;

                      return (
                        <tr key={event.id} className="text-gray-900 dark:text-slate-100">
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium">{event.name}</p>
                              {event.venue && (
                                <p className="text-xs text-gray-400 dark:text-slate-500">
                                  {event.venue.name}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm">{formatDate(event.date)}</td>
                          <td className="px-6 py-4">{sold}</td>
                          <td className="px-6 py-4">
                            <span
                              className={
                                avail === 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''
                              }
                            >
                              {avail}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-medium">{formatCurrency(rev)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    pct >= 90
                                      ? 'bg-red-500'
                                      : pct >= 50
                                        ? 'bg-amber-500'
                                        : 'bg-indigo-600'
                                  }`}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 dark:text-slate-400">
                                {pct}%
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Link
                              href={`/admin/events/${event.id}/analytics`}
                              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                            >
                              Details →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
