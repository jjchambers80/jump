'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import api, { mapsApi } from '@/services/api';
import { useAccountFormat } from '@/lib/accountFormat';
import type { AdminMap, FloorPlanSummary } from '@/services/api';
import {
  Plus,
  Map,
  ExternalLink,
  Trash2,
  Loader2,
  AlertTriangle,
  Eye,
  LayoutTemplate,
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
  // Saved floor plans (spec 037 D1): layouts reused by copying onto an event.
  const [plans, setPlans] = useState<FloorPlanSummary[]>([]);
  const [createPlanId, setCreatePlanId] = useState('');

  const loadMaps = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const [data, floorPlans] = await Promise.all([mapsApi.list(), mapsApi.floorPlans().catch(() => [])]);
      setMaps(data);
      setPlans(floorPlans);
    } catch (err: any) {
      setError(err?.message || 'Failed to load maps');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (selectedOrgId) loadMaps();
  }, [selectedOrgId, loadMaps]);

  const openCreateDialog = useCallback(async (planId: string = '') => {
    setCreatePlanId(planId);
    setShowCreateDialog(true);
    setCreateEventId('');
    setCreateName('');
    setCreateError(null);
    setEventsLoading(true);
    try {
      // Fetch events without maps
      const data = await api.get<{ events: { id: string; name: string; date: string }[] }>(
        `/organizations/${selectedOrgId}/events?limit=100`
      );
      const mapEventIds = new Set(maps.map((m) => m.eventId));
      setEvents(data.events.filter((e) => !mapEventIds.has(e.id)));
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
      const result = createPlanId
        ? await mapsApi.createFromFloorPlan(createEventId, createPlanId, createName || undefined)
        : await mapsApi.create({ eventId: createEventId, name: createName || undefined });
      setShowCreateDialog(false);
      router.push(`/admin/maps/${result.id}`);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create map');
    } finally {
      setCreating(false);
    }
  }, [createEventId, createName, createPlanId, router]);

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
        <Loader2 className="w-6 h-6 animate-spin text-accent-600 dark:text-accent-400" />
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
            className="px-4 py-2 bg-accent-500 text-gray-950 rounded text-sm hover:bg-accent-hover"
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
            One floor map per event. Save a layout as a floor plan to reuse it on another event.
          </p>
        </div>
        <button
          onClick={() => openCreateDialog()}
          className="flex items-center gap-2 px-4 py-2 bg-accent-500 text-gray-950 rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
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
            onClick={() => openCreateDialog()}
            className="px-4 py-2 bg-accent-500 text-gray-950 rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
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
                      className="text-sm font-medium text-accent-600 dark:text-accent-400 hover:underline"
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

      {/* Floor plans */}
      <section aria-labelledby="floor-plans-title" className="mt-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="floor-plans-title" className="text-lg font-semibold text-gray-900 dark:text-white">Floor plans</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Saved layouts. Using one copies it onto an event; changing the copy never changes the plan.
            </p>
          </div>
        </div>
        {plans.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-slate-600 dark:text-slate-400">
            No floor plans yet. Open a map and choose <span className="font-medium">Save as floor plan</span>.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="floor-plans">
            {plans.map((plan) => (
              <li key={plan.id} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                    <LayoutTemplate className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{plan.name}</p>
                    <p className="text-xs tabular-nums text-gray-500 dark:text-slate-400">
                      {plan.boothCount} booth{plan.boothCount === 1 ? '' : 's'}
                      {plan.width && plan.height ? ` · ${plan.width}×${plan.height}` : ''} · updated{' '}
                      {formatDateTime(plan.updatedAt, { dateStyle: 'medium' })}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openCreateDialog(plan.id)}
                    className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-accent-hover"
                  >
                    Use on an event
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete floor plan ${plan.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete the floor plan "${plan.name}"? Maps already made from it are kept.`)) return;
                      try {
                        await mapsApi.removeFloorPlan(plan.id);
                        setPlans((prev) => prev.filter((p) => p.id !== plan.id));
                      } catch (err: any) {
                        setError(err?.message || 'Failed to delete the floor plan');
                      }
                    }}
                    className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create map dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {createPlanId ? `Use "${plans.find((p) => p.id === createPlanId)?.name ?? 'floor plan'}" on an event` : 'Create floor map'}
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
                className="px-4 py-2 text-sm bg-accent-500 text-gray-950 hover:bg-accent-hover rounded transition-colors disabled:opacity-50"
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
          <Loader2 className="w-6 h-6 animate-spin text-accent-600 dark:text-accent-400" />
        </div>
      }
    >
      <MapsListContent />
    </Suspense>
  );
}