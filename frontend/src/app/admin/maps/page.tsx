'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import { mapsApi } from '@/services/api';
import { useAccountFormat } from '@/lib/accountFormat';
import type { AdminMap } from '@/services/api';
import {
  Plus,
  Map,
  ExternalLink,
  Trash2,
  Loader2,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { formatEventDate } from '@/lib/eventTime';

function MapsListContent() {
  const router = useRouter();
  const { selectedOrgId } = useOrg();
  const { formatDateTime } = useAccountFormat();
  const [maps, setMaps] = useState<AdminMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createEventId, setCreateEventId] = useState('');
  const [createName, setCreateName] = useState('');
  const [events, setEvents] = useState<{ id: string; name: string; date: string }[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteMapId, setDeleteMapId] = useState<string | null>(null);

  const loadMaps = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await mapsApi.list();
      setMaps(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load maps');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (selectedOrgId) loadMaps();
  }, [selectedOrgId, loadMaps]);

  const openCreateDialog = useCallback(async () => {
    setShowCreateDialog(true);
    setCreateEventId('');
    setCreateName('');
    setCreateError(null);
    setEventsLoading(true);
    try {
      // Fetch events without maps
      const res = await fetch('/admin/events', {
        headers: { 'X-Jump-Org': selectedOrgId || '', 'Content-Type': 'application/json' },
      });
      const allEvents = await res.json();
      const data = Array.isArray(allEvents) ? allEvents : allEvents.data || [];
      const mapEventIds = new Set(maps.map((m) => m.eventId));
      setEvents(data.filter((e: any) => !mapEventIds.has(e.id)));
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [selectedOrgId, maps]);

  const handleCreate = useCallback(async () => {
    if (!createEventId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await mapsApi.create({ eventId: createEventId, name: createName || undefined });
      setShowCreateDialog(false);
      router.push(`/admin/maps/${result.id}`);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create map');
    } finally {
      setCreating(false);
    }
  }, [createEventId, createName, router]);

  const handleDelete = useCallback(
    async (mapId: string) => {
      try {
        await mapsApi.remove(mapId);
        setMaps((prev) => prev.filter((m) => m.id !== mapId));
      } catch (err: any) {
        setError(err?.message || 'Failed to delete map');
      }
      setDeleteMapId(null);
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error && maps.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Could not load maps</h2>
          <p className="text-gray-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={loadMaps}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const boothSummary = (m: AdminMap) => {
    const total = m.boothCount;
    const sold = m.soldCount;
    return total > 0 ? `${sold} / ${total}` : '—';
  };

  const statusPill = (status: string) =>
    status === 'PUBLISHED'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Maps</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Floor maps for your events. Create a map, add booths, assign tiers, then publish.
          </p>
        </div>
        <button
          onClick={openCreateDialog}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create map
        </button>
      </div>

      {maps.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
          <Map className="w-16 h-16 text-gray-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No floor maps yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md mx-auto mb-6">
            Floor maps help you sell booth space visually. Create a map for an event, add booths
            and tables, assign them to tiers, then publish so applicants can see them.
          </p>
          <button
            onClick={openCreateDialog}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Create your first map
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Map
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Event
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Status
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Booths (sold / total)
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Published
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr
                  key={m.id}
                  data-testid="map-row"
                  className="border-b border-gray-100 dark:border-slate-700/50 hover:bg-gray-50 dark:hover:bg-slate-700/50"
                >
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/maps/${m.id}`}
                      className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {m.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                    {m.event?.name || '—'}
                    <span className="text-xs ml-1 text-gray-400">
                      {m.event?.date ? formatEventDate(m.event.date, m.event.timezone) : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded-full ${statusPill(m.status)}`}
                    >
                      {m.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700 dark:text-slate-300">
                    {boothSummary(m)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                    {m.publishedAt ? formatDateTime(m.publishedAt, { dateStyle: 'medium' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`/admin/maps/${m.id}`}
                        className="p-1.5 rounded text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                        title="Open editor"
                      >
                        <Eye className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setDeleteMapId(m.id)}
                        className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete map"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create map dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Create floor map
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Event
                </label>
                {eventsLoading ? (
                  <div className="flex items-center text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Loading events…
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-slate-400 italic">
                    All your events already have a map, or no events exist yet.
                  </p>
                ) : (
                  <select
                    value={createEventId}
                    onChange={(e) => setCreateEventId(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select an event</option>
                    {events.map((evt) => (
                      <option key={evt.id} value={evt.id}>
                        {evt.name} ({new Date(evt.date).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Map name (optional)
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Defaults to event name"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>

              {createError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {createError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowCreateDialog(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!createEventId || creating}
                className="px-4 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create map'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {deleteMapId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Delete map?
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              This will delete the floor map and all its booths. This action cannot be undone.
              Maps with sold or held booths cannot be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteMapId(null)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteMapId)}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapsListPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      }
    >
      <MapsListContent />
    </Suspense>
  );
}