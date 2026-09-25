'use client';

// Booth-first selection step on the apply form (spec 037).
//
// Deliberately smaller than BoothPicker: this one only *picks*. No hold, no
// countdown, no payment. The booth id rides along with the submission and the
// server takes the hold inside the same transaction that creates the
// application — so there is nothing here to abandon, and no state to reconcile
// if the applicant closes the tab halfway through the form.
//
// The map it draws is the same public map patrons see, so a booth that looks
// taken here is taken. It can still go between this render and submit; that is
// what the 409 on submit is for, and the parent refetches on one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapsApi, type MapBooth, type MapElement, type PublicMap } from '@/services/api';
import MapCanvas from './MapCanvas';
import MapLegend, { type LegendTier } from './MapLegend';
import { selectability } from './boothSelection';

interface ApplyBoothStepProps {
  /** Event id (not slug): `GET /events/:id/map` resolves ids only. */
  eventId: string;
  /** The tier being applied for; only its booths are selectable. */
  tierId: string | null;
  tierName: string | null;
  selectedBoothId: string | null;
  onSelect: (boothId: string | null) => void;
  /** Bumped by the parent after a BOOTH_TAKEN submit, to refetch the map. */
  refreshKey?: number;
}

function toMapBooth(pb: PublicMap['booths'][number]): MapBooth {
  return {
    id: pb.id,
    mapId: '',
    label: pb.label,
    kind: pb.kind,
    x: pb.x,
    y: pb.y,
    w: pb.w,
    h: pb.h,
    rotation: pb.rotation,
    tierId: pb.tier?.id || null,
    status: pb.status,
    applicationId: null,
    assignedById: null,
    createdAt: '',
    updatedAt: '',
    holder: pb.vendorName ? { id: '', status: '', paymentStatus: '', businessName: pb.vendorName } : null,
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export default function ApplyBoothStep({
  eventId,
  tierId,
  tierName,
  selectedBoothId,
  onSelect,
  refreshKey = 0,
}: ApplyBoothStepProps) {
  const reducedMotion = useReducedMotion();
  const [map, setMap] = useState<PublicMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const etagRef = useRef<string | null>(null);

  const fetchMap = useCallback(async () => {
    try {
      const data = await mapsApi.getPublicEventMap(eventId, etagRef.current ?? undefined);
      if (data) {
        setMap(data);
        etagRef.current = data.etag;
        setError(null);
      }
    } catch (err: any) {
      if (err?.status === 304) return;
      setError(err?.status === 404 ? 'The floor map is not open yet. Check back soon.' : err?.message || 'Could not load the floor map');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    // `refreshKey` changes when a submission lost the booth race.
    etagRef.current = null;
    fetchMap();
  }, [fetchMap, refreshKey]);

  const booths = useMemo(() => map?.booths ?? [], [map]);
  const sets = useMemo(() => selectability(booths, tierId), [booths, tierId]);
  const legendTiers: LegendTier[] = useMemo(
    () => (map?.legend ?? []).map((l) => ({ id: l.tierId, name: l.name, price: l.price, swatch: l.swatch })),
    [map]
  );
  const tierSwatches = useMemo(() => Object.fromEntries((map?.legend ?? []).map((l) => [l.tierId, l.swatch])), [map]);
  const elements: MapElement[] = useMemo(
    () => (map?.layout?.elements ?? []).map((el) => ({ ...el, kind: el.kind as MapElement['kind'] })),
    [map]
  );
  const boothsForCanvas = useMemo(() => booths.map(toMapBooth), [booths]);

  // A selection from another tier stops making sense the moment the tier changes.
  useEffect(() => {
    if (!selectedBoothId) return;
    const still = booths.find((b) => b.id === selectedBoothId);
    if (booths.length > 0 && (!still || still.tier?.id !== tierId)) onSelect(null);
  }, [tierId, booths, selectedBoothId, onSelect]);

  const selected = booths.find((b) => b.id === selectedBoothId) ?? null;
  const selectedIds = useMemo(() => new Set(selectedBoothId ? [selectedBoothId] : []), [selectedBoothId]);

  if (loading) {
    return (
      <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="apply-booth-loading">
        Loading the floor map…
      </p>
    );
  }
  if (error || !map) {
    return (
      <p role="alert" className="text-sm text-gray-600 dark:text-slate-400" data-testid="apply-booth-unavailable">
        {error || 'The floor map is not open yet.'}
      </p>
    );
  }

  return (
    <div data-testid="apply-booth-step" className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-slate-400">
        {tierId
          ? `Tap an available ${tierName ?? 'booth'} spot. It is held for you while the organizer reviews your application, and only charged if you are approved.`
          : 'Choose an option above to see which booths you can pick.'}
      </p>

      <div className="grid gap-3 lg:grid-cols-4">
        <div
          className="lg:col-span-3 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900/40"
          style={{ height: '24rem' }}
        >
          <MapCanvas
            width={map.width}
            height={map.height}
            gridSize={map.gridSize}
            unit={map.unit}
            underlayUrl={map.underlayUrl}
            underlayOpacity={map.underlayOpacity}
            elements={elements}
            booths={boothsForCanvas}
            interactive
            selectedIds={selectedIds}
            selectionHandles={false}
            dimmedIds={sets.dimmed}
            disabledIds={sets.disabled}
            tierSwatches={tierSwatches}
            onBoothClick={(booth) => {
              if (!sets.selectable.has(booth.id)) return;
              onSelect(selectedBoothId === booth.id ? null : booth.id);
            }}
            reducedMotion={reducedMotion}
          />
        </div>
        <div className="lg:col-span-1 rounded-lg border border-gray-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900/40">
          <MapLegend tiers={legendTiers} showStates selectedTierId={tierId} />
        </div>
      </div>

      {selected ? (
        <p
          data-testid="apply-booth-selected"
          role="status"
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
        >
          Applying for booth <strong>{selected.label}</strong> · {selected.w}×{selected.h}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-3 font-semibold text-brand-link hover:underline"
          >
            Change
          </button>
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-slate-400" data-testid="apply-booth-hint">
          {!tierId
            ? 'No option chosen yet.'
            : sets.selectable.size === 0
              ? 'No booths are left in this option right now. You can still apply for another option.'
              : `${sets.selectable.size} booth${sets.selectable.size === 1 ? '' : 's'} available in this option.`}
        </p>
      )}
    </div>
  );
}
