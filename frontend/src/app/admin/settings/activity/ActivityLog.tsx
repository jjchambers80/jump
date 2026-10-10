'use client';

import { useCallback, useEffect, useState } from 'react';
import { DownloadIcon } from 'lucide-react';
import { useOrg } from '@/components/OrgContext';
import { useAccountFormat } from '@/lib/accountFormat';
import { auditLogApi, type AuditLogEntry, type AuditLogFilters, type AuditLogResponse, type AuditOperation } from '@/services/api';
import { errorMessage } from '../users/shared';
import ActivityEntry from './ActivityEntry';

const PAGE = 50;
const OPERATIONS: { value: AuditOperation | ''; label: string }[] = [
  { value: '', label: 'All actions' },
  { value: 'CREATE', label: 'Created' },
  { value: 'UPDATE', label: 'Updated' },
  { value: 'DELETE', label: 'Deleted' },
  { value: 'EXPORT', label: 'Downloaded' },
];

const field = 'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400';
const secondaryBtn = 'inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

/** `yyyy-mm-dd` from a date input → the start or end of that day, local time. */
const dayBound = (day: string, end: boolean) => (day ? new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

/**
 * The audit trail list with filters, load more and CSV export. Settings ›
 * Activity log shows the whole organization; the event workspace's History
 * tab passes `eventId` and its own heading (the workspace header's <h1>).
 */
export default function ActivityLog({ eventId, showHeading = true }: { eventId?: string; showHeading?: boolean }) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { formatDateTime } = useAccountFormat();
  const [q, setQ] = useState('');
  const [feature, setFeature] = useState('');
  const [actor, setActor] = useState('');
  const [operation, setOperation] = useState<AuditOperation | ''>('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The actor select carries "type:userId" so system actors (no user id) filter by type.
  const [actorType, actorUserId] = actor ? actor.split(':') : ['', ''];
  const filters: AuditLogFilters = {
    q: q.trim() || undefined,
    feature: feature || undefined,
    operation: operation || undefined,
    actorType: (actorType || undefined) as AuditLogFilters['actorType'],
    actorUserId: actorUserId || undefined,
    from: dayBound(fromDay, false),
    to: dayBound(toDay, true),
    eventId,
  };
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await auditLogApi.list({ ...JSON.parse(filterKey), offset, limit: PAGE });
      setData(page);
      setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
    } catch (e) {
      setError(errorMessage(e, 'Could not load the activity log.'));
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    if (orgLoading) return;
    const timer = setTimeout(() => void load(0), 250); // debounce typing in search
    return () => clearTimeout(timer);
  }, [load, orgLoading, selectedOrgId]);

  const exportCsv = async () => {
    try {
      await auditLogApi.exportCsv(filters);
    } catch (e) {
      setError(errorMessage(e, 'Could not download the activity log.'));
    }
  };

  return (
    <section className="min-w-0 flex-1 space-y-4" {...(showHeading ? { 'aria-labelledby': 'activity-heading' } : { 'aria-label': 'Event history' })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {showHeading && <h2 id="activity-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Activity log</h2>}
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {eventId
              ? 'Every change to this event, its tickets, add-ons, forms, map and orders, by staff, the CLI, connected agents, Stripe and scheduled jobs.'
              : 'Every change made in this store by staff, the CLI, connected agents, Stripe and scheduled jobs, and every file downloaded.'}
            {data && ` Kept for ${Math.round(data.retentionDays / 30.4)} months.`}
          </p>
        </div>
        <button type="button" onClick={exportCsv} className={secondaryBtn} disabled={!rows.length}>
          <DownloadIcon aria-hidden className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="activity-q" className={label}>Search records</label>
          <input id="activity-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Event, page, customer email…" className={field} />
        </div>
        <div>
          <label htmlFor="activity-actor" className={label}>Who</label>
          <select id="activity-actor" value={actor} onChange={(e) => setActor(e.target.value)} className={field}>
            <option value="">Everyone</option>
            {data?.facets.actors.map((a) => (
              <option key={`${a.type}:${a.userId ?? a.label}`} value={`${a.type}:${a.userId ?? ''}`}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="activity-feature" className={label}>Area</label>
          <select id="activity-feature" value={feature} onChange={(e) => setFeature(e.target.value)} className={field}>
            <option value="">All areas</option>
            {data?.facets.features.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="activity-operation" className={label}>Action</label>
          <select id="activity-operation" value={operation} onChange={(e) => setOperation(e.target.value as AuditOperation | '')} className={field}>
            {OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="activity-from" className={label}>From</label>
          <input id="activity-from" type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="activity-to" className={label}>To</label>
          <input id="activity-to" type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={field} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/30 dark:text-red-200">{error}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {loading && !rows.length ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading activity">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />)}
          </div>
        ) : rows.length === 0 ? (
          <p role="status" className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-400">No activity matches these filters.</p>
        ) : (
          <>
            <p className="sr-only" role="status">{data?.total} entries</p>
            <ul className="divide-y divide-gray-100 dark:divide-slate-700">
              {rows.map((entry) => <ActivityEntry key={entry.id} entry={entry} when={formatDateTime(entry.createdAt)} />)}
            </ul>
          </>
        )}
      </div>

      {data && rows.length < data.total && (
        <div className="text-center">
          <button type="button" onClick={() => void load(rows.length)} disabled={loading} className={secondaryBtn}>
            {loading ? 'Loading…' : `Load more (${data.total - rows.length} older)`}
          </button>
        </div>
      )}
    </section>
  );
}
