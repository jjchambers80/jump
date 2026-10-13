'use client';

// The Contacts table with its filters (the Contacts tab and a list's page,
// spec 055): the organization's contacts, or one list's when `listId` is set.
// Every filter lives in the URL so a view can be shared and the detail page
// can page through the same list.

import React, { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, Search, Users, X } from 'lucide-react';
import api, { downloadCsv } from '@/services/api';
import { isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { useCan, useOrg } from '@/components/OrgContext';
import {
  customerDetailHref,
  customerListQuery,
  customerScopeFrom,
  customerSourceFrom,
  type CustomerListState,
  type CustomerSource,
} from '@/lib/customers';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Source chips (spec 044C) */
  sources: string[];
  formSources: { id: string; name: string }[];
  transactionCount: number;
  totalSpent: number;
  lastActivityAt: string | null;
}

interface ContactListResponse {
  data: Contact[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const SOURCE_LABEL: Record<string, string> = { tickets: 'Tickets', rsvp: 'RSVP', subscribed: 'Subscribed' };

const SORTS: { value: string; label: string; column?: 'name' | 'spent' | 'activity' }[] = [
  { value: 'createdAt:desc', label: 'Newest contact' },
  { value: 'createdAt:asc', label: 'Oldest contact' },
  { value: 'name:asc', label: 'Name A–Z', column: 'name' },
  { value: 'name:desc', label: 'Name Z–A', column: 'name' },
  { value: 'lastActivityAt:desc', label: 'Recent activity', column: 'activity' },
  { value: 'totalSpent:desc', label: 'Highest spend', column: 'spent' },
  { value: 'transactionCount:desc', label: 'Most transactions' },
];

const controlClass =
  'h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const labelClass = 'mb-1 block text-xs font-medium text-gray-600 dark:text-slate-300';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** How a contact came in: one chip per source, one per standing form submitted. */
function SourceChips({ contact }: { contact: Contact }) {
  if (!contact.sources?.length && !contact.formSources?.length) {
    return <span className="text-gray-500 dark:text-slate-400">—</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sources">
      {contact.sources?.map((source) => (
        <li key={source} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200">
          {SOURCE_LABEL[source] ?? source}
        </li>
      ))}
      {contact.formSources?.map((form) => (
        <li key={form.id} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
          Form: {form.name}
        </li>
      ))}
    </ul>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-accent-50 pl-3 pr-1 text-sm font-medium text-gray-900 dark:bg-accent-900/30 dark:text-white">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:hover:bg-accent-900/50"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

/** What the selection bar acts on: picked rows, or every contact the filters match. */
export type ContactSelection =
  | { kind: 'ids'; ids: string[]; count: number }
  | { kind: 'query'; query: Record<string, string>; count: number };

export default function ContactsList({
  basePath,
  listId,
  header,
  emptyState,
  bulkActions,
  selectAllMatching = true,
  reloadKey = 0,
}: {
  /** Page the filters write to (`/admin/contacts` or a list's page). */
  basePath: string;
  /** Narrow to one list (spec 055); carried to the API and the detail page. */
  listId?: string;
  /** Page header, given the live count line. */
  header: (count: ReactNode) => ReactNode;
  /** Title and text when nothing is filtered and there is nobody to show. */
  emptyState?: { title: ReactNode; body: ReactNode };
  /**
   * Row checkboxes and a selection bar with these actions (spec 055-C). `done`
   * clears the selection; `done(true)` also reloads the rows.
   */
  bulkActions?: (selection: ContactSelection, done: (reload?: boolean) => void) => ReactNode;
  /** Offer "Select all N matching" once a whole page is picked. */
  selectAllMatching?: boolean;
  /** Change it to reload the rows (after an edit or import) without remounting. */
  reloadKey?: number;
}) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const canExport = useCan('customers.export');
  const { withReauth } = useReauth();
  const [exporting, setExporting] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  // The URL is the list state.
  const state: CustomerListState = {
    page: Math.max(1, Number(params.get('page')) || 1),
    search: params.get('search') || '',
    tag: params.get('tag') || '',
    scope: customerScopeFrom(params.get('scope')),
    rsvp: params.get('rsvp') === 'going' ? 'going' : '',
    eventId: params.get('eventId') || '',
    source: customerSourceFrom(params.get('source')),
    formId: params.get('formId') || '',
    sort: params.get('sort') || '',
    direction: params.get('direction') === 'asc' ? 'asc' : params.get('direction') === 'desc' ? 'desc' : undefined,
  };
  // `list` rides along to the API and the detail page, never into this page's own URL.
  const listQuery = customerListQuery({ ...state, list: listId });
  const queryString = listQuery.toString();
  const sortValue = `${state.sort || 'createdAt'}:${state.direction || 'desc'}`;
  const sortedColumn = SORTS.find((s) => s.value === sortValue)?.column;
  const filtered = Boolean(state.search || state.tag || state.rsvp || state.source || state.scope === 'customers');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(state.search ?? '');
  const [standingForms, setStandingForms] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [reload, setReload] = useState(0);

  const update = (patch: Partial<CustomerListState>) => {
    const next = customerListQuery({ ...state, page: 1, ...patch });
    router.replace(`${basePath}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  // Search as you type, after a short pause.
  useEffect(() => {
    if (searchInput === (state.search ?? '')) return;
    const timer = setTimeout(() => update({ search: searchInput }), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams(queryString);
    query.set('limit', '20');
    query.set('scope', state.scope ?? 'all');
    api
      .get<ContactListResponse>(`/admin/customers?${query}`)
      .then((result) => {
        if (cancelled) return;
        setContacts(result.data);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
      })
      .catch((err) => !cancelled && setError(err?.message || 'Could not load contacts'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orgLoading, selectedOrgId, queryString, state.scope, reload, reloadKey]);

  // A new page or filter starts a new selection.
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [queryString]);

  useEffect(() => {
    if (!selectedOrgId || state.source !== 'form') return;
    api
      .get<{ data: { id: string; name: string }[] }>('/admin/standing-application-forms')
      .then((result) => setStandingForms(result.data))
      .catch(() => setStandingForms([]));
  }, [selectedOrgId, state.source]);

  // Spec 055-E: every contact these filters (and the list) match, as CSV. ADMIN + step-up.
  const exportCsv = async () => {
    const query = new URLSearchParams(queryString);
    query.delete('page');
    query.set('scope', state.scope ?? 'all');
    setExporting(true);
    try {
      await withReauth(() => downloadCsv(`/admin/customers/export.csv?${query}`, 'contacts.csv'));
    } catch (err) {
      if (!isReauthCancelled(err)) setError((err as Error)?.message || 'Could not export contacts');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    router.replace(basePath, { scroll: false });
  };

  const countLabel = `${total} contact${total === 1 ? '' : 's'}`;

  // Selection (spec 055-C)
  const selectable = Boolean(bulkActions);
  const pageIds = contacts.map((c) => c.id);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const wholePage = pageIds.length > 0 && pageSelected === pageIds.length;
  const togglePage = () => {
    setAllMatching(false);
    setSelected(wholePage ? new Set() : new Set(pageIds));
  };
  const toggleOne = (id: string) => {
    setAllMatching(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };
  const matchQuery = () => {
    const query = Object.fromEntries(new URLSearchParams(queryString));
    delete query.page;
    delete query.sort;
    delete query.direction;
    return { ...query, scope: state.scope ?? 'all' };
  };
  const selection: ContactSelection = allMatching
    ? { kind: 'query', query: matchQuery(), count: total }
    : { kind: 'ids', ids: [...selected], count: selected.size };
  const pageCheckboxRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = pageSelected > 0 && !wholePage;
  };
  const checkbox = 'h-5 w-5 rounded border-gray-400 text-accent-700 focus:ring-2 focus:ring-accent-500 dark:border-slate-500';
  const ariaSort = (column: 'name' | 'spent' | 'activity') =>
    sortedColumn === column ? (state.direction === 'asc' ? 'ascending' : 'descending') : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {header(<span aria-live="polite">{loading ? ' ' : countLabel}</span>)}

      {/* Toolbar */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,2fr)_1fr_1fr_1fr_auto]">
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="contact-search" className={labelClass}>
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-slate-400" aria-hidden />
            <input
              id="contact-search"
              type="search"
              placeholder="Name or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`${controlClass} pl-9`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="contact-scope" className={labelClass}>
            Show
          </label>
          <select
            id="contact-scope"
            value={state.scope}
            onChange={(e) => update({ scope: customerScopeFrom(e.target.value) })}
            className={controlClass}
          >
            <option value="all">All contacts</option>
            <option value="customers">Paying contacts</option>
          </select>
        </div>
        <div>
          <label htmlFor="contact-source" className={labelClass}>
            Source
          </label>
          <select
            id="contact-source"
            value={state.source}
            onChange={(e) => update({ source: e.target.value as CustomerSource | '', formId: '' })}
            className={controlClass}
          >
            <option value="">Any source</option>
            <option value="tickets">Bought tickets</option>
            <option value="rsvp">RSVP&apos;d</option>
            <option value="subscribed">Subscribed (email opt-in)</option>
            <option value="form">Submitted a form</option>
          </select>
        </div>
        <div>
          <label htmlFor="contact-sort" className={labelClass}>
            Sort
          </label>
          <select
            id="contact-sort"
            value={sortValue}
            onChange={(e) => {
              const [sort, direction] = e.target.value.split(':');
              update({ sort, direction: direction as 'asc' | 'desc' });
            }}
            className={controlClass}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {canExport && (
          <div className="sm:col-span-2 lg:col-span-1 lg:self-end">
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-700 lg:w-auto"
            >
              <Download className="h-4 w-4" aria-hidden />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        )}
        {state.source === 'form' && (
          <div className="sm:col-span-2 lg:col-span-1 lg:col-start-3">
            <label htmlFor="contact-form" className={labelClass}>
              Form
            </label>
            <select id="contact-form" value={state.formId} onChange={(e) => update({ formId: e.target.value })} className={controlClass}>
              <option value="">Any form</option>
              {standingForms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(state.rsvp || state.tag) && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Active filters">
          {state.rsvp && (
            <FilterChip
              label={state.eventId ? "RSVP'd to this event" : "RSVP'd"}
              onRemove={() => update({ rsvp: '', eventId: '' })}
            />
          )}
          {state.tag && <FilterChip label={`Tag: ${state.tag}`} onRemove={() => update({ tag: '' })} />}
        </ul>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-600 dark:text-slate-400">Pick an organization from the menu in the top right.</p>
      )}

      {selectedOrgId && loading && (
        <div aria-busy="true" aria-label="Loading contacts" className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-slate-700/50" />
          ))}
        </div>
      )}

      {selectedOrgId && !loading && !error && contacts.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-800">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
            <Users className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">
            {filtered ? 'No contacts match these filters' : emptyState?.title ?? 'No contacts yet'}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-gray-600 dark:text-slate-400">
            {filtered
              ? 'Try another search or clear the filters.'
              : emptyState?.body ?? 'Everyone who buys a ticket, RSVPs, submits a form or subscribes shows up here.'}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-5 inline-flex min-h-[44px] items-center rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 dark:border-slate-600 dark:text-white dark:hover:bg-slate-700"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {selectedOrgId && !loading && contacts.length > 0 && (
        <div className="overflow-clip rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {/* Phones and tablets: one card per contact */}
          <ul className="divide-y divide-gray-200 dark:divide-slate-700 lg:hidden" data-testid="contacts-cards">
            {contacts.map((contact) => (
              <li key={contact.id} className={selectable ? 'flex items-start' : undefined}>
                {selectable && (
                  <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-start justify-center pl-3 pt-4">
                    <span className="sr-only">Select {contact.firstName} {contact.lastName}</span>
                    <input type="checkbox" checked={allMatching || selected.has(contact.id)} onChange={() => toggleOne(contact.id)} className={checkbox} />
                  </label>
                )}
                <Link
                  href={customerDetailHref(contact.id, listQuery)}
                  className="block min-w-0 flex-1 space-y-2 px-4 py-3.5 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 dark:hover:bg-slate-700/40"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-gray-900 dark:text-white">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(contact.totalSpent)}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-gray-600 dark:text-slate-400">{contact.email}</span>
                  <SourceChips contact={contact} />
                  {contact.lastActivityAt && (
                    <span className="block text-xs text-gray-600 dark:text-slate-400">Last activity {formatDate(contact.lastActivityAt)}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <table className="hidden w-full text-left text-sm lg:table">
            <caption className="sr-only">Contacts{filtered ? ', filtered' : ''}</caption>
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                {selectable && (
                  <th scope="col" className="w-12 py-3 pl-4">
                    <input
                      ref={pageCheckboxRef}
                      type="checkbox"
                      aria-label="Select every contact on this page"
                      checked={allMatching || wholePage}
                      onChange={togglePage}
                      className={checkbox}
                    />
                  </th>
                )}
                <th scope="col" aria-sort={ariaSort('name')} className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Email</th>
                <th scope="col" className="px-4 py-3 font-medium">Source</th>
                <th scope="col" aria-sort={ariaSort('spent')} className="px-4 py-3 text-right font-medium">Total spent</th>
                <th scope="col" aria-sort={ariaSort('activity')} className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {contacts.map((contact) => (
                <tr key={contact.id} className="relative hover:bg-gray-50 focus-within:bg-gray-50 dark:hover:bg-slate-700/40 dark:focus-within:bg-slate-700/40">
                  {selectable && (
                    <td className="relative z-10 w-12 py-3.5 pl-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                        checked={allMatching || selected.has(contact.id)}
                        onChange={() => toggleOne(contact.id)}
                        className={checkbox}
                      />
                    </td>
                  )}
                  <td className="max-w-[16rem] px-4 py-3.5">
                    {/* The link covers the whole row; it is the row's one tab stop. */}
                    <Link
                      href={customerDetailHref(contact.id, listQuery)}
                      className="block truncate font-medium text-gray-900 after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent-600 dark:text-white"
                    >
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="max-w-[18rem] truncate px-4 py-3.5 text-gray-700 dark:text-slate-300">{contact.email}</td>
                  <td className="px-4 py-3.5">
                    <SourceChips contact={contact} />
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(contact.totalSpent)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-gray-700 dark:text-slate-300">
                    {contact.lastActivityAt ? formatDate(contact.lastActivityAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectable && (selected.size > 0 || allMatching) && (
            <div
              role="region"
              aria-label="Selected contacts"
              className="sticky bottom-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:border-slate-700 dark:bg-slate-800"
            >
              <p aria-live="polite" className="text-sm font-semibold text-gray-900 dark:text-white">
                {allMatching ? `All ${total} matching contacts selected` : `${selected.size} selected`}
              </p>
              {selectAllMatching && wholePage && !allMatching && total > pageIds.length && (
                <button
                  type="button"
                  onClick={() => setAllMatching(true)}
                  className="min-h-[44px] text-sm font-semibold text-accent-700 underline hover:no-underline dark:text-accent-300"
                >
                  Select all {total} matching
                </button>
              )}
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {bulkActions?.(selection, (again) => {
                  clearSelection();
                  if (again) setReload((n) => n + 1);
                })}
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-slate-700">
              <span className="text-sm text-gray-600 dark:text-slate-400">
                Page {state.page} of {totalPages}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => update({ page: (state.page ?? 1) - 1 })}
                  disabled={state.page === 1}
                  aria-label="Previous page"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => update({ page: (state.page ?? 1) + 1 })}
                  disabled={state.page === totalPages}
                  aria-label="Next page"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </span>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
