'use client';

// Dashboard events management page — per-tier inventory view per FR-040, T064
// Org-scoped event listing with status filter, publish/cancel actions, tier inventory

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import OrganizationSelector, { type Organization } from '@/components/OrganizationSelector';

interface PriceTier {
  id: string;
  name: string;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  quantityAvailable: number;
  displayOrder: number;
  isActive: boolean;
}

interface EventVenue {
  id: string;
  name: string;
  address: string;
}

interface Event {
  id: string;
  name: string;
  description?: string;
  date: string;
  capacity: number;
  category?: string;
  status: string;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  createdAt: string;
  updatedAt: string;
}

interface EventListResponse {
  events: Event[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type StatusFilter = '' | 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300',
  PUBLISHED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DashboardEventsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Fetch orgs
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const data = await api.get<Organization[]>('/organizations');
        setOrganizations(data);
        if (data.length > 0) setSelectedOrgId(data[0].id);
      } catch (err: any) {
        setError(err.message || 'Failed to load organizations');
      } finally {
        setLoading(false);
      }
    };
    fetchOrgs();
  }, []);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setEventsLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const data = await api.get<EventListResponse>(
        `/organizations/${selectedOrgId}/events?${params.toString()}`
      );
      setEvents(data.events);
      setTotalPages(data.pagination.totalPages);
    } catch (err: any) {
      setError(err.message || 'Failed to load events');
    } finally {
      setEventsLoading(false);
    }
  }, [selectedOrgId, page, statusFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleOrgSelect = (orgId: string) => {
    setSelectedOrgId(orgId);
    setPage(1);
    setExpandedEventId(null);
  };

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

  const handleCancel = async (eventId: string) => {
    if (!selectedOrgId || !confirm('Are you sure you want to cancel this event?')) return;
    try {
      setError(null);
      await api.post(`/organizations/${selectedOrgId}/events/${eventId}/cancel`, {});
      await fetchEvents();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel event');
    }
  };

  const toggleExpand = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
        {selectedOrgId && (
          <Link
            href="/dashboard/events/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Create Event
          </Link>
        )}
      </div>

      {/* Org Selector */}
      <div className="mb-6">
        <OrganizationSelector
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelect={handleOrgSelect}
          loading={loading}
        />
      </div>

      {/* Status Filter */}
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

      {/* Loading */}
      {eventsLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-24 bg-gray-200 dark:bg-slate-700 rounded-lg" />
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
            const totalSold = event.priceTiers.reduce((s, t) => s + t.quantitySold, 0);
            const totalAvailable = event.priceTiers.reduce((s, t) => s + t.quantityAvailable, 0);

            return (
              <div
                key={event.id}
                className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
              >
                {/* Event Row */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                          {event.name}
                        </h3>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            statusColors[event.status] || ''
                          }`}
                        >
                          {event.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-slate-400">
                        <span>📅 {formatDate(event.date)}</span>
                        {event.venue && <span>📍 {event.venue.name}</span>}
                        {event.category && <span>🏷 {event.category}</span>}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400 dark:text-slate-500">
                        <span>
                          🎫 {totalSold} sold / {totalAvailable} avail / {event.capacity} cap
                        </span>
                        <span>{event.priceTiers.length} tier(s)</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => toggleExpand(event.id)}
                        className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                      >
                        {isExpanded ? 'Hide Tiers' : 'Show Tiers'}
                      </button>
                      {event.status === 'PUBLISHED' && (
                        <Link
                          href={`/dashboard/events/${event.id}/analytics`}
                          className="rounded-md border border-indigo-300 dark:border-indigo-700 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                        >
                          Analytics
                        </Link>
                      )}
                      {event.status === 'DRAFT' && (
                        <button
                          onClick={() => handlePublish(event.id)}
                          className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-500"
                        >
                          Publish
                        </button>
                      )}
                      {event.status === 'PUBLISHED' && (
                        <button
                          onClick={() => handleCancel(event.id)}
                          className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Price Tier Inventory */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-4 py-3">
                    {event.priceTiers.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-slate-400">No price tiers</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                            <th className="pb-2">Tier</th>
                            <th className="pb-2">Price</th>
                            <th className="pb-2">Total</th>
                            <th className="pb-2">Sold</th>
                            <th className="pb-2">Reserved</th>
                            <th className="pb-2">Available</th>
                            <th className="pb-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                          {event.priceTiers
                            .sort((a, b) => a.displayOrder - b.displayOrder)
                            .map((tier) => {
                              const pct =
                                tier.quantityTotal > 0
                                  ? Math.round((tier.quantitySold / tier.quantityTotal) * 100)
                                  : 0;
                              return (
                                <tr key={tier.id} className="text-gray-900 dark:text-slate-100">
                                  <td className="py-2 font-medium">{tier.name}</td>
                                  <td className="py-2">{formatPrice(tier.price)}</td>
                                  <td className="py-2">{tier.quantityTotal}</td>
                                  <td className="py-2">{tier.quantitySold}</td>
                                  <td className="py-2">{tier.quantityReserved}</td>
                                  <td className="py-2">
                                    <span
                                      className={
                                        tier.quantityAvailable === 0
                                          ? 'text-red-600 dark:text-red-400 font-semibold'
                                          : ''
                                      }
                                    >
                                      {tier.quantityAvailable}
                                    </span>
                                  </td>
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                                        <div
                                          className="bg-indigo-600 h-1.5 rounded-full"
                                          style={{ width: `${Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                      <span className="text-xs text-gray-500 dark:text-slate-400">
                                        {pct}%
                                      </span>
                                      {!tier.isActive && (
                                        <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                          Inactive
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
