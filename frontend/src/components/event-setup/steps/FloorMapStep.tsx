'use client';

// Floor map step of the vendor flow (spec 050-M, moved by spec 051): shown when a vendor form lets
// vendors pick their space on a map. No map yet → a blank map or a copy of a
// saved floor plan (the Event › Map tab's create calls). A map → its status,
// booths and tier bindings, and the builder, which comes back here (`returnTo`).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { mapsApi, type AdminMapDetail, type FloorPlanSummary } from '@/services/api';
import LoadingFields from '../LoadingFields';
import { secondaryButton } from '../ui';
import { MapSummary, NewMap } from './FloorMapParts';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: AdminMapDetail | null; plans: FloorPlanSummary[] };


const NO_ACCESS = "You don't have access to this map.";
const messageOf = (err: unknown, fallback: string) => {
  const e = err as { status?: number; message?: string } | null;
  return e?.status === 403 ? NO_ACCESS : e?.message || fallback;
};

interface Props {
  eventId: string;
  /** Where the map builder comes back to. */
  returnTo: string;
  refreshPreview: () => void;
  /** The map's status once loaded or created (the step is complete when PUBLISHED). */
  onMapStatus: (status: AdminMapDetail['status'] | null) => void;
}

export default function FloorMapStep({ eventId, returnTo, refreshPreview, onMapStatus }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const created = useRef(false);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const reload = () => {
    setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

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
      if (cancelled) return;
      setLoad({ status: 'ready', map, plans });
      onMapStatus(map?.status ?? null);
    })().catch((err) => {
      if (!cancelled) setLoad({ status: 'error', message: messageOf(err, 'Request failed') });
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt, onMapStatus]);

  // After a create (or finding the map someone else made), focus its summary.
  useEffect(() => {
    if (load.status !== 'ready' || !load.map || !created.current) return;
    created.current = false;
    summaryHeading.current?.focus();
  }, [load]);

  const create = useCallback(
    async (templateId: string | null) => {
      setBusy(templateId ?? 'blank');
      setError(null);
      try {
        const map = templateId ? await mapsApi.createFromFloorPlan(eventId, templateId) : await mapsApi.create({ eventId });
        created.current = true;
        setNotice(`${map.name} created.`);
        setLoad({ status: 'ready', map, plans: [] });
        onMapStatus(map.status);
        refreshPreview();
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e?.status === 409 && /MAP_EXISTS/.test(e.message ?? '')) {
          // Made meanwhile (another tab or person): show that map instead.
          created.current = true;
          setNotice('This event already has a floor map.');
          setLoad({ status: 'loading' });
          setAttempt((n) => n + 1);
        } else setError(messageOf(err, "Couldn't create the map"));
      } finally {
        setBusy(null);
      }
    },
    [eventId, refreshPreview, onMapStatus]
  );

  if (load.status === 'loading') return <LoadingFields />;
  if (load.status === 'error')
    return (
      <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
        <p>Couldn&apos;t load this event&apos;s floor map: {load.message}</p>
        <button type="button" onClick={reload} className={`${secondaryButton} mt-3`}>
          Try again
        </button>
      </div>
    );

  const { map, plans } = load;
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm text-green-800 empty:hidden dark:text-green-300">{notice}</p>
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
            {map
              ? 'Vendors choose spots on the floor map, but the map is not published.'
              : 'No floor map yet. Vendors choose spots on the floor map, so create one and publish it.'}
          </span>
        </p>
      )}
      {map ? <MapSummary map={map} returnTo={returnTo} headingRef={summaryHeading} /> : <NewMap plans={plans} busy={busy} onCreate={create} />}
    </div>
  );
}
