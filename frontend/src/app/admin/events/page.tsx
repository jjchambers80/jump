'use client';

// Events management page — full-width shell, new header and event cards (spec 035B).
// Data fetching, state management, and the status filter stay here; layout is the
// new mx-auto w-full max-w-screen-2xl px-4 sm:px-6 shell.

import React, { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import EventsPageHeader from '@/components/events/EventsPageHeader';
import EventListCard, { type AdminEvent } from '@/components/events/EventListCard';
import EventsPagination from '@/components/events/EventsPagination';
import CancelEventDialog from '@/components/events/CancelEventDialog';
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

type StatusFilter = '' | 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

export default function DashboardEventsPage() {
  const { selectedOrgId } = useOrg();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<{ id: string; name: string } | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; name: string } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setEventsLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (statusFilter) params.set('status', statusFilter);
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
  }, [selectedOrgId, page, statusFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Reset pagination when org changes
  useEffect(() => {
    setPage(1);
    setExpandedEventId(null);
  }, [selectedOrgId]);

  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handlePublish = async (eventId: string) => {
    if (!selectedOrgId) return;
    try {
      setError(null);
      await api.post(`/organizations/${selectedOrgId}/events/${eventId}/publish`, {});
      await fetchEvents();
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
    } catch (err: any) {
      setError(err.message || 'Failed to cancel event');
      setCancelBusy(false);
    }
  };

  const toggleExpand = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

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

      {/* Status Filter — kept here until 035C moves it to EventsToolbar */}
      <div className="mb-4 flex gap-2">
        {(['', 'DRAFT', 'PUBLISHED', 'CANCELLED'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

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
            setStatusFilter('');
            setPage(1);
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

      {/* Empty */}
      {!eventsLoading && selectedOrgId && events.length === 0 && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8">
          No events found. Click &quot;Create Event&quot; to get started.
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
            limit={25}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}