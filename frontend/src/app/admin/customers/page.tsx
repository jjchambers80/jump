'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import {
  customerDetailHref,
  customerListQuery,
  customerSegmentFrom,
  customerSourceFrom,
  segmentBadgeClass,
  type CustomerSegment,
  type CustomerSource,
} from '@/lib/customers';
import { customerScopeFrom, type CustomerScope } from '@/lib/customerNavigation';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  location: string | null;
  note: string | null;
  emailSubscribed: boolean;
  /** Source chips for the customer list (spec 044C) */
  sources: string[];
  formSources: { id: string; name: string }[];
  /** Orders + paid applications (spec 018). `orderCount` is the pre-018 alias. */
  transactionCount: number;
  ticketOrderCount: number;
  applicationCount: number;
  totalSpent: number;
  totalRefunded: number;
  lastActivityAt: string | null;
  createdAt: string;
  segment: CustomerSegment;
}

interface CustomerListResponse {
  data: Customer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

const SOURCE_LABEL: Record<string, string> = { tickets: 'Tickets', rsvp: 'RSVP', subscribed: 'Subscribed' };

/** How a contact came in (spec 044C): one chip per source, one per standing form submitted. */
function SourceChips({ customer }: { customer: Customer }) {
  if (!customer.sources?.length && !customer.formSources?.length) {
    return <span className="text-xs text-gray-400 dark:text-slate-500">—</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sources">
      {customer.sources?.map((source) => (
        <li key={source} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200">
          {SOURCE_LABEL[source] ?? source}
        </li>
      ))}
      {customer.formSources?.map((form) => (
        <li key={form.id} className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
          Form: {form.name}
        </li>
      ))}
    </ul>
  );
}

function CustomersPageContent() {
  const { selectedOrgId } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const initialSegment = customerSegmentFrom(searchParams.get('segment'));
  const initialSource = customerSourceFrom(searchParams.get('source'));
  const initialFormId = searchParams.get('formId') || '';
  const [source, setSource] = useState<CustomerSource | ''>(initialSource);
  const [formId, setFormId] = useState<string>(initialFormId);

  // Standing forms (spec 044) for the Source › form picker; loaded only once it is chosen.
  const [standingForms, setStandingForms] = useState<{ id: string; name: string }[]>([]);

  // source=form lists contacts with no paid order too, so it always runs on All contacts.
  const [scope, setScope] = useState<CustomerScope>(() => {
    if (initialSource === 'form') return 'all';
    return customerScopeFrom(searchParams);
  });
  const noun = scope === 'all' ? 'contact' : 'customer';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [segment, setSegment] = useState<CustomerSegment | ''>(initialSegment);
  const [rsvp, setRsvp] = useState<'going' | ''>(
    searchParams.get('rsvp') === 'going' ? 'going' : ''
  );
  const eventId = searchParams.get('eventId') || '';
  const [sort, setSort] = useState(searchParams.get('sort') || 'createdAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>(
    searchParams.get('direction') === 'asc' ? 'asc' : 'desc'
  );

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<'note' | 'location' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCustomers = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: '20', scope });
      if (search) params.set('search', search);
      if (segment) params.set('segment', segment);
      if (rsvp) params.set('rsvp', rsvp);
      if (rsvp && eventId) params.set('eventId', eventId);
      if (source) params.set('source', source);
      if (formId) params.set('formId', formId);
      params.set('sort', sort);
      params.set('direction', direction);
      const result = await api.get<CustomerListResponse>(`/admin/customers?${params}`);
      setCustomers(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch (err: any) {
      setError(err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, page, search, segment, rsvp, eventId, source, formId, sort, direction, scope]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    if (!selectedOrgId || source !== 'form') return;
    api
      .get<{ data: { id: string; name: string }[] }>('/admin/standing-application-forms')
      .then((result) => setStandingForms(result.data))
      .catch(() => setStandingForms([]));
  }, [selectedOrgId, source]);

  // Reset page when search changes
  useEffect(() => {
    setPage(1);
  }, [search, segment, rsvp, source, formId, sort, direction, scope]);

  const listQuery = customerListQuery({ page, search, segment, rsvp, eventId, source, formId, sort, direction });
  if (scope === 'all') listQuery.set('scope', 'all');
  else listQuery.delete('scope');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleSegmentChange = (nextSegment: CustomerSegment | '') => {
    setSegment(nextSegment);
    setPage(1);

    // Keep the active list state shareable while preserving query values added
    // by adjacent list controls (for example tag filters).
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('page');
    if (search) nextParams.set('search', search);
    else nextParams.delete('search');
    if (nextSegment) nextParams.set('segment', nextSegment);
    else nextParams.delete('segment');
    nextParams.set('sort', sort);
    nextParams.set('direction', direction);
    if (scope === 'all') nextParams.set('scope', scope);
    else nextParams.delete('scope');
    if (source) nextParams.set('source', source);
    if (formId) nextParams.set('formId', formId);
    if (rsvp) nextParams.set('rsvp', rsvp);
    if (rsvp && eventId) nextParams.set('eventId', eventId);

    const query = nextParams.toString();
    router.replace(`/admin/customers${query ? `?${query}` : ''}`, { scroll: false });
  };

  const handleRsvpChange = (nextRsvp: 'going' | '') => {
    setRsvp(nextRsvp);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('page');
    if (nextRsvp) nextParams.set('rsvp', nextRsvp);
    else {
      nextParams.delete('rsvp');
      nextParams.delete('eventId');
    }
    // rsvp=going is an alias for source=rsvp; clear source if it was rsvp
    if (source === 'rsvp' && !nextRsvp) {
      nextParams.delete('source');
      nextParams.delete('formId');
    }
    router.replace(`/admin/customers${nextParams.size ? `?${nextParams}` : ''}`, { scroll: false });
  };

  const handleSourceChange = (nextSource: CustomerSource | '') => {
    setSource(nextSource);
    setFormId('');
    setPage(1);
    // A form submitter usually has no paid order, so the Customers predicate would hide them.
    if (nextSource === 'form') setScope('all');
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('page');
    if (search) nextParams.set('search', search);
    else nextParams.delete('search');
    if (segment) nextParams.set('segment', segment);
    else nextParams.delete('segment');
    if (nextSource) nextParams.set('source', nextSource);
    else nextParams.delete('source');
    nextParams.delete('formId');
    nextParams.set('sort', sort);
    nextParams.set('direction', direction);
    // source=form flips to all contacts
    if (nextSource === 'form') {
      nextParams.set('scope', 'all');
    } else if (scope === 'all' && source === 'form') {
      nextParams.delete('scope');
    }
    if (rsvp && nextSource !== 'rsvp') {
      nextParams.delete('rsvp');
      nextParams.delete('eventId');
    }

    const query = nextParams.toString();
    router.replace(`/admin/customers${query ? `?${query}` : ''}`, { scroll: false });
  };

  const handleFormChange = (nextFormId: string) => {
    setFormId(nextFormId);
    setPage(1);
    // Build from the current list state, not searchParams: the Source change's
    // router.replace may not have landed yet, and reading it would drop source=form.
    const nextParams = new URLSearchParams(listQuery);
    const tag = searchParams.get('tag');
    if (tag) nextParams.set('tag', tag);
    nextParams.delete('page');
    if (nextFormId) {
      nextParams.set('formId', nextFormId);
      // Selecting a form implies source=form
      nextParams.set('source', 'form');
      // source=form requires scope=all (form submitters may not have paid orders)
      nextParams.set('scope', 'all');
    } else {
      nextParams.delete('formId');
    }
    const query = nextParams.toString();
    router.replace(`/admin/customers${query ? `?${query}` : ''}`, { scroll: false });
  };

  const startEdit = (customer: Customer, field: 'note' | 'location') => {
    setEditingId(customer.id);
    setEditField(field);
    setEditValue(field === 'note' ? (customer.note || '') : (customer.location || ''));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditField(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingId || !editField) return;
    try {
      setSaving(true);
      await api.patch(`/admin/customers/${editingId}`, { [editField]: editValue || null });
      setCustomers((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, [editField!]: editValue || null } : c))
      );
      cancelEdit();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleSubscription = async (customer: Customer) => {
    try {
      const newValue = !customer.emailSubscribed;
      await api.patch(`/admin/customers/${customer.id}`, { emailSubscribed: newValue });
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, emailSubscribed: newValue } : c))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update subscription');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent-600 dark:text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Customers</h1>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label="Contact scope" className="inline-flex rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5">
            {([
              ['customers', 'Customers'],
              ['all', 'All contacts'],
            ] as [CustomerScope, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                data-testid={`customer-scope-${value}`}
                onClick={() => setScope(value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  scope === value
                    ? 'bg-accent-500 text-gray-950'
                    : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-500 dark:text-slate-400" aria-live="polite">
            {!loading && `${total} ${noun}${total !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-4 relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(e); }}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
        />
        {search && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setSearch(''); }}
            className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="customer-segment">
          Segment
        </label>
        <select
          id="customer-segment"
          value={segment}
          onChange={(event) => handleSegmentChange(event.target.value as CustomerSegment | '')}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">All segments</option>
          <option value="New">New</option>
          <option value="Repeat">Repeat</option>
          <option value="Lapsed">Lapsed</option>
          <option value="Prospect">Prospect</option>
        </select>
        <label className="ml-2 text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="customer-rsvp">
          RSVP
        </label>
        <select
          id="customer-rsvp"
          value={rsvp}
          onChange={(event) => handleRsvpChange(event.target.value as 'going' | '')}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">All</option>
          <option value="going">RSVP&apos;d{eventId ? ' to this event' : ''}</option>
        </select>
        <label className="ml-2 text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="customer-source">
          Source
        </label>
        <select
          id="customer-source"
          value={source}
          onChange={(event) => handleSourceChange(event.target.value as CustomerSource | '')}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="">Any source</option>
          <option value="tickets">Bought tickets</option>
          <option value="rsvp">RSVP&apos;d</option>
          <option value="subscribed">Subscribed (email opt-in)</option>
          <option value="form">Submitted a form</option>
        </select>
        {source === 'form' && (
          <>
            <label className="sr-only" htmlFor="customer-form">
              Form
            </label>
            <select
              id="customer-form"
              value={formId}
              onChange={(event) => handleFormChange(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">Any form</option>
              {standingForms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="ml-auto text-xs font-medium text-gray-600 dark:text-slate-300" htmlFor="customer-sort">
          Sort
        </label>
        <select
          id="customer-sort"
          value={`${sort}:${direction}`}
          onChange={(event) => {
            const [nextSort, nextDirection] = event.target.value.split(':');
            setSort(nextSort);
            setDirection(nextDirection as 'asc' | 'desc');
          }}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="createdAt:desc">Newest customer</option>
          <option value="createdAt:asc">Oldest customer</option>
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="lastActivityAt:desc">Recent activity</option>
          <option value="transactionCount:desc">Most transactions</option>
          <option value="totalSpent:desc">Highest spend</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="animate-pulse h-[72px] bg-gray-100 dark:bg-slate-700/50 rounded" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && selectedOrgId && customers.length === 0 && (
        <div className="text-center py-16">
          <svg className="mx-auto w-12 h-12 text-gray-300 dark:text-slate-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-gray-500 dark:text-slate-400">
            {search || segment || rsvp ? `No ${noun}s match these filters.` : `No ${noun}s yet.`}
          </p>
        </div>
      )}

      {/* Customer table */}
      {!loading && customers.length > 0 && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800">
          {/* Desktop header */}
          <div className="hidden lg:grid grid-cols-[minmax(140px,1.4fr)_minmax(170px,1.8fr)_85px_60px_minmax(100px,1fr)_70px_90px_80px_minmax(110px,1.3fr)] gap-x-4 px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
            <div>Name</div>
            <div>Email</div>
            <div>Segment</div>
            <div className="text-center">Sub</div>
            <div>Source</div>
            <div>Location</div>
            <div className="text-right">Transactions</div>
            <div className="text-right">Spent</div>
            <div>Note</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
            {customers.map((customer) => (
              <div key={customer.id}>
                {/* Desktop row */}
                <div
                  onClick={() => router.push(customerDetailHref(customer.id, listQuery))}
                  className="hidden lg:grid grid-cols-[minmax(140px,1.4fr)_minmax(170px,1.8fr)_85px_60px_minmax(100px,1fr)_70px_90px_minmax(110px,1.3fr)] gap-x-4 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                  {/* Name */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {customer.firstName} {customer.lastName}
                    </p>
                    {customer.lastActivityAt && (
                      <p className="text-xs text-gray-400 dark:text-slate-500 truncate">
                        Last activity {formatDate(customer.lastActivityAt)}
                      </p>
                    )}
                  </div>

                  {/* Email */}
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 dark:text-slate-300 truncate">{customer.email}</p>
                  </div>

                  <div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${segmentBadgeClass(customer.segment)}`}>
                      {customer.segment}
                    </span>
                  </div>

                  {/* Email subscription toggle */}
                  <div className="text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSubscription(customer); }}
                      className={`inline-flex items-center justify-center w-8 h-5 rounded-full transition-colors ${
                        customer.emailSubscribed
                          ? 'bg-green-500'
                          : 'bg-gray-300 dark:bg-slate-600'
                      }`}
                      title={customer.emailSubscribed ? 'Subscribed' : 'Unsubscribed'}
                    >
                      <span
                        className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                          customer.emailSubscribed ? 'translate-x-1.5' : '-translate-x-1.5'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="min-w-0">
                    <SourceChips customer={customer} />
                  </div>

                  {/* Location */}
                  <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                    {editingId === customer.id && editField === 'location' ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          autoFocus
                          className="w-full px-1.5 py-0.5 text-xs rounded border border-accent-300 dark:border-accent-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-accent-500"
                          placeholder="City, State"
                        />
                        <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(customer, 'location')}
                        className="text-xs text-gray-500 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 truncate block w-full text-left"
                        title="Click to edit location"
                      >
                        {customer.location || <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </button>
                    )}
                  </div>

                  {/* Transactions: orders + paid applications */}
                  <div className="text-right" title={`${customer.ticketOrderCount} order${customer.ticketOrderCount !== 1 ? 's' : ''}, ${customer.applicationCount} application${customer.applicationCount !== 1 ? 's' : ''}`}>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{customer.transactionCount}</span>
                    {customer.applicationCount > 0 && (
                      <p className="text-[11px] text-gray-400 dark:text-slate-500">{customer.applicationCount} app{customer.applicationCount !== 1 ? 's' : ''}</p>
                    )}
                  </div>

                  {/* Amount spent */}
                  <div className="text-right">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(customer.totalSpent)}</span>
                  </div>

                  {/* Note */}
                  <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                    {editingId === customer.id && editField === 'note' ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          autoFocus
                          className="w-full px-1.5 py-0.5 text-xs rounded border border-accent-300 dark:border-accent-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-accent-500"
                          placeholder="Add a note..."
                        />
                        <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(customer, 'note')}
                        className="text-xs text-gray-500 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 truncate block w-full text-left"
                        title="Click to edit note"
                      >
                        {customer.note || <span className="text-gray-300 dark:text-slate-600">Add note...</span>}
                      </button>
                    )}
                  </div>
                </div>

                {/* Mobile card */}
                <div onClick={() => router.push(customerDetailHref(customer.id, listQuery))} className="lg:hidden p-4 space-y-2 cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {customer.firstName} {customer.lastName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{customer.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${segmentBadgeClass(customer.segment)}`}>
                        {customer.segment}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSubscription(customer); }}
                        className={`inline-flex items-center justify-center w-8 h-5 rounded-full transition-colors flex-shrink-0 ${
                          customer.emailSubscribed
                            ? 'bg-green-500'
                            : 'bg-gray-300 dark:bg-slate-600'
                        }`}
                      >
                        <span
                          className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                            customer.emailSubscribed ? 'translate-x-1.5' : '-translate-x-1.5'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <SourceChips customer={customer} />
                  <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
                    <span>{customer.transactionCount} transaction{customer.transactionCount !== 1 ? 's' : ''}</span>
                    <span>{formatCurrency(customer.totalSpent)}</span>
                    {customer.location && <span>{customer.location}</span>}
                  </div>
                  {customer.note && (
                    <p className="text-xs text-gray-400 dark:text-slate-500 italic">{customer.note}</p>
                  )}
                  {customer.lastActivityAt && (
                    <p className="text-xs text-gray-400 dark:text-slate-500">Last activity {formatDate(customer.lastActivityAt)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer with pagination */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-700">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {total} {noun}{total !== 1 ? 's' : ''}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">Loading customers…</div>}>
      <CustomersPageContent />
    </Suspense>
  );
}
