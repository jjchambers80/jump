'use client';

// Events page header: icon tile, h1, total pill, subtitle, Export CSV, Create Event button.
// Matches the EventFormShell shell pattern mx-auto w-full max-w-screen-2xl px-4 sm:px-6.

import Link from 'next/link';
import { Calendar, Download } from 'lucide-react';
import { downloadCsv } from '@/services/api';

interface EventsPageHeaderProps {
  selectedOrgId: string | null;
  total: number;
  /** Current URL search params (status, q, category, sort) to pass to the CSV export. */
  filterParams?: string;
}

export default function EventsPageHeader({ selectedOrgId, total, filterParams = '' }: EventsPageHeaderProps) {
  const handleExportCsv = async () => {
    if (!selectedOrgId) return;
    try {
      const query = filterParams ? `?${filterParams}` : '';
      await downloadCsv(
        `/organizations/${selectedOrgId}/events/export.csv${query}`,
        `events-export-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      // Silently fail — the download function logs errors
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800">
          <Calendar className="h-5 w-5 text-gray-500 dark:text-slate-400" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
            <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-gray-600 dark:text-slate-300 tabular-nums">
              {total} total
            </span>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">
            Manage, publish and track your events
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {selectedOrgId && (
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            aria-label="Export events list as CSV"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        )}
        <Link
          href="/admin/events/new"
          className="inline-flex min-h-11 items-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          Create Event
        </Link>
      </div>
    </div>
  );
}