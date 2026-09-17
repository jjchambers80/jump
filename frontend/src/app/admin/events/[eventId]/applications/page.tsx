// Admin › Event › Applications (spec 011): filterable list with status
// summary, bulk decisions and CSV export. Filters live in the URL so a view
// can be shared and the browser back button works.
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  DECISION_LABEL,
  formatDate,
  money,
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  type AdminForm,
  type ApplicationList,
  type ApplicationStatus,
  type Decision,
} from '@/lib/applications';
import ApplicationsHeader from './ApplicationsHeader';
import { describeError, useApplicationsApi, type ListQuery } from './useApplicationsApi';

const STATUS_ORDER: ApplicationStatus[] = ['SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

// Saved views (phase 3): named filter sets kept per event in this browser.
// The URL stays the shareable form; a view is a shortcut to one.
interface SavedView {
  name: string;
  query: Omit<ListQuery, 'page'>;
}
const savedViewsKey = (eventId: string) => `jump.applications.views.${eventId}`;
function readSavedViews(eventId: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(savedViewsKey(eventId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === 'string' && v.query && typeof v.query === 'object') : [];
  } catch {
    return [];
  }
}
function writeSavedViews(eventId: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(savedViewsKey(eventId), JSON.stringify(views));
  } catch {
    // Private mode or quota: views are a convenience, the URL still works.
  }
}
const viewKey = (q: Omit<ListQuery, 'page'>) => JSON.stringify({ form: q.form || '', status: q.status || '', payment: q.payment || '', q: q.q || '', sort: q.sort || '' });
const select = 'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

function ApplicationsListContent({ eventId }: { eventId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apiClient = useApplicationsApi(eventId);
  const { data: session } = useSession();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;

  const query: ListQuery = useMemo(
    () => ({
      form: searchParams.get('form') || undefined,
      status: searchParams.get('status') || undefined,
      payment: searchParams.get('payment') || undefined,
      q: searchParams.get('q') || undefined,
      sort: searchParams.get('sort') || undefined,
      page: Number(searchParams.get('page') || 1),
    }),
    [searchParams]
  );

  const [list, setList] = useState<ApplicationList | null>(null);
  const [forms, setForms] = useState<AdminForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(query.q || '');
  const setQuery = useCallback(
    (patch: Partial<ListQuery>) => {
      // Read the live URL, not the render-time params: two quick changes
      // (clear a filter, then search) must not resurrect the first one.
      const next = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : searchParams.toString());
      for (const [k, v] of Object.entries({ ...patch, page: patch.page ?? 1 })) {
        if (v === undefined || v === '' || v === null) next.delete(k);
        else next.set(k, String(v));
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    setViews(readSavedViews(eventId));
  }, [eventId]);
  const { page: _page, ...currentFilters } = query;
  const activeView = views.find((v) => viewKey(v.query) === viewKey(currentFilters));
  const hasFilters = Boolean(currentFilters.form || currentFilters.status || currentFilters.payment || currentFilters.q || currentFilters.sort);

  const saveView = () => {
    const name = window.prompt('Name this view', activeView?.name || '')?.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, query: currentFilters }];
    setViews(next);
    writeSavedViews(eventId, next);
  };
  const deleteView = () => {
    if (!activeView || !window.confirm(`Delete the "${activeView.name}" view?`)) return;
    const next = views.filter((v) => v.name !== activeView.name);
    setViews(next);
    writeSavedViews(eventId, next);
  };
  const applyView = (name: string) => {
    const v = views.find((x) => x.name === name);
    if (!v) return;
    setSearch(v.query.q || '');
    setQuery({ form: v.query.form, status: v.query.status, payment: v.query.payment, q: v.query.q, sort: v.query.sort, page: 1 });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, f] = await Promise.all([apiClient.list(query), apiClient.forms()]);
      setList(l);
      setForms(f.data);
      setSelected(new Set());
    } catch (err) {
      setError(describeError(err, 'Could not load applications'));
    }
  }, [apiClient, query]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAll = (on: boolean) => setSelected(on ? new Set(list?.data.map((r) => r.id) ?? []) : new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (decision: Decision) => {
    if (selected.size === 0 || busy) return;
    if (!window.confirm(`${DECISION_LABEL[decision]} ${selected.size} application${selected.size === 1 ? '' : 's'}? Each applicant will be emailed.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiClient.bulk({ ids: [...selected], decision });
      const failures = res.results.filter((r) => !r.ok);
      setNotice(`${res.succeeded} ${decision.toLowerCase()}${res.succeeded === 1 ? 'd' : 'd'}${failures.length ? `; ${failures.length} skipped: ${failures.map((f) => f.error).slice(0, 3).join(' · ')}` : ''}`);
      await load();
    } catch (err) {
      setError(describeError(err, 'Bulk action failed'));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'}${apiClient.exportUrl(query)}`;
    const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    if (!res.ok) {
      setError('Export failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `applications-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selectedPaid = (list?.data ?? []).some((r) => selected.has(r.id) && r.formKind === 'PAID');
  const summary = list?.summary ?? {};
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ApplicationsHeader eventId={eventId} />

      {/* Status summary */}
      <div className="mb-4 flex flex-wrap gap-2" data-testid="applications-summary">
        <button type="button" onClick={() => setQuery({ status: undefined })} className={`${btn} ${!query.status ? 'ring-2 ring-indigo-500' : ''}`}>
          All {Object.values(summary).reduce((s, n) => s + n, 0)}
        </button>
        {STATUS_ORDER.map((s) => (
          <button key={s} type="button" onClick={() => setQuery({ status: s })} className={`${btn} ${query.status === s ? 'ring-2 ring-indigo-500' : ''}`}>
            {STATUS_LABEL[s]} <span className="ml-1 text-gray-500 dark:text-slate-400">{summary[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ q: search });
        }}
      >
        <select aria-label="Form" value={query.form || ''} onChange={(e) => setQuery({ form: e.target.value || undefined })} className={select}>
          <option value="">All forms</option>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select aria-label="Payment" value={query.payment || ''} onChange={(e) => setQuery({ payment: e.target.value || undefined })} className={select}>
          <option value="">Any payment</option>
          {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={query.sort || ''} onChange={(e) => setQuery({ sort: e.target.value || undefined })} className={select}>
          <option value="">Newest first</option>
          <option value="submitted_asc">Oldest first</option>
          <option value="business">Business A–Z</option>
          <option value="status">By status</option>
        </select>
        <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business or contact" className={`${select} w-56`} />
        <button type="submit" className={btn}>
          Search
        </button>
        <span className="flex-1" />
        {views.length > 0 && (
          <select aria-label="Saved views" value={activeView?.name ?? ''} onChange={(e) => applyView(e.target.value)} className={select} data-testid="applications-saved-views">
            <option value="">Saved views…</option>
            {views.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {hasFilters && !activeView && (
          <button type="button" onClick={saveView} className={btn} data-testid="applications-save-view">
            Save view
          </button>
        )}
        {activeView && (
          <button type="button" onClick={deleteView} className={btn} title={`Delete the "${activeView.name}" view`}>
            Delete view
          </button>
        )}
        <button type="button" onClick={exportCsv} className={btn} data-testid="applications-export">
          Export CSV
        </button>
      </form>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2 text-sm dark:bg-indigo-900/20" data-testid="applications-bulk-bar">
          <span className="font-semibold text-indigo-900 dark:text-indigo-200">{selected.size} selected</span>
          {(['APPROVE', 'WAITLIST', 'REJECT'] as Decision[]).map((d) => {
            const paidApprove = d === 'APPROVE' && selectedPaid;
            return (
              <button key={d} type="button" disabled={busy || paidApprove} title={paidApprove ? 'Paid applications are approved one at a time — each approval charges the saved card' : undefined} onClick={() => bulk(d)} className={btn}>
                {DECISION_LABEL[d]}
              </button>
            );
          })}
          {selectedPaid && <span className="text-xs text-indigo-800 dark:text-indigo-300">Approve paid applications from their detail page.</span>}
          <button type="button" onClick={() => toggleAll(false)} className="text-indigo-700 hover:underline dark:text-indigo-300">
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700" data-testid="applications-table">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-900/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" aria-label="Select all" checked={!!list && list.data.length > 0 && selected.size === list.data.length} onChange={(e) => toggleAll(e.target.checked)} />
              </th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Submitted</th>
              <th className="px-3 py-2">Booth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {list?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-600 dark:text-slate-400">
                  No applications match. {forms.length === 0 && (
                    <Link href={`/admin/events/${eventId}/applications/forms`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                      Create a form
                    </Link>
                  )}
                </td>
              </tr>
            )}
            {list?.data.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40" data-testid={`application-row-${row.id}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${row.businessName}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/events/${eventId}/applications/${row.id}`} className="font-medium text-gray-900 hover:underline dark:text-white">
                    {row.businessName}
                  </Link>
                  <div className="text-xs text-gray-600 dark:text-slate-400">
                    {row.contact.firstName} {row.contact.lastName} · {row.contact.email}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-800 dark:text-slate-200">
                  {row.formName}
                  {row.tier && <div className="text-xs text-gray-600 dark:text-slate-400">{row.tier.name}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                </td>
                <td className="px-3 py-2">
                  {row.formKind === 'PAID' ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STYLE[row.paymentStatus]}`}>
                      {PAYMENT_LABEL[row.paymentStatus]}
                      {row.applicantPays > 0 ? ` · ${money(row.applicantPays)}` : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{formatDate(row.submittedAt, true)}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{row.boothLabel ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list && list.total > list.pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-700 dark:text-slate-300">
          <span>
            {list.total} total · page {list.page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={list.page <= 1} onClick={() => setQuery({ page: list.page - 1 })}>
              Previous
            </button>
            <button type="button" className={btn} disabled={list.page >= totalPages} onClick={() => setQuery({ page: list.page + 1 })}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApplicationsListPage({ params }: { params: { eventId: string } }) {
  return (
    <Suspense fallback={null}>
      <ApplicationsListContent eventId={params.eventId} />
    </Suspense>
  );
}
