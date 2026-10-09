'use client';

// 14-day sales chart: one bar per day in the viewer's zone, revenue or
// tickets. The bars are decorative for assistive tech; the same numbers are
// in a visually hidden table.

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { DashboardOverview } from '@/services/adminService';
import { Panel, PanelLink, Skeleton, formatMoney } from './ui';

type Metric = 'revenue' | 'tickets';

/** "2026-10-08" → "Oct 8" (the key is already a calendar day; format it in UTC). */
function dayLabel(key: string, weekday = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(weekday ? { weekday: 'short' } : {}),
  }).format(new Date(`${key}T12:00:00Z`));
}

export default function SalesTrend({ trend }: { trend: DashboardOverview['trend'] | null }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const days = trend ?? [];
  const values = days.map((d) => d[metric]);
  const max = Math.max(...values, 0);
  const total = values.reduce((sum, v) => sum + v, 0);
  const show = (v: number) => (metric === 'revenue' ? formatMoney(v) : v.toLocaleString('en-US'));

  const toggle = (
    <div role="group" aria-label="Chart metric" className="inline-flex rounded-md border border-gray-300 p-0.5 dark:border-slate-600">
      {([['revenue', 'Revenue'], ['tickets', 'Tickets']] as [Metric, string][]).map(([m, label]) => (
        <button
          key={m}
          type="button"
          aria-pressed={metric === m}
          onClick={() => setMetric(m)}
          className={`min-h-[2.25rem] rounded px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
            metric === m
              ? 'bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Panel
      id="sales-trend-heading"
      title="Sales, last 14 days"
      icon={<TrendingUp className="h-4 w-4 text-gray-500 dark:text-slate-400" aria-hidden="true" />}
      action={toggle}
    >
      <div className="px-4 pb-4 pt-3 sm:px-5" data-testid="sales-trend">
        {!trend ? (
          <Skeleton className="h-44 w-full" />
        ) : days.length === 0 ? (
          <p className="py-6 text-sm text-gray-500 dark:text-slate-400">No sales yet.</p>
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{show(total)}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {metric === 'revenue' ? 'gross collected' : 'tickets sold'} · {dayLabel(days[0].date)} – {dayLabel(days[days.length - 1].date)}
            </p>

            <div aria-hidden="true" className="mt-4 flex h-36 items-end gap-1 border-b border-gray-200 dark:border-slate-700 sm:h-44 sm:gap-1.5">
              {days.map((d) => {
                const value = d[metric];
                const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
                return (
                  <div key={d.date} className="flex h-full flex-1 items-end" title={`${dayLabel(d.date, true)}: ${show(value)}`}>
                    <div
                      className={`w-full rounded-t-sm ${value > 0 ? 'bg-accent-600 dark:bg-accent-400' : 'bg-gray-200 dark:bg-slate-700'}`}
                      style={{ height: value > 0 ? `${pct}%` : '2px' }}
                    />
                  </div>
                );
              })}
            </div>
            <div aria-hidden="true" className="mt-1.5 flex justify-between text-xs text-gray-500 dark:text-slate-400">
              <span>{dayLabel(days[0].date)}</span>
              <span className="hidden sm:inline">{dayLabel(days[Math.floor(days.length / 2)].date)}</span>
              <span>Today</span>
            </div>

            {/* sr-only on the table itself fails: tables ignore height:1px, and the
                full-height table stretched the page past the admin shell. */}
            <div className="sr-only">
              <table>
                <caption>{metric === 'revenue' ? 'Revenue' : 'Tickets sold'} per day, last 14 days</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">{metric === 'revenue' ? 'Revenue' : 'Tickets'}</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{dayLabel(d.date, true)}</th>
                      <td>{show(d[metric])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total === 0 && (
              <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">No sales in the last 14 days.</p>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end border-t border-gray-200 px-2 dark:border-slate-700">
        <PanelLink href="/admin/analytics" label="Open analytics">
          Analytics
        </PanelLink>
      </div>
    </Panel>
  );
}
