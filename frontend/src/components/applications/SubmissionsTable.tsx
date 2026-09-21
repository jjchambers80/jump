'use client';

// The submissions table (spec 019): one component for the organization-wide
// Participants list (`/admin/participants`, no `eventId`) and the per-event
// Applications tab (`eventId` given — no Event filter or column, everything
// else identical). Filters live in the URL so a view can be shared and the
// browser back button works; search / filter / sort are server-side.

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import {
  addOnSummary,
  DECISION_LABEL,
  formatDate,
  money,
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  type AdminApplication,
  type ApplicationList,
  type ApplicationRow,
  type ApplicationStatus,
  type Decision,
} from '@/lib/applications';
import { readSavedViews, viewKey, writeSavedViews, type SavedView } from '@/lib/savedViews';
import DecisionDialog from '@/app/admin/events/[eventId]/applications/DecisionDialog';
import { describeError, patchApplicationMeta, useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import EditTagsDialog from './EditTagsDialog';
import { useParticipantsApi, type ParticipantsQuery } from '@/app/admin/participants/useParticipantsApi';
import BusinessCell from './BusinessCell';
import RowActionsMenu from './RowActionsMenu';

const STATUS_ORDER: ApplicationStatus[] = ['SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
/** Organization mount page size (plan §7.4); the per-event mount keeps the API default. */
const ORG_PAGE_SIZE = 25;
type Filters = Omit<ParticipantsQuery, 'page' | 'pageSize'>;
const FILTER_KEYS: (keyof Filters)[] = ['event', 'form', 'status', 'payment', 'addOn', 'tag', 'booth', 'q', 'sort'];
const DECIDED: Record<Decision, string> = { APPROVE: 'approved', REJECT: 'rejected', WAITLIST: 'waitlisted', WITHDRAW: 'withdrawn' };

/** The subset of a form the filters need, common to the per-event and org-wide form lists. */
interface FilterForm {
  id: string;
  name: string;
  eventId?: string;
  event?: { id: string; name: string; date: string };
  addOns?: { id: string; name: string }[];
  /** Per-event forms carry every question; the org-wide list only the pinned ones. */
  questions?: { id: string; label: string; pinned?: boolean }[];
  pinnedQuestions?: { id: string; label: string }[];
}

const select = 'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const chip = 'inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200';
const tagChip = 'inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200';
const heldChip = 'inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';

/**
 * Booth column (spec 014 phase 2): the owned booth, a HELD one mid-purchase,
 * "Not chosen" for an approved vendor on a map-bound tier, the typed
 * placement for everyone else.
 */
function BoothCell({ row }: { row: ApplicationRow }) {
  if (row.booth?.status === 'HELD') return <span className={heldChip}>Held · {row.booth.label}</span>;
  if (row.booth) return <span className={chip}>{row.booth.label}</span>;
  if (row.boothLabel) return <span className={chip}>{row.boothLabel}</span>;
  if (row.mapBound && row.status === 'APPROVED') return <span className="text-xs text-gray-500 dark:text-slate-400">Not chosen</span>;
  return <span className="text-gray-400 dark:text-slate-500">—</span>;
}

function submittedLines(value: string | null) {
  if (!value) return ['', ''];
  const d = new Date(value);
  return [d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()];
}

export default function SubmissionsTable({ eventId }: { eventId?: string }) {
  const orgWide = !eventId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const eventApi = useApplicationsApi(eventId ?? '');
  const orgApi = useParticipantsApi();
  const { data: session } = useSession();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;

  const query: ParticipantsQuery = useMemo(
    () => ({
      ...(orgWide ? { event: searchParams.get('event') || undefined } : {}),
      form: searchParams.get('form') || undefined,
      status: searchParams.get('status') || undefined,
      payment: searchParams.get('payment') || undefined,
      addOn: searchParams.get('addOn') || undefined,
      tag: searchParams.get('tag') || undefined,
      booth: (['none', 'chosen'].includes(searchParams.get('booth') ?? '') ? searchParams.get('booth') : undefined) as 'none' | 'chosen' | undefined,
      q: searchParams.get('q') || undefined,
      sort: searchParams.get('sort') || undefined,
      page: Number(searchParams.get('page') || 1),
    }),
    [searchParams, orgWide]
  );

  const [list, setList] = useState<ApplicationList | null>(null);
  const [forms, setForms] = useState<FilterForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(query.q || '');
  const [decision, setDecision] = useState<{ row: ApplicationRow; application: AdminApplication; decision: Decision } | null>(null);
  const decisionTriggerRef = useRef<HTMLButtonElement>(null);
  // Phase 3: tags in scope (filter + autocomplete), the Edit tags dialog, in-flight check-in toggles.
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [editingTags, setEditingTags] = useState<ApplicationRow | null>(null);
  const tagsTriggerRef = useRef<HTMLButtonElement>(null);
  const [checkBusy, setCheckBusy] = useState<Set<string>>(new Set());

  const setQuery = useCallback(
    (patch: Partial<ParticipantsQuery>) => {
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

  // Saved views: per event as before (spec 011), one set for the org list.
  const viewsKey = orgWide ? 'jump.participants.views.org' : `jump.applications.views.${eventId}`;
  const keyOf = (q: Filters) => viewKey(q, orgWide ? FILTER_KEYS : FILTER_KEYS.filter((k) => k !== 'event'));
  const [views, setViews] = useState<SavedView<Filters>[]>([]);
  useEffect(() => {
    setViews(readSavedViews<Filters>(viewsKey));
  }, [viewsKey]);
  const { page: _page, pageSize: _pageSize, ...currentFilters } = query;
  const activeView = views.find((v) => keyOf(v.query) === keyOf(currentFilters));
  const hasFilters = FILTER_KEYS.some((k) => Boolean(currentFilters[k]));

  const saveView = () => {
    const name = window.prompt('Name this view', activeView?.name || '')?.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, query: currentFilters }];
    setViews(next);
    writeSavedViews(viewsKey, next);
  };
  const deleteView = () => {
    if (!activeView || !window.confirm(`Delete the "${activeView.name}" view?`)) return;
    const next = views.filter((v) => v.name !== activeView.name);
    setViews(next);
    writeSavedViews(viewsKey, next);
  };
  const applyView = (name: string) => {
    const v = views.find((x) => x.name === name);
    if (!v) return;
    setSearch(v.query.q || '');
    setQuery({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, v.query[k]])), page: 1 });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, f] = orgWide
        ? await Promise.all([orgApi.list({ ...query, pageSize: ORG_PAGE_SIZE }), orgApi.forms()])
        : await Promise.all([eventApi.list(query), eventApi.forms()]);
      setList(l);
      setForms(f.data as FilterForm[]);
      setSelected(new Set());
    } catch (err) {
      setError(describeError(err, 'Could not load applications'));
    }
  }, [orgWide, orgApi, eventApi, query]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTags = useCallback(async () => {
    try {
      const r = orgWide ? await orgApi.tags() : await eventApi.tags();
      setTagOptions(r.data);
    } catch {
      setTagOptions([]);
    }
  }, [orgWide, orgApi, eventApi]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const patchRow = (next: AdminApplication) =>
    setList((prev) =>
      prev
        ? { ...prev, data: prev.data.map((r) => (r.id === next.id ? { ...r, status: next.status, paymentStatus: next.paymentStatus, decidedAt: next.decidedAt, boothLabel: next.boothLabel, booth: next.booth ? { id: next.booth.id, label: next.booth.label, status: next.booth.status } : null, tags: next.tags ?? [], checkedInAt: next.checkedInAt ?? null, checkedOutAt: next.checkedOutAt ?? null } : r)) }
        : prev
    );

  // Optimistic check-in tick; reverted on error.
  const toggleCheck = async (row: ApplicationRow, field: 'checkedIn' | 'checkedOut', value: boolean) => {
    const column = field === 'checkedIn' ? 'checkedInAt' : 'checkedOutAt';
    const before = row[column];
    setList((prev) => (prev ? { ...prev, data: prev.data.map((r) => (r.id === row.id ? { ...r, [column]: value ? before ?? new Date().toISOString() : null } : r)) } : prev));
    setCheckBusy((prev) => new Set(prev).add(row.id));
    setError(null);
    try {
      patchRow(await patchApplicationMeta(row.eventId ?? eventId ?? '', row.id, { [field]: value }));
    } catch (err) {
      setList((prev) => (prev ? { ...prev, data: prev.data.map((r) => (r.id === row.id ? { ...r, [column]: before } : r)) } : prev));
      setError(describeError(err, 'Could not update check-in'));
    } finally {
      setCheckBusy((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const refreshSummary = async () => {
    try {
      const summary = orgWide ? await orgApi.summary() : await eventApi.summary();
      setList((prev) => (prev ? { ...prev, summary } : prev));
    } catch {
      // The chips are advisory; the next load refreshes them.
    }
  };

  const toggleAll = (on: boolean) => setSelected(on ? new Set(list?.data.map((r) => r.id) ?? []) : new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (d: Decision) => {
    if (selected.size === 0 || busy) return;
    if (!window.confirm(`${DECISION_LABEL[d]} ${selected.size} application${selected.size === 1 ? '' : 's'}? Each applicant will be emailed.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const body = { ids: [...selected], decision: d };
      const res = orgWide ? await orgApi.bulk(body) : await eventApi.bulk(body);
      const failures = res.results.filter((r) => !r.ok);
      setNotice(`${res.succeeded} ${DECIDED[d]}${failures.length ? `; ${failures.length} skipped: ${failures.map((f) => f.error).slice(0, 3).join(' · ')}` : ''}`);
      await load();
    } catch (err) {
      setError(describeError(err, 'Bulk action failed'));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    const path = orgWide ? orgApi.exportUrl(query) : eventApi.exportUrl(query);
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002'}${path}`;
    const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
    if (!res.ok) {
      setError(res.status === 413 ? 'Too many applications to export at once — narrow the filter.' : 'Export failed');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = orgWide ? `participants-${new Date().toISOString().slice(0, 10)}.csv` : `applications-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openDecision = async (row: ApplicationRow, d: Decision, trigger: HTMLButtonElement) => {
    (decisionTriggerRef as { current: HTMLButtonElement | null }).current = trigger;
    setError(null);
    try {
      const application = await api.get<AdminApplication>(`/admin/events/${row.eventId ?? eventId}/applications/${row.id}`);
      setDecision({ row, application, decision: d });
    } catch (err) {
      setError(describeError(err, 'Could not load the application'));
    }
  };

  const onDecided = (next: AdminApplication) => {
    patchRow(next);
    setDecision(null);
    setNotice(`${next.profile?.businessName ?? 'Application'}: ${STATUS_LABEL[next.status].toLowerCase()}.`);
    refreshSummary();
  };

  // Options derived from the forms in scope; on the org mount an Event filter
  // narrows the Form and Add-on options to that event.
  const eventOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; date: string }>();
    for (const f of forms) if (f.event && !seen.has(f.event.id)) seen.set(f.event.id, f.event);
    return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [forms]);
  const formOptions = useMemo(() => (query.event ? forms.filter((f) => f.eventId === query.event) : forms), [forms, query.event]);
  const addOnOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const f of formOptions) for (const a of f.addOns ?? []) if (!seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name });
    return [...seen.values()];
  }, [formOptions]);

  // Pinned answer columns (spec 019 follow-up): with a Form filter, one column per
  // pinned question of that form; otherwise one "Answers" column listing label: value.
  const pinnedColumns = useMemo(() => {
    if (!query.form) return [];
    const f = forms.find((x) => x.id === query.form);
    return f?.pinnedQuestions ?? (f?.questions ?? []).filter((q) => q.pinned).map((q) => ({ id: q.id, label: q.label }));
  }, [forms, query.form]);
  const showAnswers = pinnedColumns.length === 0 && (list?.data ?? []).some((r) => (r.pinnedAnswers ?? []).length > 0);

  const selectedPaid = (list?.data ?? []).some((r) => selected.has(r.id) && r.formKind === 'PAID');
  const showOrganization = orgWide && (list?.data ?? []).some((r) => r.organization);
  const summary = list?.summary ?? {};
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const statusSort = query.sort === 'status' ? 'ascending' : query.sort === 'status_desc' ? 'descending' : 'none';
  // Spec 014 phase 2: a Booth column once any row in view sells from a map or carries a placement.
  const showBooth = (list?.data ?? []).some((r) => r.mapBound || r.booth || r.boothLabel);
  const columns = 10 + (showOrganization ? 1 : 0) + pinnedColumns.length + (showAnswers ? 1 : 0) + (showBooth ? 1 : 0);
  const detailHref = (row: ApplicationRow) => `/admin/events/${row.eventId ?? eventId}/applications/${row.id}`;

  return (
    <>
      {/* Status summary */}
      <div className="mb-4 flex flex-wrap gap-2" data-testid="applications-summary">
        <button type="button" onClick={() => setQuery({ status: undefined })} className={`${btn} ${!query.status ? 'ring-2 ring-indigo-500' : ''}`}>
          All {Object.values(summary).reduce((s, n) => s + (n ?? 0), 0)}
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
        {orgWide && (
          <select aria-label="Event" value={query.event || ''} onChange={(e) => setQuery({ event: e.target.value || undefined, form: undefined, addOn: undefined })} className={select} data-testid="participants-event-filter">
            <option value="">All events</option>
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Form" value={query.form || ''} onChange={(e) => setQuery({ form: e.target.value || undefined })} className={select}>
          <option value="">All forms</option>
          {formOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {orgWide && !query.event && f.event ? `${f.name} · ${f.event.name}` : f.name}
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
        {addOnOptions.length > 0 && (
          <select aria-label="Add-on" value={query.addOn || ''} onChange={(e) => setQuery({ addOn: e.target.value || undefined })} className={select} data-testid="applications-add-on-filter">
            <option value="">Any add-ons</option>
            {addOnOptions.map((a) => (
              <option key={a.id} value={a.id}>
                Has {a.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Booth" value={query.booth || ''} onChange={(e) => setQuery({ booth: (e.target.value || undefined) as 'none' | 'chosen' | undefined })} className={select} data-testid="applications-booth-filter">
          <option value="">Any booth</option>
          <option value="none">Booth not chosen</option>
          <option value="chosen">Booth chosen</option>
        </select>
        {tagOptions.length > 0 && (
          <select aria-label="Tag" value={query.tag || ''} onChange={(e) => setQuery({ tag: e.target.value || undefined })} className={select} data-testid="applications-tag-filter">
            <option value="">Any tag</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                Tagged {t}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Sort" value={query.sort || ''} onChange={(e) => setQuery({ sort: e.target.value || undefined })} className={select}>
          <option value="">Newest first</option>
          <option value="submitted_asc">Oldest first</option>
          <option value="business">Business A–Z</option>
          <option value="business_desc">Business Z–A</option>
          <option value="status">By status</option>
          {orgWide && <option value="event">By event</option>}
        </select>
        <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business, contact, email, application, ID or tag" className={`${select} w-72`} />
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
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2">Application</th>
              {showOrganization && <th className="px-3 py-2">Organization</th>}
              {pinnedColumns.map((c) => (
                <th key={c.id} className="px-3 py-2" data-testid={`pinned-column-${c.id}`}>
                  {c.label}
                </th>
              ))}
              {showAnswers && <th className="px-3 py-2">Answers</th>}
              {showBooth && <th className="px-3 py-2">Booth</th>}
              <th className="px-3 py-2" aria-sort={statusSort}>
                <button
                  type="button"
                  onClick={() => setQuery({ sort: query.sort === 'status' ? 'status_desc' : 'status' })}
                  className="inline-flex items-center gap-1 uppercase hover:text-gray-900 dark:hover:text-white"
                  data-testid="applications-sort-status"
                >
                  Status
                  <span aria-hidden="true">{statusSort === 'ascending' ? '↑' : statusSort === 'descending' ? '↓' : '↕'}</span>
                </button>
              </th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Add-ons</th>
              <th className="px-3 py-2">Submitted</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {list?.data.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-3 py-8 text-center text-gray-600 dark:text-slate-400">
                  No applications match.{' '}
                  {forms.length === 0 &&
                    (orgWide ? (
                      <Link href="/admin/events" className="text-indigo-600 hover:underline dark:text-indigo-300">
                        Create a form on an event
                      </Link>
                    ) : (
                      <Link href={`/admin/events/${eventId}/applications/forms`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                        Create a form
                      </Link>
                    ))}
                </td>
              </tr>
            )}
            {list?.data.map((row) => {
              const [day, time] = submittedLines(row.submittedAt);
              return (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40" data-testid={`application-row-${row.id}`}>
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" aria-label={`Select ${row.businessName}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <BusinessCell row={row} eventId={row.eventId ?? eventId ?? ''} onCheck={(field, value) => toggleCheck(row, field, value)} checkBusy={checkBusy.has(row.id)} />
                  </td>
                  <td className="px-3 py-2 align-top" data-testid={`application-tags-${row.id}`}>
                    {!(showBooth ? false : row.boothLabel) && !(row.tags ?? []).length ? (
                      <span className="text-gray-400 dark:text-slate-500">—</span>
                    ) : (
                      <div className="flex max-w-[14rem] flex-wrap gap-1">
                        {!showBooth && row.boothLabel && <span className={chip}>{row.boothLabel}</span>}
                        {(row.tags ?? []).map((t) => (
                          <span key={t} className={tagChip}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-800 dark:text-slate-200">
                    {row.formName}
                    {row.tier && <div className="text-xs text-gray-600 dark:text-slate-400">{row.tier.name}</div>}
                    {orgWide && row.event && (
                      <div className="text-xs text-gray-600 dark:text-slate-400" data-testid={`application-event-${row.id}`}>
                        {row.event.name} · {formatDate(row.event.date)}
                      </div>
                    )}
                  </td>
                  {showOrganization && <td className="px-3 py-2 align-top text-gray-800 dark:text-slate-200">{row.organization?.name ?? ''}</td>}
                  {pinnedColumns.map((c) => {
                    const a = (row.pinnedAnswers ?? []).find((x) => x.questionId === c.id);
                    return (
                      <td key={c.id} className="max-w-[14rem] truncate px-3 py-2 align-top text-gray-800 dark:text-slate-200" title={a?.value || undefined} data-testid={`pinned-answer-${row.id}-${c.id}`}>
                        {a?.value || <span className="text-gray-400 dark:text-slate-500">—</span>}
                      </td>
                    );
                  })}
                  {showAnswers && (
                    <td className="max-w-[16rem] px-3 py-2 align-top text-xs text-gray-700 dark:text-slate-300" data-testid={`application-answers-${row.id}`}>
                      {(row.pinnedAnswers ?? []).length === 0 ? (
                        <span className="text-gray-400 dark:text-slate-500">—</span>
                      ) : (
                        (row.pinnedAnswers ?? []).map((a) => (
                          <div key={a.questionId} className="truncate" title={a.value}>
                            <span className="text-gray-500 dark:text-slate-400">{a.label}:</span> {a.value || '—'}
                          </div>
                        ))
                      )}
                    </td>
                  )}
                  {showBooth && (
                    <td className="px-3 py-2 align-top" data-testid={`application-booth-${row.id}`}>
                      <BoothCell row={row} />
                    </td>
                  )}
                  <td className="px-3 py-2 align-top">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.formKind === 'PAID' ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.overdue ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : PAYMENT_STYLE[row.paymentStatus]}`}>
                        {PAYMENT_LABEL[row.paymentStatus]}
                        {row.applicantPays > 0 ? ` · ${money(row.applicantPays)}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-slate-400">—</span>
                    )}
                    {row.orderId && row.orderRef && (
                      <div className="mt-1">
                        <Link href={`/admin/orders/${row.orderId}`} className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400" data-testid={`application-order-${row.id}`} onClick={(e) => e.stopPropagation()}>
                          {row.orderRef}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700 dark:text-slate-300" data-testid={`application-add-ons-${row.id}`}>
                    {addOnSummary(row.addOns) || <span className="text-gray-400 dark:text-slate-500">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-700 dark:text-slate-300">
                    <div>{day}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{time}</div>
                  </td>
                  <td className="px-1 py-2 text-right align-top">
                    <RowActionsMenu
                      row={row}
                      detailHref={detailHref(row)}
                      onDecision={(d, trigger) => openDecision(row, d, trigger)}
                      onEditTags={(trigger) => {
                        (tagsTriggerRef as { current: HTMLButtonElement | null }).current = trigger;
                        setEditingTags(row);
                      }}
                      onNotice={setNotice}
                    />
                  </td>
                </tr>
              );
            })}
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

      {editingTags && (
        <EditTagsDialog
          eventId={editingTags.eventId ?? eventId ?? ''}
          applicationId={editingTags.id}
          businessName={editingTags.businessName}
          tags={editingTags.tags ?? []}
          suggestions={tagOptions}
          returnFocusRef={tagsTriggerRef}
          onClose={() => setEditingTags(null)}
          onSaved={(next) => {
            patchRow(next);
            setEditingTags(null);
            setNotice('Tags saved.');
            loadTags();
          }}
        />
      )}

      {decision && (
        <DecisionDialog
          eventId={decision.row.eventId ?? eventId ?? ''}
          application={decision.application}
          decision={decision.decision}
          returnFocusRef={decisionTriggerRef}
          onClose={() => setDecision(null)}
          onDecided={onDecided}
        />
      )}
    </>
  );
}
