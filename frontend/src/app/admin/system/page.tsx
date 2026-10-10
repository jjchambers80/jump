'use client';

// System administration › Overview: platform-wide counts and the latest
// organization signups (GET /admin/system/overview). Not org-scoped: the
// backend ignores X-Jump-Org here, so nothing refetches on an org switch.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Building2, ChevronRight, Hourglass, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { systemAdminApi, type SystemOverview } from '@/services/api';
import { useAccountFormat } from '@/lib/accountFormat';
import { Panel, Skeleton, timeAgo } from '../dashboard/ui';

const n = (value: number | undefined) => (value ?? 0).toLocaleString('en-US');

interface Tile {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
}

function tilesFrom(o: SystemOverview): Tile[] {
  return [
    {
      label: 'Organizations',
      value: n(o.organizations?.total),
      detail: `${n(o.organizations?.active)} active · ${n(o.organizations?.inactive)} suspended`,
      icon: Building2,
    },
    { label: 'Unfinished signups', value: n(o.organizations?.pending), detail: 'Setup not completed', icon: Hourglass },
    { label: 'Users', value: n(o.users?.total), detail: `${n(o.users?.inactive)} deactivated`, icon: Users },
    { label: 'System admins', value: n(o.users?.systemAdmins), icon: ShieldCheck },
  ];
}

const tileClass = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';

function StatTiles({ overview }: { overview: SystemOverview | null }) {
  if (!overview) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={tileClass}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4" data-testid="system-stat-tiles">
      {tilesFrom(overview).map(({ label, value, detail, icon: Icon }) => (
        <div key={label} className={tileClass}>
          <dt className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-slate-400">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{value}</dd>
          {detail && <dd className="mt-1 text-xs text-gray-500 dark:text-slate-400">{detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

function RecentSignups({ signups }: { signups: NonNullable<SystemOverview['recentSignups']> | null }) {
  const { formatDateTime } = useAccountFormat();
  return (
    <Panel id="recent-signups-heading" title="Recent signups" icon={<Building2 className="h-4 w-4" aria-hidden="true" />}>
      {!signups ? (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-4 py-3 sm:px-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </li>
          ))}
        </ul>
      ) : signups.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400 sm:px-5">
          No organizations have signed up yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
          {signups.map((org) => (
            <li key={org.id}>
              <Link
                href={`/admin/system/organizations/${org.id}`}
                className="flex min-h-[2.75rem] items-center gap-3 px-4 py-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-700/50 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{org.name}</p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {[org.owner?.email, org.slug && `/${org.slug}`].filter(Boolean).join(' · ') || ' '}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="text-gray-700 dark:text-slate-300">
                    <time dateTime={org.signedUpAt} title={formatDateTime(org.signedUpAt)}>
                      {timeAgo(org.signedUpAt)}
                    </time>
                  </p>
                  <p className="text-gray-500 dark:text-slate-400">
                    {org.onboardingCompletedAt ? 'Setup complete' : 'Setup in progress'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function SystemOverviewPage() {
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await systemAdminApi.overview());
    } catch (err: any) {
      setError(err?.message || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8" aria-busy={loading}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System administration</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Every organization and user on Eventimus.</p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={load}
            className="min-h-[2.75rem] rounded-md px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !overview && <p role="status" className="sr-only">Loading overview</p>}

      {/* On a failed first load the alert replaces the skeletons. */}
      {!(error && !overview) && (
        <div className="space-y-6">
          <section aria-labelledby="system-kpi-heading">
            <h2 id="system-kpi-heading" className="sr-only">
              Key numbers
            </h2>
            <StatTiles overview={overview} />
          </section>
          <RecentSignups signups={overview ? overview.recentSignups ?? [] : null} />
        </div>
      )}
    </div>
  );
}
