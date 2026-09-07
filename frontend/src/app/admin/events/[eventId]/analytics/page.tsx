// Event Analytics page — admin area (T012)
// Moved from dashboard/events/[eventId]/analytics/page.tsx
// AdminRoute wrapper removed — layout.tsx handles auth guard
// Links updated from /dashboard/* to /admin/*

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import api from '@/services/api';

interface TierAnalytics {
  id: string;
  name: string;
  price: number;
  quantityTotal: number;
  sold: number;
  redeemed: number;
  remaining: number;
  revenue: number;
}

interface EventAnalytics {
  event: {
    id: string;
    name: string;
    date: string;
    status: string;
    capacity: number;
    venue: { id: string; name: string } | null;
  };
  totals: {
    sold: number;
    redeemed: number;
    remaining: number;
    revenue: number;
  };
  tiers: TierAnalytics[];
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
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatCard({
  label,
  value,
  subtext,
  color = 'indigo',
}: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}) {
  const colorClasses: Record<string, string> = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color] || colorClasses.indigo}`}>
      <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{value}</p>
      {subtext && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  );
}

export default function EventAnalyticsPage() {
  const params = useParams();
  const eventId = params.eventId as string;

  const { selectedOrgId } = useOrg();
  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset when org changes
  useEffect(() => {
    setAnalytics(null);
  }, [selectedOrgId]);

  const fetchAnalytics = useCallback(async () => {
    if (!selectedOrgId || !eventId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<EventAnalytics>(
        `/organizations/${selectedOrgId}/events/${eventId}/analytics`
      );
      setAnalytics(data);
    } catch (err: any) {
      if (err.status === 404) {
        setError('Event not found in this organization.');
      } else {
        setError(err.message || 'Failed to load analytics');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, eventId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link
        href="/admin/events"
        className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mb-6 inline-block"
      >
        ← Back to Events
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Event Analytics</h1>

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

      {/* Analytics */}
      {!loading && analytics && (
        <div>
          {/* Event Header */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                  {analytics.event.name}
                </h2>
                <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-slate-400 mt-1">
                  <span>📅 {formatDate(analytics.event.date)}</span>
                  {analytics.event.venue && <span>📍 {analytics.event.venue.name}</span>}
                  <span>Capacity: {analytics.event.capacity}</span>
                </div>
              </div>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium ${
                  analytics.event.status === 'PUBLISHED'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    : analytics.event.status === 'DRAFT'
                      ? 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {analytics.event.status}
              </span>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Tickets Sold"
              value={analytics.totals.sold}
              subtext={`of ${analytics.event.capacity} capacity`}
              color="indigo"
            />
            <StatCard
              label="Redeemed"
              value={analytics.totals.redeemed}
              subtext={
                analytics.totals.sold > 0
                  ? `${Math.round((analytics.totals.redeemed / analytics.totals.sold) * 100)}% scan rate`
                  : 'No tickets sold'
              }
              color="green"
            />
            <StatCard
              label="Remaining"
              value={analytics.totals.remaining}
              subtext="tickets available"
              color="blue"
            />
            <StatCard
              label="Revenue"
              value={formatCurrency(analytics.totals.revenue)}
              color="amber"
            />
          </div>

          {/* Per-Tier Breakdown */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                Per-Tier Breakdown
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-6 py-3">Tier</th>
                    <th className="px-6 py-3">Price</th>
                    <th className="px-6 py-3">Total</th>
                    <th className="px-6 py-3">Sold</th>
                    <th className="px-6 py-3">Redeemed</th>
                    <th className="px-6 py-3">Remaining</th>
                    <th className="px-6 py-3">Revenue</th>
                    <th className="px-6 py-3">Sell-through</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {analytics.tiers.map((tier) => {
                    const sellThrough =
                      tier.quantityTotal > 0
                        ? Math.round((tier.sold / tier.quantityTotal) * 100)
                        : 0;

                    return (
                      <tr key={tier.id} className="text-gray-900 dark:text-slate-100">
                        <td className="px-6 py-4 font-medium">{tier.name}</td>
                        <td className="px-6 py-4">{formatCurrency(tier.price)}</td>
                        <td className="px-6 py-4">{tier.quantityTotal}</td>
                        <td className="px-6 py-4">{tier.sold}</td>
                        <td className="px-6 py-4">{tier.redeemed}</td>
                        <td className="px-6 py-4">
                          <span
                            className={
                              tier.remaining === 0
                                ? 'text-red-600 dark:text-red-400 font-semibold'
                                : ''
                            }
                          >
                            {tier.remaining}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(tier.revenue)}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  sellThrough >= 90
                                    ? 'bg-red-500'
                                    : sellThrough >= 50
                                      ? 'bg-amber-500'
                                      : 'bg-indigo-600'
                                }`}
                                style={{ width: `${Math.min(sellThrough, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-slate-400 w-8">
                              {sellThrough}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
