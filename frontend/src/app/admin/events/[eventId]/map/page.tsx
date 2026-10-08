'use client';

// Event › Map (spec 037 phase 2). An event has at most one floor map because
// booth state (held, sold) belongs to the event. With a map, this tab opens
// the builder; without one, it offers a blank map or a copy of a saved floor
// plan (FloorMapTemplate).

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutTemplate, Loader2, Plus } from 'lucide-react';
import EventWorkspaceHeader, { useEventWorkspace } from '@/components/events/EventWorkspace';
import { mapsApi, type FloorPlanSummary } from '@/services/api';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';

export default function EventMapPage({ params }: { params: { eventId: string } }) {
  const router = useRouter();
  const { facts } = useEventWorkspace(params.eventId);
  const [plans, setPlans] = useState<FloorPlanSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An event that already has a map goes straight to its builder.
  useEffect(() => {
    if (facts?.mapId) router.replace(`/admin/maps/${facts.mapId}`);
  }, [facts?.mapId, router]);

  useEffect(() => {
    if (!facts || facts.mapId) return;
    mapsApi
      .floorPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [facts]);

  const create = useCallback(
    async (templateId: string | null) => {
      setBusy(templateId ?? 'blank');
      setError(null);
      try {
        const map = templateId
          ? await mapsApi.createFromFloorPlan(params.eventId, templateId)
          : await mapsApi.create({ eventId: params.eventId });
        router.push(`/admin/maps/${map.id}`);
      } catch (err: any) {
        setError(err?.message || 'Could not create the map');
        setBusy(null);
      }
    },
    [params.eventId, router]
  );

  const waiting = !facts || facts.mapId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <EventWorkspaceHeader eventId={params.eventId} current="map" title="Map" />

      {waiting ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500 dark:text-slate-400" aria-busy="true">
          <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Opening the map…
        </div>
      ) : (
        <section aria-labelledby="new-map-title" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
          <h2 id="new-map-title" className="text-base font-semibold text-gray-900 dark:text-white">
            This event has no floor map yet
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-slate-400">
            Draw the floor, place booths and bind them to vendor space tiers. Once published, approved vendors pick their own booth.
          </p>

          {error && (
            <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </p>
          )}

          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <button
                type="button"
                onClick={() => create(null)}
                disabled={!!busy}
                className={`group flex h-full w-full flex-col items-start rounded-lg border-2 border-dashed border-gray-300 p-4 text-left hover:border-accent-400 hover:bg-accent-50/40 disabled:opacity-60 dark:border-slate-600 dark:hover:border-accent-400/70 dark:hover:bg-accent-950/30 ${focusRing}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-50 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300">
                  {busy === 'blank' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                </span>
                <span className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">Blank map</span>
                <span className="text-xs text-gray-500 dark:text-slate-400">Start from an empty floor</span>
              </button>
            </li>
            {(plans ?? []).map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => create(plan.id)}
                  disabled={!!busy}
                  aria-label={`Use floor plan ${plan.name}`}
                  className={`flex h-full w-full flex-col items-start rounded-lg border border-gray-200 p-4 text-left hover:border-accent-400 hover:shadow-sm disabled:opacity-60 dark:border-slate-600 dark:hover:border-accent-400/70 ${focusRing}`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                    {busy === plan.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LayoutTemplate className="h-4 w-4" aria-hidden />}
                  </span>
                  <span className="mt-3 truncate text-sm font-semibold text-gray-900 dark:text-white">{plan.name}</span>
                  <span className="text-xs tabular-nums text-gray-500 dark:text-slate-400">
                    Floor plan · {plan.boothCount} booth{plan.boothCount === 1 ? '' : 's'}
                    {plan.width && plan.height ? ` · ${plan.width}×${plan.height}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {plans && plans.length === 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
              No saved floor plans yet. In any map, use <span className="font-medium">Save as floor plan</span> to reuse its layout.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
