'use client';

// Events management page — spec 035C: KPI strip + filter toolbar + URL state.
// Wraps the interactive content in <Suspense> because useSearchParams needs it
// in Next 14 App Router. The outer wrapper can be a server component, but since
// the page is 'use client' already (needs OrgContext + interactivity), we
// split into EventsListShell (outer, <Suspense>) and EventsListContent (inner,
// useSearchParams).

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import EventsPageHeader from '@/components/events/EventsPageHeader';
import EventListCard, { type AdminEvent } from '@/components/events/EventListCard';
import EventsPagination from '@/components/events/EventsPagination';
import CancelEventDialog from '@/components/events/CancelEventDialog';
import EventsSummary, { type EventsSummaryData } from '@/components/events/EventsSummary';
import EventsToolbar, { type StatusFilter, type SortOption } from '@/components/events/EventsToolbar';
import DuplicateEventDialog from './DuplicateEventDialog';

interface EventListResponse {
  events: AdminEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const LIMIT = 25;
const DEFAULT_SORT: SortOption = 'upcoming';

function readUrlParams(searchParams: URLSearchParams) {
  const status = (searchParams.get('status') || '') as StatusFilter;
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const sort = (searchParams.get('sort') || DEFAULT_SORT) as SortOption;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  return { status, q, category, sort, page };
}

// ── Inner content: uses useSearchParams ──

function EventsListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedOrgId } = useOrg();
  const { status: statusFilter, q: searchQ, category, sort, page } = readUrlParams(searchParams);

  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [summary, setSummary] = useState<EventsSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<{ id: string; name: string } | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; name: string } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Build the URL-preserving params for API calls and router updates.
  const buildParams = useCallback(
    (overrides: Partial<{ status: string; q: string; category: string; sort: string; page: number }>) => {
      const params = new URLSearchParams();
      // Preserve orgId from the current URL (used by OrgContext in tests).
      const currentOrgId = searchParams.get('orgId');
      if (currentOrgId) params.set('orgId', currentOrgId);

      const next = { status: statusFilter, q: searchQ, category, sort, page, ...overrides };
      if (next.status) params.set('status', next.status);
      if (next.q) params.set('q', next.q);
      if (next.category) params.set('category', next.category);
      if (next.sort && next.sort !== DEFAULT_SORT) params.set('sort', next.sort);
      if (next.page > 1) params.set('page', String(next.page));
      return params;
    },
    [statusFilter, searchQ, category, sort, page, searchParams]
  );

  const updateUrl = useCallback(
    (overrides: Partial<{ status: string; q: string; category: string; sort: string; page: number }>) => {
      const params = buildParams(overrides);
      const qs = params.toString();
      router.replace(`/admin/events${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [buildParams, router]
  );

  // Fetch summary (counts + categories). Refetch when q or category changes
  // (summary honors these per spec §6.2).
  const fetchSummary = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setSummaryLoading(true);
      const params = new URLSearchParams();
      if (searchQ) params.set('q', searchQ);
      if (category) params.set('category', category);
      const qs = params.toString();
      const data = await api.get<EventsSummaryData>(
        `/organizations/${selectedOrgId}/events/summary${qs ? `?${qs}` : ''}`
      );
      setSummary(data);
    } catch {
      // Summary is non-critical; don't set page error.
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedOrgId, searchQ, category]);

  // Fetch events list.
  const fetchEvents = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setEventsLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        sort,
      });
      if (statusFilter) params.set('status', statusFilter);
      if (searchQ) params.set('q', searchQ);
      if (category) params.set('category', category);
      const data = await api.get<EventListResponse>(
        `/organizations/${selectedOrgId}/events?${params.toString()}`
      );
      setEvents(data.events);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load events');
    } finally {
      setEventsLoading(false);
    }
  }, [selectedOrgId, page, statusFilter, searchQ, category, sort]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Reset pagination and expanded when org changes
  useEffect(() => {
    setExpandedEventId(null);
  }, [selectedOrgId]);

  // ── Handlers ──

  const handleStatusChange = (s: StatusFilter) => {
    updateUrl({ status: s, page: 1 });
  };

  const handleQChange = (q: string) => {
    updateUrl({ q, page: 1 });
  };

  const handleCategoryChange = (cat: string) => {
    updateUrl({ category: cat, page: 1 });
  };

  const handleSortChange = (s: SortOption) => {
    updateUrl({ sort: s, page: 1 });
  };

  const handlePageChange = (p: number) => {
    updateUrl({ page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePublish = async (eventId: string) => {
    if (!selectedOrgId) return;
    try {
      setError(null);
      await api.post(`/organizations/${selectedOrgId}/events/${eventId}/publish`, {});
      await fetchEvents();
      await fetchSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to publish event');
    }
  };

  const handleCancelConfirm = async () => {
    if (!selectedOrgId || !cancelling) return;
    try {
      setCancelBusy(true);
      setError(null);
      await api.post(`/organizations/${selectedOrgId}/events/${cancelling.id}/cancel`, {});
      setCancelling(null);
      setCancelBusy(false);
      await fetchEvents();
      await fetchSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel event');
      setCancelBusy(false);
    }
  };

  const toggleExpand = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  // ── Derived states ──

  const hasActiveFilters = statusFilter || searchQ || category || sort !== DEFAULT_SORT;

  // Build "Showing a–b of N" line
  const showingLine = (() => {
    if (!selectedOrgId) return '';
    if (total === 0) {
      return hasActiveFilters ? 'No events match your filters' : 'No events yet';
    }
    const from = (page - 1) * LIMIT + 1;
    const to = Math.min(page * LIMIT, total);
    return `Showing ${from}–${to} of ${total} event${total === 1 ? '' : 's'}`;
  })();

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <EventsPageHeader
        selectedOrgId={selectedOrgId}
        total={total}
        filterParams={new URLSearchParams({
          ...(statusFilter ? { status: statusFilter } : {}),
        }).toString()}
      />

      {/* KPI Strip */}
      <EventsSummary summary={summary} loading={summaryLoading} />

      {/* Toolbar */}
      <EventsToolbar
        summaryCounts={summary?.counts ?? null}
        categories={summary?.categories ?? []}
        loading={summaryLoading}
        currentStatus={statusFilter}
        currentQ={searchQ}
        currentCategory={category}
        currentSort={sort}
        onStatusChange={handleStatusChange}
        onQChange={handleQChange}
        onCategoryChange={handleCategoryChange}
        onSortChange={handleSortChange}
      />

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
        >
          {notice}
        </p>
      )}

      {duplicating && selectedOrgId && (
        <DuplicateEventDialog
          orgId={selectedOrgId}
          event={duplicating}
          onClose={() => setDuplicating(null)}
          onDone={(created) => {
            setDuplicating(null);
            setNotice(
              `Created draft "${created.name}"${
                created.copiedForms
                  ? ` with ${created.copiedForms} application form${created.copiedForms === 1 ? '' : 's'}`
                  : ''
              }.`
            );
            handleStatusChange('');
            fetchEvents();
          }}
        />
      )}

      {cancelling && (
        <CancelEventDialog
          eventName={cancelling.name}
          busy={cancelBusy}
          onConfirm={handleCancelConfirm}
          onClose={() => setCancelling(null)}
        />
      )}

      {/* Announced result count (a11y) */}
      {selectedOrgId && !eventsLoading && total > 0 && (
        <p role="status" className="mb-3 text-sm text-gray-500 dark:text-slate-400">
          {showingLine}
        </p>
      )}

      {/* Loading */}
      {eventsLoading && (
        <div className="space-y-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse h-32 bg-gray-200 dark:bg-slate-700 rounded-lg"
            />
          ))}
        </div>
      )}

      {/* Empty: no matches (filters active) */}
      {!eventsLoading && selectedOrgId && events.length === 0 && hasActiveFilters && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-slate-400 text-sm" role="status">
            No events match your filters
          </p>
          <button
            type="button"
            onClick={() => {
              router.replace(`/admin/events${searchParams.get('orgId') ? `?orgId=${searchParams.get('orgId')}` : ''}`, { scroll: false });
            }}
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Empty: no events yet */}
      {!eventsLoading && selectedOrgId && events.length === 0 && !hasActiveFilters && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8" role="status">
          No events yet. Click &quot;Create Event&quot; to get started.
        </p>
      )}

      {/* Event List */}
      {!eventsLoading && events.length > 0 && (
        <div className="space-y-3">
          {events.map((event) => {
            const isExpanded = expandedEventId === event.id;
            return (
              <EventListCard
                key={event.id}
                event={event}
                selectedOrgId={selectedOrgId}
                isExpanded={isExpanded}
                onToggleExpand={() => toggleExpand(event.id)}
                onPublish={() => handlePublish(event.id)}
                onDuplicate={() => setDuplicating({ id: event.id, name: event.name })}
                onCancelEvent={() => setCancelling({ id: event.id, name: event.name })}
              />
            );
          })}

          {/* Pagination */}
          <EventsPagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={LIMIT}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}

// ── Outer shell: Suspense wrapper for useSearchParams ──

export default function DashboardEventsPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 w-48 bg-gray-200 dark:bg-slate-700 rounded" />
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
          <div className="h-10 w-full bg-gray-200 dark:bg-slate-700 rounded" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      </div>
    }>
      <EventsListContent />
    </Suspense>
  );
}