'use client';

// Choose your spot (spec 039 MAP forms), as a two-step workspace:
//   1. Spot   — the floor map and the list of open spots, kept in sync: a spot
//               chosen on the map is highlighted (and scrolled to) in the list,
//               one chosen in the list is centred on the map.
//   2. Review — extras and how to pay, only when the category offers extras or
//               a card is saved; otherwise step 1 holds the spot directly.
// `layout="page"` is the status page: mobile first (a short map pinned to the
// top of the screen while the list scrolls under it, a fixed action bar once a
// spot is chosen); from `lg` the map takes the left ~72 % and stays in view
// while the right column scrolls. `layout="inline"` (buyer account) keeps the
// stacked mobile layout. Both can open the map full screen: the same element
// becomes a fixed overlay (never a portal, which would remount the canvas).
//
// The workspace only chooses. Holding, charging and every payment state stay
// in ChooseSpace (`onHold`); nothing here treats a hold as a sale, and a spot
// taken meanwhile just refetches the map.

import { ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Expand, Lock, Minus, Plus, Scan, Shrink, X } from 'lucide-react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useTheme } from 'next-themes';
import { mapsApi, type MapBooth, type MapElement, type PublicMap } from '@/services/api';
import { formatPrice } from '@/lib/fees';
import type { SpaceCategory } from '@/lib/applications';
import MapCanvas from '@/components/maps/MapCanvas';
import { LEGEND_STATE_DARK, LEGEND_STATE_LIGHT, LEGEND_STATE_STROKE_DARK, LEGEND_STATE_STROKE_LIGHT, STATUS_LABELS, TIER_SWATCHES } from '@/components/maps/mapTheme';
import { selectability, sortSpots, type SpotSort } from '@/components/maps/boothSelection';

export type Spot = PublicMap['booths'][number];
export type HoldOutcome = 'done' | 'taken' | 'failed';

interface SpotWorkspaceProps {
  layout?: 'page' | 'inline';
  eventId: string;
  category: SpaceCategory;
  /** Page layout: the application at the top of the spots column. */
  summary?: ReactNode;
  /** Step 1 copy under the heading. */
  intro: ReactNode;
  /** Page layout: what follows the list (answers, account link). */
  footer?: ReactNode;
  notice: ReactNode | null;
  /** True while a hold or payment is in flight; `busyLabel` says which. */
  busy: boolean;
  busyLabel: string | null;
  /** Step 2 content. Null when there is nothing to review: step 1 holds directly. */
  review: { extras: ReactNode | null; payWith: ReactNode | null } | null;
  /** Chosen extras, for the review lines. */
  extraLines: { id: string; label: string; amount: number }[];
  /** A spot's all-in price on its own, and with the chosen extras (one fee calculation). */
  spotPrice: (spot: Spot) => number;
  totalFor: (spot: Spot) => number;
  actionLabel: (total: number) => string;
  onHold: (boothId: string) => Promise<HoldOutcome>;
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

function toMapBooth(pb: Spot): MapBooth {
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

const LEGEND_STATES = [
  ['AVAILABLE', 'Open'],
  ['SOLD', 'Taken'],
  ['RESERVED', 'Reserved'],
  ['BLOCKED', 'Blocked'],
] as const;

function Legend({ map, tierId, unit }: { map: PublicMap; tierId: string; unit: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const ordered = [...map.legend].sort((a, b) => (a.tierId === tierId ? -1 : b.tierId === tierId ? 1 : 0));
  return (
    <div data-testid="spot-legend" className="text-xs text-gray-700 dark:text-slate-300">
      <h3 className="sr-only">Map legend</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ordered.map((l) => {
          const swatch = TIER_SWATCHES[l.swatch % TIER_SWATCHES.length];
          const mine = l.tierId === tierId;
          const range = l.priceFrom !== undefined && l.priceTo !== undefined && l.priceFrom !== l.priceTo ? `${formatPrice(l.priceFrom)}–${formatPrice(l.priceTo)}` : formatPrice(l.priceFrom ?? l.price);
          return (
            <li key={l.tierId} className={`flex min-w-0 items-center gap-1.5 ${mine ? 'font-semibold text-gray-900 dark:text-slate-50' : 'opacity-70'}`}>
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: dark ? swatch.dark : swatch.light }} />
              <span className="truncate" title={l.name}>{l.name}</span>
              {mine ? (
                <span className="tabular-nums font-normal text-gray-600 dark:text-slate-400" data-testid={`legend-price-${l.tierId}`}>{range}</span>
              ) : (
                <span className="sr-only">, another category — cannot be chosen</span>
              )}
            </li>
          );
        })}
      </ul>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-gray-600 dark:text-slate-400" aria-label="Spot states">
        {LEGEND_STATES.map(([state, label]) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{
                backgroundColor: dark ? LEGEND_STATE_DARK[state] : LEGEND_STATE_LIGHT[state],
                border: `1px solid ${dark ? LEGEND_STATE_STROKE_DARK[state] : LEGEND_STATE_STROKE_LIGHT[state]}`,
              }}
            />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] opacity-40" style={{ backgroundColor: dark ? '#94a3b8' : '#64748b' }} />
          Faded: other categories
        </li>
      </ul>
      <p className="sr-only">Sizes are in {unit === 'm' ? 'metres' : 'feet'}.</p>
    </div>
  );
}

const iconButton =
  'grid h-10 w-10 place-items-center text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-link disabled:opacity-40 motion-reduce:transition-none dark:text-slate-200 dark:hover:bg-slate-700';

export default function SpotWorkspace({
  layout = 'page',
  eventId,
  category,
  summary,
  intro,
  footer,
  notice,
  busy,
  busyLabel,
  review,
  extraLines,
  spotPrice,
  totalFor,
  actionLabel,
  onHold,
}: SpotWorkspaceProps) {
  const page = layout === 'page';
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const baseId = useId();
  const reducedMotion = useReducedMotion();
  const [map, setMap] = useState<PublicMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<'spot' | 'review'>('spot');
  const [sort, setSort] = useState<SpotSort>('label');
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepMounted = useRef(false);
  const listId = `${baseId}-spots`;

  const fetchMap = useCallback(async () => {
    try {
      const data = await mapsApi.getPublicEventMap(eventId, etagRef.current ?? undefined);
      if (data) {
        setMap(data);
        etagRef.current = data.etag;
        setMapError(null);
      }
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 304) return;
      setMapError(e.status === 404 ? 'The floor plan is being updated. Check back soon.' : e.message || 'Could not load the floor map');
    }
  }, [eventId]);

  useEffect(() => {
    fetchMap();
  }, [fetchMap]);

  const booths = useMemo(() => map?.booths ?? [], [map]);
  const sets = useMemo(() => selectability(booths, category.id), [booths, category.id]);
  const spots = useMemo(() => sortSpots(booths.filter((b) => sets.selectable.has(b.id)), sort, category.applicantPays), [booths, sets, sort, category.applicantPays]);
  // Other categories' spots, greyed out under the vendor's own: what else is on
  // the floor, never choosable. Grouped in legend order, spots in label order.
  const otherGroups = useMemo(() => {
    const legend = map?.legend ?? [];
    return legend
      .filter((l) => l.tierId !== category.id)
      .map((l) => ({ tier: l, spots: sortSpots(booths.filter((b) => b.tier?.id === l.tierId), 'label', l.price) }))
      .filter((g) => g.spots.length > 0);
  }, [map, booths, category.id]);
  const selected = spots.find((s) => s.id === selectedId) ?? null;
  const swatchFor = useMemo(() => Object.fromEntries((map?.legend ?? []).map((l) => [l.tierId, l.swatch])), [map]);
  const mySwatchPair = TIER_SWATCHES[(swatchFor[category.id] ?? 0) % TIER_SWATCHES.length];
  const mySwatch = dark ? mySwatchPair.dark : mySwatchPair.light;
  const elements: MapElement[] = useMemo(() => (map?.layout?.elements ?? []).map((el) => ({ ...el, kind: el.kind as MapElement['kind'] })), [map]);
  const boothsForCanvas = useMemo(() => booths.map(toMapBooth), [booths]);
  const allIds = useMemo(() => new Set(booths.map((b) => b.id)), [booths]);
  const selectedIds = useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId]);
  const unit = map?.unit ?? 'ft';

  // A spot taken meanwhile drops out of the list; forget it and go back to step 1.
  useEffect(() => {
    if (map && selectedId && !spots.some((s) => s.id === selectedId)) {
      setSelectedId(null);
      setStep('spot');
    }
  }, [map, spots, selectedId]);

  // ─── Map viewport: fit on load and on width change, zoom buttons, centre a spot ──
  // Full screen, the top button row and the bottom bar cover the canvas edges:
  // fit and centre within what is left.
  const insets = useCallback(() => {
    if (!full) return { top: 0, bottom: 0 };
    const bar = mapBoxRef.current?.querySelector<HTMLElement>('[data-testid="space-map-full-bar"]');
    return { top: 64, bottom: bar?.offsetHeight ?? 0 };
  }, [full]);

  const fit = useCallback(
    (animate: boolean) => {
      const ref = transformRef.current;
      const el = canvasRef.current;
      if (!ref || !el || !map) return;
      const sw = map.width * map.gridSize;
      const sh = map.height * map.gridSize;
      const cw = el.clientWidth;
      const { top, bottom } = insets();
      const ch = el.clientHeight - top - bottom;
      if (!cw || ch <= 0 || !sw || !sh) return;
      const scale = Math.min(cw / sw, ch / sh) * 0.94;
      ref.setTransform((cw - sw * scale) / 2, top + (ch - sh * scale) / 2, scale, animate && !reducedMotion ? 200 : 0);
    },
    [map, reducedMotion, insets]
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const mapLoaded = Boolean(map);
  useEffect(() => {
    if (!mapLoaded) return;
    const el = canvasRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => fitRef.current(false));
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // Width only: a mobile address bar changing the height must not undo the vendor's zoom.
      if (Math.abs(el.clientWidth - lastWidth) < 24) return;
      lastWidth = el.clientWidth;
      fitRef.current(false);
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Refit when the map first loads, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  const centreOn = (spot: Spot) => {
    const ref = transformRef.current;
    const el = canvasRef.current;
    if (!ref || !el || !map) return;
    const scale = ref.state.scale;
    const { top, bottom } = insets();
    const cx = (spot.x + (spot.rotation === 90 ? spot.h : spot.w) / 2) * map.gridSize;
    const cy = (spot.y + (spot.rotation === 90 ? spot.w : spot.h) / 2) * map.gridSize;
    ref.setTransform(el.clientWidth / 2 - cx * scale, top + (el.clientHeight - top - bottom) / 2 - cy * scale, scale, reducedMotion ? 0 : 250);
  };

  // ─── Full screen: a fixed overlay over the page; Escape or Done leaves it ──
  const fullMounted = useRef(false);
  useEffect(() => {
    if (!fullMounted.current) {
      fullMounted.current = true;
      return;
    }
    // The box changed size (height too, which the observer ignores): refit, then keep the chosen spot centred.
    const frame = requestAnimationFrame(() => {
      fit(false);
      if (selected) centreOn(selected);
    });
    if (!full) return () => cancelAnimationFrame(frame);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      root.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  // Leaving the spot step (or a hold starting) closes full screen.
  useEffect(() => {
    if (step !== 'spot' || busy) setFull(false);
  }, [step, busy]);
  // Keyboard: Escape closes (after any open tip), Tab stays inside the overlay.
  const onFullKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!full) return;
    if (e.key === 'Escape' && !tip) {
      e.stopPropagation();
      setFull(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = Array.from(mapBoxRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ─── Choosing ──────────────────────────────────────────────────────────────
  const chooseFromMap = (booth: MapBooth) => {
    setTip(null);
    if (busy || step !== 'spot' || !sets.selectable.has(booth.id)) return;
    const next = selectedId === booth.id ? null : booth.id;
    setSelectedId(next);
    // Beside the map (lg), bring the matching row into view in the list.
    if (next && page && !full && window.matchMedia('(min-width: 1024px)').matches) {
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-spot-id="${next}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    }
  };

  // ─── Why a spot cannot be chosen: a small tip where the vendor tapped ─────
  const [tip, setTip] = useState<{ id: string; text: string; left: number; top: number; below: boolean; arrow: number } | null>(null);
  const reasonFor = (booth: MapBooth): string | null => {
    const spot = booths.find((b) => b.id === booth.id);
    if (!spot || busy) return null;
    const name = `Spot ${spot.label}`;
    if (step === 'review') return 'Go back to step 1 to change your spot.';
    if (!spot.tier) return `${name} is not for sale.`;
    if (spot.tier.id !== category.id) return `${name} is for ${spot.tier.name}. You are approved as ${category.name}, so it cannot be chosen.`;
    if (spot.status === 'SOLD') return `${name} is already taken.`;
    if (spot.status === 'HELD') return `${name} is on hold for another vendor right now. It may open up again soon.`;
    if (spot.status === 'RESERVED') return `${name} is reserved.`;
    return `${name} is not available.`;
  };
  const explainDisabled = (booth: MapBooth, e: React.MouseEvent) => {
    const text = reasonFor(booth);
    const box = canvasRef.current?.getBoundingClientRect();
    if (!text || !box) return;
    const half = 144; // half the tip's max width (17rem) plus an 8px margin, so it stays on the map
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const left = box.width <= half * 2 ? box.width / 2 : Math.min(Math.max(x, half), box.width - half);
    setTip((current) => (current?.id === booth.id ? null : { id: booth.id, text, left, top: y, below: y < 110, arrow: Math.max(-half + 16, Math.min(half - 16, x - left)) }));
  };
  useEffect(() => {
    if (!tip) return;
    const timer = setTimeout(() => setTip(null), 6000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTip(null);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [tip]);
  // A tip describes the map as it was; a step change or a refetch retires it.
  useEffect(() => setTip(null), [step, map]);

  const chooseFromList = (spot: Spot) => {
    if (busy) return;
    setSelectedId(spot.id);
    centreOn(spot);
  };

  // Moving between steps puts focus on the step's heading (and, stacked, scrolls to it).
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    // Beside the map the heading is usually in view already; stacked, it may be
    // far below, or under the map pinned to the top of a phone screen.
    const pinned = page && step === 'spot' && !window.matchMedia('(min-width: 1024px)').matches;
    const floor = pinned ? Math.max(0, mapBoxRef.current?.getBoundingClientRect().bottom ?? 0) : 0;
    const target = heading.parentElement ?? heading;
    const top = target.getBoundingClientRect().top;
    if (top < floor + 16 || top > floor + (window.innerHeight - floor) * 0.4) {
      window.scrollBy({ top: top - floor - 16, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const hold = async () => {
    if (!selected || busy) return;
    const outcome = await onHold(selected.id);
    if (outcome === 'taken') {
      setSelectedId(null);
      setStep('spot');
    }
    await fetchMap();
  };

  const primary = () => {
    if (!selected) return;
    if (step === 'spot' && review) setStep('review');
    else hold();
  };

  // ─── Pieces ────────────────────────────────────────────────────────────────
  const size = (s: Spot) => `${s.w}×${s.h}${unit ? ` ${unit}` : ''}`;
  const priceRange = spots.length > 0 ? (() => {
    const prices = spots.map(spotPrice);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? formatPrice(lo) : `${formatPrice(lo)}–${formatPrice(hi)}`;
  })() : null;
  const total = selected ? (step === 'review' ? totalFor(selected) : review ? spotPrice(selected) : totalFor(selected)) : null;
  const primaryLabel = busyLabel ?? (!selected ? (review ? 'Continue' : 'Choose a spot') : step === 'spot' && review ? 'Continue' : actionLabel(total ?? 0));

  const fullLabel = full ? 'Exit full screen' : 'Full screen';
  const mapPane = (
    <div
      className={
        page
          ? // Phones: pinned to the top while the list scrolls under it. lg: the left column.
            `${step === 'review' ? 'hidden lg:block' : ''} sticky top-0 ${full ? 'z-50' : 'z-20'} self-start shadow-[0_8px_16px_-12px_rgb(0_0_0/0.35)] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-dvh lg:border-r lg:border-gray-200 lg:shadow-none dark:lg:border-slate-800`
          : `relative ${full ? 'z-50' : ''} ${step === 'review' ? 'hidden' : ''}`
      }
      data-testid="space-map"
      data-full={full || undefined}
    >
      <div
        ref={mapBoxRef}
        role={full ? 'dialog' : undefined}
        aria-modal={full || undefined}
        aria-label={full ? 'Floor map, full screen' : undefined}
        onKeyDown={onFullKeyDown}
        data-testid="space-map-box"
        className={`w-full overflow-hidden bg-gray-100 dark:bg-slate-950 ${
          full
            ? 'fixed inset-0 z-50 h-dvh'
            : page
              ? 'relative h-[38svh] min-h-[15rem] max-h-[26rem] sm:h-[45svh] sm:max-h-[32rem] lg:h-full lg:max-h-none'
              : 'relative aspect-square rounded-xl border border-gray-200 dark:border-slate-700 sm:aspect-[4/3]'
        }`}
      >
        {/* Faint grid so the floor reads as a floor, not an empty box. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-40"
          style={{ backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / 0.35) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
        />
        <div ref={canvasRef} className="absolute inset-0" onPointerDown={() => tip && setTip(null)}>
          {map ? (
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
              disabledIds={busy || step === 'review' ? allIds : sets.disabled}
              tierSwatches={swatchFor}
              onBoothClick={chooseFromMap}
              onDisabledBoothClick={explainDisabled}
              reducedMotion={reducedMotion}
              transformRef={transformRef}
              ariaLabel={`Floor map. Open ${category.name} spots can be chosen; the list of spots offers the same choice.`}
            />
          ) : (
            <p className="grid h-full place-items-center px-6 text-center text-sm text-gray-600 dark:text-slate-400" role={mapError ? 'alert' : 'status'} data-testid={mapError ? 'spot-map-unavailable' : 'spot-map-loading'}>
              {mapError ?? 'Loading the floor map…'}
            </p>
          )}
        </div>

        {map && (
          <div role="group" aria-label="Map zoom" className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-sm backdrop-blur divide-y divide-gray-200 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/95">
            <button type="button" className={iconButton} aria-label="Zoom in" onClick={() => transformRef.current?.zoomIn(0.4, reducedMotion ? 0 : 150)}>
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={iconButton} aria-label="Zoom out" onClick={() => transformRef.current?.zoomOut(0.4, reducedMotion ? 0 : 150)}>
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={iconButton} aria-label="Fit the whole map" onClick={() => fit(true)}>
              <Scan className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {map && (
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            aria-pressed={full}
            data-testid="space-map-full"
            className={`absolute left-3 z-10 inline-flex h-10 items-center gap-2 rounded-full border border-gray-300 bg-white/95 pl-3.5 pr-4 text-sm font-semibold text-gray-900 shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-100 dark:hover:bg-slate-800 ${
              full ? 'top-[max(0.75rem,env(safe-area-inset-top))]' : page ? 'top-3 lg:bottom-3 lg:top-auto' : 'top-3'
            }`}
          >
            {full ? <Shrink className="h-4 w-4" aria-hidden /> : <Expand className="h-4 w-4" aria-hidden />}
            {fullLabel}
          </button>
        )}

        {tip && (
          <div
            role="status"
            data-testid="spot-disabled-tip"
            className="pointer-events-auto absolute z-20 w-max max-w-[17rem] -translate-x-1/2 rounded-xl bg-gray-900 py-2.5 pl-3 pr-9 text-sm leading-snug text-white shadow-lg ring-1 ring-black/10 dark:bg-slate-100 dark:text-slate-900"
            style={{ left: tip.left, top: tip.top, transform: `translate(-50%, ${tip.below ? '14px' : 'calc(-100% - 14px)'})` }}
          >
            <span className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
              <span>{tip.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setTip(null)}
              aria-label="Close"
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-lg opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white dark:focus-visible:ring-slate-900"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span
              aria-hidden
              style={{ left: `calc(50% + ${tip.arrow}px)` }}
              className={`absolute h-3 w-3 -translate-x-1/2 rotate-45 bg-gray-900 dark:bg-slate-100 ${tip.below ? '-top-1.5' : '-bottom-1.5'}`}
            />
          </div>
        )}

        {/* Beside the list (lg) the legend floats on the map; stacked, it sits under it. */}
        {map && page && !full && (
          <div className="absolute left-3 top-3 hidden max-w-[min(34rem,calc(100%-5rem))] rounded-xl border border-gray-200 bg-white/95 px-3.5 py-2.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 lg:block">
            <Legend map={map} tierId={category.id} unit={unit} />
          </div>
        )}

        {/* Full screen: the legend and the choice at the bottom, and a way back to the list. */}
        {map && full && (
          <div
            data-testid="space-map-full-bar"
            className="absolute inset-x-0 bottom-0 z-10 space-y-3 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:px-6"
          >
            <Legend map={map} tierId={category.id} unit={unit} />
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-slate-300" aria-live="polite">
                {selected ? (
                  <>
                    <span className="font-semibold text-gray-900 dark:text-slate-100">Spot {selected.label}</span> · {size(selected)} ·{' '}
                    <strong className="tabular-nums text-gray-900 dark:text-slate-50">{formatPrice(spotPrice(selected))}</strong>
                  </>
                ) : (
                  'Tap an open spot to choose it.'
                )}
              </p>
              <button
                type="button"
                onClick={() => setFull(false)}
                data-testid="space-map-full-done"
                className="inline-flex min-h-[2.75rem] shrink-0 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
              >
                {selected ? 'Done' : 'Back to list'}
              </button>
            </div>
          </div>
        )}
      </div>
      {map && !page && (
        <div className="rounded-b-xl border-b border-gray-200 px-4 py-3 dark:border-slate-800">
          <Legend map={map} tierId={category.id} unit={unit} />
        </div>
      )}
    </div>
  );

  // Stacked (page), the legend sits under the pinned map and scrolls away with the page.
  const stackedLegend = map && page && (
    <div className={`border-b border-gray-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:hidden ${step === 'review' ? 'hidden' : ''}`}>
      <Legend map={map} tierId={category.id} unit={unit} />
    </div>
  );

  const stepHeader = (
    <header className="scroll-mt-4 space-y-1.5">
      {review && (
        <div className="flex items-center gap-3" aria-hidden>
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">Step {step === 'spot' ? 1 : 2} of 2</span>
          <span className="flex flex-1 gap-1">
            <span className="h-1 flex-1 rounded-full bg-brand" />
            <span className={`h-1 flex-1 rounded-full ${step === 'review' ? 'bg-brand' : 'bg-gray-200 dark:bg-slate-700'}`} />
          </span>
        </div>
      )}
      <h2 ref={headingRef} tabIndex={-1} id={`${baseId}-title`} className="scroll-mt-4 text-xl font-bold tracking-tight text-gray-900 focus:outline-none dark:text-slate-50">
        {review ? <span className="sr-only">Step {step === 'spot' ? 1 : 2} of 2: </span> : null}
        {step === 'spot' ? 'Choose your spot' : review?.extras ? 'Extras and payment' : 'How you pay'}
      </h2>
      {step === 'spot' && <div className="text-sm leading-relaxed text-gray-600 dark:text-slate-400" data-testid="space-intro">{intro}</div>}
    </header>
  );

  const spotList = (
    <section aria-labelledby={`${listId}-title`} className="space-y-3" data-testid="space-spots">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id={`${listId}-title`} className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Open {category.name} spots
          </h3>
          {map && (
            <p className="text-xs text-gray-600 dark:text-slate-400" data-testid="space-price-range" aria-live="polite">
              {spots.length} open{priceRange ? ` · ${priceRange}` : ''}
            </p>
          )}
        </div>
        {spots.length > 1 && (
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-300">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SpotSort)}
              data-testid="spot-sort"
              className="rounded-lg border border-gray-300 bg-white py-1.5 pl-2.5 pr-8 text-sm text-gray-900 focus:border-brand-link focus:outline-none focus:ring-2 focus:ring-brand-link dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="label">By spot</option>
              <option value="price">Lowest price</option>
            </select>
          </label>
        )}
      </div>

      {!map ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">{mapError ?? 'Loading spots…'}</p>
      ) : spots.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300" data-testid="spot-list-empty">
          No {category.name} spots are open right now. The organizer can still place you — reply to your approval email.
        </p>
      ) : (
        <fieldset disabled={busy}>
          <legend className="sr-only">Choose a spot</legend>
          <ul ref={listRef} id={listId} className="space-y-2" data-testid="spot-list">
            {spots.map((spot) => {
              const id = `${baseId}-${spot.id}`;
              const isChosen = spot.id === selectedId;
              return (
                <li key={spot.id} data-spot-id={spot.id} className="scroll-my-3">
                  <label
                    htmlFor={id}
                    data-testid="spot-option"
                    data-selected={isChosen || undefined}
                    className="group relative flex min-h-[3.5rem] cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-3.5 transition-colors hover:border-gray-300 has-[:checked]:border-brand-link has-[:checked]:bg-gray-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-link has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-link motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:has-[:checked]:bg-slate-900"
                  >
                    <input id={id} type="radio" name={`${baseId}-spot`} value={spot.id} checked={isChosen} onChange={() => chooseFromList(spot)} className="peer sr-only" />
                    <span aria-hidden className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: mySwatch }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-900 dark:text-slate-100">Spot {spot.label}</span>
                      <span className="block text-xs text-gray-600 dark:text-slate-400">{size(spot)}</span>
                    </span>
                    <span className="text-right font-bold tabular-nums text-gray-900 dark:text-slate-50">{formatPrice(spotPrice(spot))}</span>
                    <span
                      aria-hidden
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-gray-300 text-transparent peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-fg dark:border-slate-500"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {otherGroups.length > 0 && (
        <div className="space-y-3 pt-2" data-testid="spot-other-categories">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Other categories</h3>
            <p className="text-xs text-gray-600 dark:text-slate-400">For reference only — you are approved as {category.name}, so these spots cannot be chosen.</p>
          </div>
          {otherGroups.map(({ tier, spots: group }) => {
            const pair = TIER_SWATCHES[tier.swatch % TIER_SWATCHES.length];
            return (
              <section key={tier.tierId} aria-label={`${tier.name} spots, not available to you`}>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] opacity-50" style={{ backgroundColor: dark ? pair.dark : pair.light }} />
                  {tier.name}
                </h4>
                <ul className="space-y-1.5">
                  {group.map((spot) => (
                    <li
                      key={spot.id}
                      data-testid="spot-other"
                      aria-disabled="true"
                      className="flex min-h-[3rem] items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 py-2 pl-3 pr-3.5 text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                    >
                      <span aria-hidden className="h-7 w-1.5 shrink-0 rounded-full opacity-40" style={{ backgroundColor: dark ? pair.dark : pair.light }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-600 dark:text-slate-400">Spot {spot.label}</span>
                        <span className="block text-xs">
                          {size(spot)}
                          {spot.status !== 'AVAILABLE' ? ` · ${spot.status === 'SOLD' ? 'Taken' : STATUS_LABELS[spot.status] ?? spot.status}` : ''}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">{formatPrice(typeof spot.price === 'number' ? spot.price : tier.price)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );

  const reviewStep = selected && review && (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800" data-testid="space-review-spot">
        <span aria-hidden className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: mySwatch }} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-gray-900 dark:text-slate-100">Spot {selected.label}</span>
          <span className="block text-xs text-gray-600 dark:text-slate-400">
            {category.name} · <span className="whitespace-nowrap">{size(selected)}</span>
          </span>
        </span>
        <span className="font-bold tabular-nums text-gray-900 dark:text-slate-50">{formatPrice(spotPrice(selected))}</span>
        <button
          type="button"
          onClick={() => setStep('spot')}
          disabled={busy}
          data-testid="space-change-spot"
          className="rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link disabled:opacity-60"
        >
          Change<span className="sr-only"> spot</span>
        </button>
      </div>
      {review.extras}
      {review.payWith}
      <dl className="space-y-1.5 border-t border-gray-200 pt-4 text-sm tabular-nums text-gray-700 dark:border-slate-700 dark:text-slate-300" data-testid="space-review-lines">
        <div className="flex justify-between gap-3">
          <dt>Spot {selected.label}</dt>
          <dd>{formatPrice(spotPrice(selected))}</dd>
        </div>
        {extraLines.map((l) => (
          <div key={l.id} className="flex justify-between gap-3">
            <dt>{l.label}</dt>
            <dd>{formatPrice(l.amount)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const actionBar = (
    <div
      className={
        page
          ? `${selected || step === 'review' ? '' : 'hidden lg:block'} fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 lg:sticky lg:px-6`
          : 'sticky bottom-0 z-10 -mx-1 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95'
      }
      data-testid="space-action-bar"
    >
      <div className="mx-auto max-w-xl space-y-2.5 lg:max-w-none">
        <div className="flex items-baseline justify-between gap-3" aria-live="polite" data-testid="space-selection-summary">
          {selected ? (
            <>
              <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                Spot {selected.label} <span className="font-normal text-gray-600 dark:text-slate-400">· {size(selected)}</span>
              </p>
              <p className="shrink-0 text-xs text-gray-600 dark:text-slate-400" data-testid="space-total">
                {step === 'review' && extraLines.length > 0 ? 'Total with extras ' : step === 'review' || !review ? 'Total ' : ''}
                <strong className="text-base font-extrabold tabular-nums text-gray-900 dark:text-slate-50">{formatPrice(total ?? 0)}</strong>
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600 dark:text-slate-400">No spot chosen yet — pick one on the map or in the list.</p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {step === 'review' && (
            <button
              type="button"
              onClick={() => setStep('spot')}
              disabled={busy}
              aria-label="Back to choosing a spot"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={primary}
            disabled={!selected || busy}
            data-testid={step === 'review' || !review ? 'space-hold' : 'space-continue'}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
          >
            {busyLabel && <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />}
            {primaryLabel}
          </button>
        </div>
      </div>
      {(step === 'review' || !review) && selected && (
        <p className="mx-auto mt-1.5 max-w-xl text-[11px] text-gray-500 dark:text-slate-400 lg:max-w-none">Your spot is held for 15 minutes while you pay.</p>
      )}
    </div>
  );

  const spotsColumn = (
    <div className={page ? `lg:col-start-2 lg:row-start-2 lg:flex lg:flex-col ${selected ? 'pb-40 lg:pb-0' : ''}` : 'space-y-5'}>
      <div className={page ? 'space-y-6 px-4 py-6 sm:px-6 lg:flex-1' : 'space-y-6'}>
        {step === 'spot' ? spotList : reviewStep}
        {page && footer}
      </div>
      {actionBar}
    </div>
  );

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      data-testid="choose-space"
      data-state="CHOOSE"
      data-mode="MAP"
      data-step={step}
      className={page ? 'relative grid bg-white dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28%)] lg:grid-rows-[auto_1fr]' : 'space-y-5'}
    >
      {page && step === 'spot' && (
        <a
          href={`#${listId}`}
          className="sr-only z-40 m-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-fg focus:not-sr-only focus:absolute focus:outline-none focus:ring-2 focus:ring-brand-link focus:ring-offset-2"
        >
          Skip the map and choose from the list
        </a>
      )}
      {mapPane}
      {stackedLegend}
      <div className={page ? 'space-y-5 border-b border-gray-200 px-4 py-5 dark:border-slate-800 sm:px-6 lg:col-start-2 lg:row-start-1 lg:border-b-0 lg:pb-0 lg:pt-6' : 'space-y-4'}>
        {summary}
        {stepHeader}
        {notice}
      </div>
      {spotsColumn}
    </section>
  );
}
