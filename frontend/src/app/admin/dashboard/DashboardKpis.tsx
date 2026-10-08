// Headline numbers: revenue, tickets, check-ins and recent orders.
// Two columns on phones, four from lg. A description list so each value is
// read with its label.

import { DollarSign, ScanLine, ShoppingBag, Ticket, type LucideIcon } from 'lucide-react';
import type { DashboardOverview, DashboardStats } from '@/services/adminService';
import { Skeleton, formatMoney } from './ui';

interface Kpi {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
}

function kpisFrom(stats: DashboardStats, overview: DashboardOverview | null): Kpi[] {
  const orders14 = overview?.trend.reduce((sum, d) => sum + d.orders, 0) ?? 0;
  const revenue14 = overview?.trend.reduce((sum, d) => sum + d.revenue, 0) ?? 0;
  return [
    {
      label: 'Gross revenue',
      value: formatMoney(stats.revenue?.gross ?? 0),
      detail: stats.revenue
        ? `${formatMoney(stats.revenue.orders)} orders · ${formatMoney(stats.revenue.applications)} applications`
        : undefined,
      icon: DollarSign,
    },
    {
      label: 'Tickets sold',
      value: (stats.ticketsSold ?? 0).toLocaleString('en-US'),
      detail: `${(stats.remainingCapacity ?? 0).toLocaleString('en-US')} still available`,
      icon: Ticket,
    },
    {
      label: 'Checked in',
      value: (stats.ticketsRedeemed ?? 0).toLocaleString('en-US'),
      detail: overview ? `${overview.checkedInLast24h.toLocaleString('en-US')} in the last 24 hours` : undefined,
      icon: ScanLine,
    },
    {
      label: 'Orders, last 14 days',
      value: orders14.toLocaleString('en-US'),
      detail: `${formatMoney(revenue14)} · ${stats.paymentSuccessRate ?? 100}% payment success`,
      icon: ShoppingBag,
    },
  ];
}

export default function DashboardKpis({ stats, overview }: { stats: DashboardStats | null; overview: DashboardOverview | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="dashboard-kpis">
      {kpisFrom(stats, overview).map(({ label, value, detail, icon: Icon }) => (
        <div key={label} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <dt className="flex items-start justify-between gap-2 text-sm font-medium text-gray-600 dark:text-slate-300">
            {label}
            <span className="hidden h-8 w-8 shrink-0 sm:flex items-center justify-center rounded-md bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-400">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          </dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</dd>
          {detail && <dd className="mt-1 text-xs text-gray-500 dark:text-slate-400">{detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
