// Admin dashboard: the organizer's bird's-eye view of the active
// organization. Banners for anything blocking, then headline numbers, the
// 14-day sales trend, upcoming events, what needs attention and the latest
// orders. One column on phones; main + side column from lg.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, Plus, RefreshCw, ScanLine } from 'lucide-react';
import adminService, { DashboardOverview, DashboardStats } from '@/services/adminService';
import { useOrg } from '@/components/OrgContext';
import PublishBlockers from '@/components/events/PublishBlockers';
import { publishBlockers, type ReadinessItem } from '@/lib/eventReadiness';
import { useAccountFormat } from '@/lib/accountFormat';
import PayoutsBanner from './PayoutsBanner';
import SetupGuide from './SetupGuide';
import PlanBanner from './PlanBanner';
import DashboardKpis from './DashboardKpis';
import SalesTrend from './SalesTrend';
import UpcomingEvents from './UpcomingEvents';
import NeedsAttention from './NeedsAttention';
import RecentOrders from './RecentOrders';

const REFRESH_MS = 30_000;

export default function DashboardPage() {
  const { data: session } = useSession();
  const { selectedOrgId, selectedOrg, loading: orgLoading } = useOrg();
  const { prefs, formatDateTime } = useAccountFormat();
  const timeZone = prefs.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ eventId: string; items: ReadinessItem[] } | null>(null);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    // Settled separately: one failing panel never blanks the others.
    const [statsResult, overviewResult] = await Promise.allSettled([
      adminService.getDashboardStats(),
      adminService.getDashboardOverview(timeZone),
    ]);
    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    // Shape check: an older backend (or a catch-all mock) answers without the overview fields.
    if (overviewResult.status === 'fulfilled' && Array.isArray(overviewResult.value?.trend)) setOverview(overviewResult.value);
    const failed = [statsResult, overviewResult].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    setError(failed ? failed.reason?.message || 'Could not load the dashboard.' : '');
    if (!failed) setUpdatedAt(new Date());
    setRefreshing(false);
  }, [timeZone]);

  // Reload on org switch; then poll while the tab is visible.
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    setStats(null);
    setOverview(null);
    fetchData();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, fetchData]);

  const handlePublish = async (eventId: string) => {
    if (!selectedOrgId) return;
    setPublishingId(eventId);
    setBlockers(null);
    try {
      await adminService.publishEvent(selectedOrgId, eventId);
      await fetchData();
    } catch (err: any) {
      const found = publishBlockers(err);
      if (found) setBlockers({ eventId, items: found });
      else setError(err.message || 'Could not publish the event.');
    } finally {
      setPublishingId(null);
    }
  };

  const firstName = session?.user?.name?.split(' ')[0];

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Welcome back{firstName ? `, ${firstName}` : ''}
          </p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          {selectedOrg && <p className="text-sm text-gray-500 dark:text-slate-400">{selectedOrg.name}</p>}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link
            href="/admin/orders/scan"
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:flex-none"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            Check in
          </Link>
          <Link
            href="/admin/create-event"
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 sm:flex-none"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create event
          </Link>
        </div>
      </header>

      <PlanBanner />
      <PayoutsBanner />
      <SetupGuide />

      {error && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="min-h-[2.75rem] rounded-md px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Try again
          </button>
        </div>
      )}

      <div className="space-y-6">
        <section aria-labelledby="kpi-heading">
          <h2 id="kpi-heading" className="sr-only">
            Key numbers
          </h2>
          <DashboardKpis stats={stats} overview={overview} />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Attention first on phones: it is what to do next. */}
          <div className="space-y-6 lg:order-2">
            {blockers && <PublishBlockers blockers={blockers.items} eventId={blockers.eventId} orgId={selectedOrgId} />}
            <NeedsAttention attention={overview?.attention ?? null} publishingId={publishingId} onPublish={handlePublish} />
            <RecentOrders orders={overview?.recentOrders ?? null} />
          </div>
          <div className="space-y-6 lg:order-1 lg:col-span-2">
            <SalesTrend trend={overview?.trend ?? null} />
            <UpcomingEvents events={overview?.upcoming ?? null} />
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-slate-400">
        {updatedAt && <span>Updated {formatDateTime(updatedAt, { timeStyle: 'short' })}</span>}
        <button
          type="button"
          onClick={fetchData}
          disabled={refreshing}
          className="inline-flex min-h-[2.75rem] items-center gap-1 rounded-md px-2 font-medium text-gray-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-60 dark:text-slate-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>
    </div>
  );
}
