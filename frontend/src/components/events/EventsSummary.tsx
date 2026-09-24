'use client';

// KPI strip for the admin events list (spec 035 F3, D2).
// 4 cards: Registered, Published, Drafts, Available inventory.
// grid-cols-2 xl:grid-cols-4 gap-4. No trend in v1.

import {
  Users,
  CalendarCheck,
  FileEdit,
  Package,
} from 'lucide-react';

export interface EventsSummaryData {
  counts: { all: number; DRAFT: number; PUBLISHED: number; CANCELLED: number };
  published: { count: number; capacity: number };
  drafts: { count: number };
  registered: { tickets: number; rsvps: number };
  inventory: { available: number; tiers: number };
  /** Full distinct category list (never filtered, spec 035 §6.2). */
  categories: string[];
}

interface EventsSummaryProps {
  summary: EventsSummaryData | null;
  loading: boolean;
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle: string;
  loading: boolean;
}

function KpiCard({ icon, label, value, subtitle, loading }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          ) : (
            <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
          )}
          <p className="text-xs text-gray-400 dark:text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default function EventsSummary({ summary, loading }: EventsSummaryProps) {
  const registeredTotal = summary ? summary.registered.tickets + summary.registered.rsvps : 0;
  const registeredLabel = summary
    ? `tickets ${summary.registered.tickets} + RSVPs ${summary.registered.rsvps}`
    : 'tickets + RSVPs';

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiCard
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        label="Registered"
        value={loading ? '—' : registeredTotal.toLocaleString()}
        subtitle={loading ? '' : registeredLabel}
        loading={loading}
      />
      <KpiCard
        icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
        label="Published"
        value={loading ? '—' : summary?.published.count ?? 0}
        subtitle={loading ? '' : `capacity ${summary?.published.capacity?.toLocaleString() ?? 0}`}
        loading={loading}
      />
      <KpiCard
        icon={<FileEdit className="h-5 w-5" aria-hidden="true" />}
        label="Drafts"
        value={loading ? '—' : summary?.drafts.count ?? 0}
        subtitle="in progress"
        loading={loading}
      />
      <KpiCard
        icon={<Package className="h-5 w-5" aria-hidden="true" />}
        label="Available inventory"
        value={loading ? '—' : (summary?.inventory.available ?? 0).toLocaleString()}
        subtitle={loading ? '' : `across ${summary?.inventory.tiers ?? 0} tier${summary?.inventory.tiers === 1 ? '' : 's'}`}
        loading={loading}
      />
    </div>
  );
}