'use client';

// "Floor map" action in the event hero (spec 014). Renders nothing until the
// event has a PUBLISHED map; when it does, the pill opens the interactive map
// as a full-screen dialog on every width: a top bar (name, open booths, the
// vendor directory link, close), the map filling the rest with zoom controls,
// and the legend pinned to the bottom. Choosing a booth opens the same booth
// sheet as /events/:id/map, which stays the linkable page with the directory.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Map as MapIcon, Maximize2, Minus, Plus, X } from 'lucide-react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { mapsApi, type MapElement, type PublicMap, type PublicMapBooth } from '@/services/api';
import MapCanvas from '@/components/maps/MapCanvas';
import { eventPath } from '@/lib/publicPaths';
import { BoothDetail, Legend, iconButton, toMapBooth } from './map/PublicMapClient';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

export default function FloorMapButton({
  eventId,
  eventName,
  preview = false,
}: {
  eventId: string;
  eventName?: string;
  /** Preview mode (spec 050 §8.2): the pill shows, but opens no dialog. */
  preview?: boolean;
}) {
  const [mapData, setMapData] = useState<PublicMap | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    mapsApi
      .getPublicEventMap(eventId)
      .then((data) => {
        // null is a 304: keep what we have.
        if (!cancelled && data) setMapData(data);
      })
      .catch(() => {
        // 404 (not published) and transient errors alike: no button.
        if (!cancelled) setMapData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => load(), [load]);

  if (!mapData) return null;

  if (preview) {
    return (
      <span id="floor-map" data-testid="floor-map-button" className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/70 ring-1 ring-inset ring-white/15">
        <MapIcon className="h-4 w-4" aria-hidden />
        <span>Floor map</span>
        <span className="text-xs text-white/60">· Preview</span>
      </span>
    );
  }

  return (
    <>
      <button
        id="floor-map"
        type="button"
        onClick={() => {
          setOpen(true);
          // Refresh booth states behind the opening dialog.
          load();
        }}
        aria-haspopup="dialog"
        data-testid="floor-map-button"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
      >
        <MapIcon className="h-4 w-4" aria-hidden />
        <span>Floor map</span>
      </button>
      {open && <FloorMapDialog eventId={eventId} eventName={eventName} map={mapData} onClose={() => setOpen(false)} />}
    </>
  );
}

interface FloorMapDialogProps {
  eventId: string;
  eventName?: string;
  map: PublicMap;
  onClose: () => void;
}

function FloorMapDialog({ eventId, eventName, map, onClose }: FloorMapDialogProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [selected, setSelected] = useState<PublicMapBooth | null>(null);
  // The booth sheet runs its own Escape and focus trap while it is open.
  const boothOpenRef = useRef(false);
  boothOpenRef.current = selected !== null;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const mapPath = `${eventPath(eventId)}/map`;

  // Focus in, Escape closes, Tab stays inside, focus back to the pill; the page underneath does not scroll.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (boothOpenRef.current || !panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      root.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  const fit = useCallback(
    (animate: boolean) => {
      const ref = transformRef.current;
      const el = canvasRef.current;
      if (!ref || !el) return;
      const sw = map.width * map.gridSize;
      const sh = map.height * map.gridSize;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch || !sw || !sh) return;
      const scale = Math.min(cw / sw, ch / sh) * 0.94;
      ref.setTransform((cw - sw * scale) / 2, (ch - sh * scale) / 2, scale, animate && !reducedMotion ? 200 : 0);
    },
    [map.width, map.height, map.gridSize, reducedMotion]
  );

  // Fit on open and whenever the viewport really changes size (rotation, window resize).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => fit(false));
    let last = { w: el.clientWidth, h: el.clientHeight };
    const observer = new ResizeObserver(() => {
      // Ignore a mobile address bar sliding in and out: only real resizes refit.
      if (Math.abs(el.clientWidth - last.w) < 24 && Math.abs(el.clientHeight - last.h) < 120) return;
      last = { w: el.clientWidth, h: el.clientHeight };
      fit(false);
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Fit once per open, not on every map refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elements: MapElement[] = useMemo(
    () => (map.layout?.elements ?? []).map((el) => ({ ...el, kind: el.kind as MapElement['kind'] })),
    [map]
  );
  const booths = useMemo(() => map.booths.map(toMapBooth), [map]);
  const swatchFor = useMemo(() => Object.fromEntries(map.legend.map((l) => [l.tierId, l.swatch])), [map]);
  const boothTotal = map.booths.filter((b) => b.tier).length;
  const openTotal = map.booths.filter((b) => b.tier && b.status === 'AVAILABLE').length;
  const title = eventName || map.name;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="floor-map-dialog-title"
      data-testid="floor-map-dialog"
      className="fixed inset-0 z-50 flex h-dvh flex-col bg-gray-100 motion-safe:animate-fade-in dark:bg-slate-950"
    >
      <header className="relative z-10 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_8px_16px_-12px_rgb(0_0_0/0.35)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-5">
        <div className="min-w-0 flex-1 py-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-link">Floor map</p>
          <h2 id="floor-map-dialog-title" className="truncate text-base font-extrabold tracking-tight text-gray-900 dark:text-slate-50 sm:text-lg">
            {title}
          </h2>
          <p className="truncate text-xs text-gray-600 dark:text-slate-400" data-testid="floor-map-dialog-count">
            {map.name !== title && <span>{map.name} · </span>}
            {openTotal} of {boothTotal} {boothTotal === 1 ? 'booth' : 'booths'} open
          </p>
        </div>
        <Link
          href={mapPath}
          className="hidden min-h-[2.75rem] shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link sm:inline-flex"
        >
          Vendor directory
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onClose}
          data-autofocus
          aria-label="Close the floor map"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gray-100 text-gray-800 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link motion-reduce:transition-none dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Faint grid so the floor reads as a floor, not an empty box. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-40"
          style={{ backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / 0.35) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
        />
        <div ref={canvasRef} className="absolute inset-0">
          <MapCanvas
            width={map.width}
            height={map.height}
            gridSize={map.gridSize}
            unit={map.unit}
            underlayUrl={map.underlayUrl}
            underlayOpacity={map.underlayOpacity}
            elements={elements}
            booths={booths}
            interactive
            selectionHandles={false}
            selectedIds={selected ? new Set([selected.id]) : undefined}
            onBoothClick={(booth) => setSelected(map.booths.find((b) => b.id === booth.id) ?? null)}
            transformRef={transformRef}
            fitOnInit={false}
            reducedMotion={reducedMotion}
            tierSwatches={swatchFor}
            ariaLabel={`Floor map of ${map.name}. Choose a booth for its details.`}
          />
        </div>
        <div role="group" aria-label="Map zoom" className="absolute right-3 top-3 flex flex-col divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-sm backdrop-blur dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/95">
          <button type="button" className={iconButton} aria-label="Zoom in" onClick={() => transformRef.current?.zoomIn(0.4, reducedMotion ? 0 : 150)}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={iconButton} aria-label="Zoom out" onClick={() => transformRef.current?.zoomOut(0.4, reducedMotion ? 0 : 150)}>
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={iconButton} aria-label="Fit the whole map" onClick={() => fit(true)}>
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <footer className="relative z-10 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-5">
        <div className="max-h-[22svh] overflow-y-auto">
          <Legend map={map} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-slate-400">
          <p>Pinch or scroll to zoom, drag to move.</p>
          <Link href={mapPath} className="inline-flex min-h-[2.75rem] shrink-0 items-center gap-1 font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link sm:hidden">
            Vendor directory
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </footer>

      {selected && (
        <BoothDetail
          booth={selected}
          legend={map.legend}
          unit={map.unit}
          vendor={map.vendors?.find((candidate) => candidate.booth?.id === selected.id)}
          boothHref={`${mapPath}?${new URLSearchParams({ booth: selected.id }).toString()}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
