// Event Analytics page — admin area (T012)
// Moved from dashboard/events/[eventId]/analytics/page.tsx
// AdminRoute wrapper removed — layout.tsx handles auth guard
// Links updated from /dashboard/* to /admin/*
// Spec 012 phase 3: add-on sales table + purchasers CSV.

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import api from '@/services/api';
import type { AddOnSales } from '@/lib/addOns';
import { formatEventDateTime } from '@/lib/eventTime';

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
    venue: { id: string; name: string; timezone?: string | null } | null;
  };
  totals: {
    sold: number;
    redeemed: number;
    remaining: number;
    revenue: number;
  };
  /** Revenue by source (spec 018 phase 2). Ticket / add-on lines are already net of refunded lines. */
  revenue: {
    tickets: number;
    addOns: number;
    applications: number;
    applicationCount: number;
    applicationRefunds: number;
    net: number;
  };
  tiers: TierAnalytics[];
}

// Amounts from the API are dollars (Prisma Decimal), not cents.
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
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
  const { data: session } = useSession();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null);
  const [addOnSales, setAddOnSales] = useState<AddOnSales | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset when org changes
  useEffect(() => {
    setAnalytics(null);
    setAddOnSales(null);
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
      // Add-on sales are optional: an event without add-ons still renders.
      api
        .get<AddOnSales>(`/organizations/${selectedOrgId}/events/${eventId}/add-ons/sales`)
        .then(setAddOnSales)
        .catch(() => setAddOnSales(null));
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

  const downloadPurchasers = async () => {
    setCsvError(null);
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'}/organizations/${selectedOrgId}/events/${eventId}/add-ons/purchasers.csv`;
    const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    if (!res.ok) {
      setCsvError('Export failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `add-on-purchasers-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
                  <span>📅 {formatEventDateTime(analytics.event.date, analytics.event.venue?.timezone)}</span>
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
              value={formatCurrency(analytics.revenue?.net ?? analytics.totals.revenue)}
              subtext={analytics.revenue ? 'net of application refunds' : undefined}
              color="amber"
            />
          </div>

          {/* Revenue by source (spec 018 phase 2) */}
          {analytics.revenue && (
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden" data-testid="revenue-breakdown">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Revenue by source</h3>
              </div>
              <dl className="grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 dark:divide-slate-700/60">
                {[
                  { label: 'Tickets', value: analytics.revenue.tickets, hint: 'sold × listed price' },
                  { label: 'Add-ons', value: analytics.revenue.addOns, hint: 'sold lines, listed price' },
                  { label: 'Applications', value: analytics.revenue.applications, hint: `${analytics.revenue.applicationCount} paid` },
                  { label: 'Application refunds', value: -analytics.revenue.applicationRefunds, hint: 'returned to applicants' },
                  { label: 'Net', value: analytics.revenue.net, hint: 'tickets + add-ons + applications − refunds', strong: true },
                ].map((item) => (
                  <div key={item.label} className="px-6 py-4">
                    <dt className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">{item.label}</dt>
                    <dd className={`mt-1 text-lg ${item.strong ? 'font-bold' : 'font-semibold'} text-gray-900 dark:text-slate-100`}>
                      {item.value < 0 ? `−${formatCurrency(-item.value)}` : formatCurrency(item.value)}
                    </dd>
                    <dd className="text-xs text-gray-400 dark:text-slate-500">{item.hint}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

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

          {/* Add-on sales (spec 012) */}
          {addOnSales && addOnSales.addOns.length > 0 && (
            <div className="mt-6 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden" data-testid="add-on-sales">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Add-on sales</h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {addOnSales.totals.sold} sold · {addOnSales.totals.reserved} held · {formatCurrency(addOnSales.totals.revenue)} listed revenue
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {csvError && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{csvError}</span>}
                  <button
                    type="button"
                    onClick={downloadPurchasers}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    data-testid="add-on-purchasers-csv"
                  >
                    Purchasers CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="px-6 py-3">Add-on</th>
                      <th className="px-6 py-3">Price</th>
                      <th className="px-6 py-3">Sold</th>
                      <th className="px-6 py-3">With tickets</th>
                      <th className="px-6 py-3">With applications</th>
                      <th className="px-6 py-3">Held</th>
                      <th className="px-6 py-3">Remaining</th>
                      <th className="px-6 py-3">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {addOnSales.addOns.map((a) => (
                      <tr key={a.id} className={`text-gray-900 dark:text-slate-100 ${a.isActive ? '' : 'opacity-60'}`} data-testid={`add-on-sales-${a.id}`}>
                        <td className="px-6 py-4 font-medium">
                          {a.name}
                          {!a.isActive && <span className="ml-2 text-xs font-normal text-gray-500 dark:text-slate-400">inactive</span>}
                        </td>
                        <td className="px-6 py-4">{formatCurrency(a.price)}</td>
                        <td className="px-6 py-4">{a.sold}</td>
                        <td className="px-6 py-4">{a.orders.quantity}</td>
                        <td className="px-6 py-4">
                          {a.applications.quantity}
                          {a.applications.pending > 0 && (
                            <span className="ml-1 text-xs text-gray-500 dark:text-slate-400" title="On applications still under review">+{a.applications.pending} pending</span>
                          )}
                        </td>
                        <td className="px-6 py-4">{a.reserved}</td>
                        <td className="px-6 py-4">
                          {a.remaining === null ? <span className="text-gray-500 dark:text-slate-400">∞</span> : <span className={a.remaining === 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>{a.remaining}</span>}
                        </td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(a.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
