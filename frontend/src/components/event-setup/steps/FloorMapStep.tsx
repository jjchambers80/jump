'use client';

// Step 9, Floor map (spec 050 §5.1, card 050-M): shown when a vendor form lets
// vendors pick their space on a map. No map yet → a blank map or a copy of a
// saved floor plan (the Event › Map tab's create calls). A map → its status,
// booths and tier bindings, and the builder, which comes back here (`returnTo`).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, LayoutTemplate, Map as MapIcon, Plus } from 'lucide-react';
import { mapsApi, type AdminMapDetail, type FloorPlanSummary } from '@/services/api';
import LoadingFields from '../LoadingFields';
import { primaryButton, secondaryButton } from '../ui';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: AdminMapDetail | null; plans: FloorPlanSummary[] };

const card = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const builderHref = (mapId: string, eventId: string) =>
  `/admin/maps/${mapId}?returnTo=${encodeURIComponent(`/admin/events/${eventId}/setup?step=floor-map`)}`;

export default function FloorMapStep({ eventId, refreshPreview }: { eventId: string; refreshPreview: () => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await mapsApi.getEventMapId(eventId).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      });
      const [map, plans] = found
        ? [await mapsApi.get(found.mapId), []]
        : [null, await mapsApi.floorPlans().catch(() => [] as FloorPlanSummary[])];
      if (!cancelled) setLoad({ status: 'ready', map, plans });
    })().catch((err) => {
      if (!cancelled) setLoad({ status: 'error', message: err?.message || 'Request failed' });
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  const create = useCallback(
    async (templateId: string | null) => {
      setBusy(templateId ?? 'blank');
      setError(null);
      try {
        const map = templateId ? await mapsApi.createFromFloorPlan(eventId, templateId) : await mapsApi.create({ eventId });
        setLoad({ status: 'ready', map, plans: [] });
        refreshPreview();
      } catch (err) {
        setError((err as Error)?.message || "Couldn't create the map");
      } finally {
        setBusy(null);
      }
    },
    [eventId, refreshPreview]
  );

  if (load.status === 'loading') return <LoadingFields />;
  if (load.status === 'error')
    return (
      <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
        <p>Couldn&apos;t load this event&apos;s floor map: {load.message}</p>
        <button type="button" onClick={() => { setLoad({ status: 'loading' }); setAttempt((n) => n + 1); }} className={`${secondaryButton} mt-3`}>
          Try again
        </button>
      </div>
    );

  const { map, plans } = load;
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      {map?.status !== 'PUBLISHED' && (
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">Warning: </span>
            Vendors choose spots on the floor map, but the map is not published.
          </span>
        </p>
      )}
      {map ? <MapSummary map={map} eventId={eventId} /> : <NewMap plans={plans} busy={busy} onCreate={create} />}
    </div>
  );
}

function MapSummary({ map, eventId }: { map: AdminMapDetail; eventId: string }) {
  const bound = map.tiers.filter((t) => map.booths.some((b) => b.tierId === t.id));
  const unpriced = map.booths.filter((b) => !b.tierId).length;
  const published = map.status === 'PUBLISHED';
  return (
    <section aria-labelledby="setup-map-title" className={card} data-testid="setup-map-summary">
      <h2 id="setup-map-title" className="flex flex-wrap items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
        <span className="min-w-0 break-words">{map.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${published ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'}`}>
          {published ? 'Published' : 'Draft'}
        </span>
      </h2>
      <dl className="mt-3 grid gap-2 text-sm text-gray-700 dark:text-slate-300 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="font-medium text-gray-900 dark:text-white">Booths</dt>
        <dd>{map.booths.length ? `${plural(map.booths.length, 'booth')}${unpriced ? `, ${unpriced} without a tier` : ''}` : 'No booths yet'}</dd>
        <dt className="font-medium text-gray-900 dark:text-white">Tiers on the map</dt>
        <dd>{bound.length ? bound.map((t) => t.name).join(', ') : 'None yet: give booths a tier in the builder so vendors can buy them'}</dd>
      </dl>
      <Link href={builderHref(map.id, eventId)} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
        <MapIcon className="h-4 w-4" aria-hidden />
        Open map builder
      </Link>
    </section>
  );
}

interface NewMapProps {
  plans: FloorPlanSummary[];
  busy: string | null;
  onCreate: (templateId: string | null) => void;
}

function NewMap({ plans, busy, onCreate }: NewMapProps) {
  return (
    <section aria-labelledby="setup-map-title" className={card}>
      <h2 id="setup-map-title" className="text-base font-semibold text-gray-900 dark:text-white">No floor map yet</h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">
        The map is optional. Draw the floor and place booths, and approved vendors pick their own spot on it.
      </p>
      <button type="button" onClick={() => onCreate(null)} disabled={!!busy} aria-busy={busy === 'blank'} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
        <Plus className="h-4 w-4" aria-hidden />
        {busy === 'blank' ? 'Creating…' : 'Create a blank map'}
      </button>
      <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">Start from a floor plan</h3>
      {plans.length ? (
        <ul className="mt-2 space-y-2">
          {plans.map((plan) => (
            <li key={plan.id}>
              <button type="button" onClick={() => onCreate(plan.id)} disabled={!!busy} aria-busy={busy === plan.id} className={`${secondaryButton} w-full justify-start text-left`}>
                <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="sr-only">Use floor plan </span>
                  {plan.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-slate-400">{plural(plan.boothCount, 'booth')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          No saved floor plans yet. In any map, choose Save as floor plan to reuse its layout here.
        </p>
      )}
    </section>
  );
}
