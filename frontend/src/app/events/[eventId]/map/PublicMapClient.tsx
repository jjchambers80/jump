'use client';

// Public floor map (spec 014): the event header, the map, then the vendor
// directory — one column at every width, like the event page. The map uses
// the same viewport as the vendor spot chooser (SpotWorkspace): full width and
// square on phones, 4:3 from `sm`, fitted to the floor on load and on width
// change, with zoom buttons and the legend under the map.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ArrowLeft, Maximize2, Minus, Plus, X } from 'lucide-react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { api, mapsApi, type PublicMap, type PublicMapBooth, type PublicMapVendor, type MapBooth, type MapElement } from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import StorefrontFooter from '@/components/storefront/StorefrontFooter';
import MapCanvas from '@/components/maps/MapCanvas';
import { LEGEND_STATE_DARK, LEGEND_STATE_LIGHT, LEGEND_STATE_STROKE_DARK, LEGEND_STATE_STROKE_LIGHT, TIER_SWATCHES } from '@/components/maps/mapTheme';
import { formatPrice } from '@/lib/fees';
import { formatEventDate } from '@/lib/eventTime';
import { eventPath } from '@/lib/publicPaths';
import VendorDirectory from './VendorDirectory';

interface PublicMapClientProps {
  params: { eventId: string };
}

interface EventSummary {
  name?: string | null;
  date?: string | null;
  venue?: { name?: string | null; timezone?: string | null } | null;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: string | null;
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

export function toMapBooth(pb: PublicMapBooth): MapBooth {
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

export function priceRange(l: PublicMap['legend'][number]) {
  return l.priceFrom !== undefined && l.priceTo !== undefined && l.priceFrom !== l.priceTo
    ? `${formatPrice(l.priceFrom)}–${formatPrice(l.priceTo)}`
    : formatPrice(l.priceFrom ?? l.price);
}

const LEGEND_STATES = [
  ['AVAILABLE', 'Available'],
  ['SOLD', 'Sold'],
  ['RESERVED', 'Reserved'],
  ['BLOCKED', 'Blocked'],
] as const;

export function Legend({ map }: { map: PublicMap }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return (
    <div data-testid="map-legend" className="text-xs text-gray-700 dark:text-slate-300">
      <h2 className="sr-only">Map legend</h2>
      {map.legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Booth categories">
          {map.legend.map((l) => {
            const swatch = TIER_SWATCHES[l.swatch % TIER_SWATCHES.length];
            return (
              <li key={l.tierId} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: dark ? swatch.dark : swatch.light }} />
                <span className="truncate font-semibold text-gray-900 dark:text-slate-100" title={l.name}>{l.name}</span>
                <span className="tabular-nums text-gray-600 dark:text-slate-400" data-testid={`legend-price-${l.tierId}`}>{priceRange(l)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-gray-600 dark:text-slate-400" aria-label="Booth states">
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
      </ul>
    </div>
  );
}

export interface BoothDetailProps {
  booth: PublicMapBooth;
  legend: PublicMap['legend'];
  unit: string;
  vendor?: PublicMapVendor;
  boothHref: string;
  onClose: () => void;
}

// One dialog for every width: a bottom sheet on phones, centred from `sm`.
// Focus moves to the close button on open, stays inside while open and goes
// back to whatever opened it on close.
export function BoothDetail({ booth, legend, unit, vendor, boothHref, onClose }: BoothDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tier = legend.find((t) => t.tierId === booth.tier?.id);
  const tierName = booth.tier?.name || 'No category';
  // Spec 039: a spot's own all-in price wins over its tier's.
  const allInPrice = typeof booth.price === 'number' ? formatPrice(booth.price) : tier ? formatPrice(tier.price) : '—';
  const vendorLabel = booth.status === 'SOLD' || booth.status === 'RESERVED' ? vendor?.name || booth.vendorName || '' : '';

  let statusLabel: string;
  if (booth.status === 'SOLD') statusLabel = vendorLabel ? `Sold to ${vendorLabel}` : 'Sold';
  else if (booth.status === 'RESERVED') statusLabel = vendorLabel ? `Reserved for ${vendorLabel}` : 'Reserved';
  else if (booth.status === 'BLOCKED') statusLabel = 'Not for sale';
  else if (booth.status === 'AVAILABLE') statusLabel = 'Available';
  else statusLabel = 'Being purchased';

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // Mount/unmount only: the handlers must not re-run (and refocus) on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusTone =
    booth.status === 'AVAILABLE'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : booth.status === 'BLOCKED'
      ? 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booth-detail-title"
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl motion-safe:animate-slide-up dark:bg-slate-800 sm:max-w-md sm:rounded-2xl sm:pb-6 sm:motion-safe:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 sm:hidden" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-gray-300 dark:bg-slate-600" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <div>
            <h2 id="booth-detail-title" className="text-xl font-bold text-gray-900 dark:text-slate-50">
              Booth {booth.label}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-400">
              {booth.w}×{booth.h} {unit}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <dl className="mx-5 divide-y divide-gray-200 border-y border-gray-200 text-sm dark:divide-slate-700 dark:border-slate-700">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-gray-600 dark:text-slate-400">Status</dt>
            <dd className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone}`}>{statusLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-gray-600 dark:text-slate-400">Category</dt>
            <dd className="text-right font-medium text-gray-900 dark:text-slate-100">{tierName}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-gray-600 dark:text-slate-400">All-in price</dt>
            <dd className="font-bold tabular-nums text-gray-900 dark:text-slate-50">{allInPrice}</dd>
          </div>
          {vendorLabel && (
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-gray-600 dark:text-slate-400">Vendor</dt>
              <dd className="text-right font-semibold text-gray-900 dark:text-slate-100">{vendorLabel}</dd>
            </div>
          )}
        </dl>
        {vendorLabel && (
          <div className="px-5 pt-4">
            <a
              href={boothHref}
              className="inline-flex min-h-[2.75rem] items-center text-sm font-semibold text-brand-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link"
            >
              Permanent link to {vendorLabel} at booth {booth.label}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export const iconButton =
  'grid h-11 w-11 place-items-center text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-link motion-reduce:transition-none dark:text-slate-200 dark:hover:bg-slate-700';

export default function PublicMapClient({ params }: PublicMapClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const [mapData, setMapData] = useState<PublicMap | null>(null);
  const [eventData, setEventData] = useState<EventSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBooth, setSelectedBooth] = useState<PublicMapBooth | null>(null);
  const [highlightBooth, setHighlightBooth] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapSectionRef = useRef<HTMLElement>(null);
  const etagRef = useRef<string | null>(null);

  const fetchMap = useCallback(async () => {
    try {
      const data = await mapsApi.getPublicEventMap(params.eventId, etagRef.current ?? undefined);
      // null: 304 Not Modified, keep what we have.
      if (data) {
        setMapData(data);
        etagRef.current = data.etag;
        setError(null);
      }
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 304) return;
      if (e.status === 404) setError('Map not published for this event');
      else if (e.status === 403) setError('This event is in a private store');
      else setError(e.message || 'Failed to load map');
    } finally {
      setLoading(false);
    }
  }, [params.eventId]);

  const fetchEvent = useCallback(async () => {
    try {
      const data = await api.get<EventSummary>(`/events/${encodeURIComponent(params.eventId)}`);
      setEventData({
        name: data.name,
        date: data.date,
        venue: data.venue ? { name: data.venue.name, timezone: data.venue.timezone } : null,
        organizationId: data.organizationId,
        organizationName: data.organizationName,
        organizationLogoUrl: data.organizationLogoUrl,
        organizationBrandColor: data.organizationBrandColor,
        organizationThemeMode: data.organizationThemeMode,
      });
    } catch {
      // Event fetch failed; the map fetch reports the error.
    }
  }, [params.eventId]);

  useEffect(() => {
    fetchMap();
    fetchEvent();
  }, [fetchMap, fetchEvent]);

  // Poll every 30 s with If-None-Match while the tab is visible.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const sync = () => {
      if (document.visibilityState === 'visible') {
        if (!timer) timer = setInterval(fetchMap, 30000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      if (timer) clearInterval(timer);
    };
  }, [fetchMap]);

  const boothHref = useCallback((boothId: string) => `${pathname}?${new URLSearchParams({ booth: boothId }).toString()}`, [pathname]);

  // ─── Map viewport: fit on load and on width change, as in the spot chooser ──
  const fit = useCallback(
    (animate: boolean) => {
      const ref = transformRef.current;
      const el = canvasRef.current;
      if (!ref || !el || !mapData) return;
      const sw = mapData.width * mapData.gridSize;
      const sh = mapData.height * mapData.gridSize;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch || !sw || !sh) return;
      const scale = Math.min(cw / sw, ch / sh) * 0.94;
      ref.setTransform((cw - sw * scale) / 2, (ch - sh * scale) / 2, scale, animate && !reducedMotion ? 200 : 0);
    },
    [mapData, reducedMotion]
  );

  const centreOn = useCallback(
    (booth: PublicMapBooth, animate = true) => {
      const ref = transformRef.current;
      const el = canvasRef.current;
      if (!ref || !el || !mapData) return;
      const sw = mapData.width * mapData.gridSize;
      const sh = mapData.height * mapData.gridSize;
      const fitScale = Math.min(el.clientWidth / sw, el.clientHeight / sh) * 0.94;
      // Close enough to read the booth, never further out than the vendor already is.
      const scale = Math.min(5, Math.max(ref.state.scale, fitScale * 2));
      const cx = (booth.x + (booth.rotation === 90 ? booth.h : booth.w) / 2) * mapData.gridSize;
      const cy = (booth.y + (booth.rotation === 90 ? booth.w : booth.h) / 2) * mapData.gridSize;
      ref.setTransform(el.clientWidth / 2 - cx * scale, el.clientHeight / 2 - cy * scale, scale, animate && !reducedMotion ? 250 : 0);
    },
    [mapData, reducedMotion]
  );

  const mapLoaded = Boolean(mapData);
  useEffect(() => {
    if (!mapLoaded) return;
    const el = canvasRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => fit(false));
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // Width only: a mobile address bar changing the height must not undo the visitor's zoom.
      if (Math.abs(el.clientWidth - lastWidth) < 24) return;
      lastWidth = el.clientWidth;
      fit(false);
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Refit when the map first loads, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  // Canonical links use immutable booth ids. Keep accepting labels so links
  // sent before phase 3 continue to work. Declared after the fit effect so the
  // deep-link zoom runs after the first fit.
  const boothParam = searchParams.get('booth');
  useEffect(() => {
    if (!boothParam || !mapData) {
      setDeepLinkError(null);
      return;
    }
    const booth = mapData.booths.find((candidate) => candidate.id === boothParam || candidate.label === boothParam);
    if (!booth) {
      setSelectedBooth(null);
      setHighlightBooth(null);
      setDeepLinkError(`Booth “${boothParam}” was not found on this event map.`);
      return;
    }
    setDeepLinkError(null);
    setSelectedBooth(booth);
    setHighlightBooth(booth.id);
    const frame = requestAnimationFrame(() => centreOn(booth, false));
    // The highlight pulses three times, then settles; reduced motion keeps it steady until closed.
    const timer = reducedMotion ? null : setTimeout(() => setHighlightBooth(null), 4500);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
    // A poll refreshing mapData must not reopen a dialog the visitor closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boothParam, mapLoaded]);

  const focusBooth = (boothId: string, fromDirectory = false) => {
    const booth = mapData?.booths.find((candidate) => candidate.id === boothId);
    if (!booth) return;
    setDeepLinkError(null);
    setHighlightBooth(booth.id);
    setSelectedBooth(booth);
    router.push(boothHref(booth.id), { scroll: false });
    centreOn(booth);
    if (fromDirectory) mapSectionRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const closeBooth = () => {
    setSelectedBooth(null);
    setHighlightBooth(null);
    router.replace(pathname, { scroll: false });
  };

  const elements: MapElement[] = useMemo(
    () => (mapData?.layout?.elements ?? []).map((el) => ({ ...el, kind: el.kind as MapElement['kind'] })),
    [mapData]
  );
  const boothsForCanvas = useMemo(() => (mapData?.booths ?? []).map(toMapBooth), [mapData]);
  const swatchFor = useMemo(() => Object.fromEntries((mapData?.legend ?? []).map((l) => [l.tierId, l.swatch])), [mapData]);

  const brandColor = eventData?.organizationBrandColor || null;
  const themeMode = (eventData?.organizationThemeMode as 'LIGHT' | 'DARK' | 'SYSTEM' | undefined) || 'SYSTEM';

  if (loading) {
    return (
      <BrandScope color={null} themeMode={null} className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-900">
        <p role="status" className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
          <span aria-hidden className="inline-block h-5 w-5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
          Loading floor map…
        </p>
      </BrandScope>
    );
  }

  if (error || !mapData) {
    return (
      <BrandScope color={brandColor} themeMode={themeMode} className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Floor Map Not Available</h1>
          <p className="mt-2 text-gray-700 dark:text-slate-300">{error || 'This floor map could not be loaded.'}</p>
          <Link
            href={eventPath(params.eventId)}
            className="mt-6 inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl px-3 font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the event
          </Link>
        </div>
      </BrandScope>
    );
  }

  const zone = eventData?.venue?.timezone;
  const dateLabel = eventData?.date ? formatEventDate(eventData.date, zone, { weekday: 'short', month: 'short' }) : null;
  const meta = [mapData.name, dateLabel, eventData?.venue?.name].filter(Boolean) as string[];
  const boothTotal = mapData.booths.filter((b) => b.tier).length;
  const openTotal = mapData.booths.filter((b) => b.tier && b.status === 'AVAILABLE').length;

  return (
    <BrandScope color={brandColor} themeMode={themeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {eventData?.organizationName && (
        <OrganizationHeader
          organization={{ id: eventData.organizationId, name: eventData.organizationName, logoUrl: eventData.organizationLogoUrl }}
          nav
        />
      )}
      <main id="main-content" className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
        {/* 1. Header */}
        <header className="max-w-3xl">
          <Link
            href={eventPath(params.eventId)}
            className="-ml-1 inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {eventData?.name ? <span>Back to {eventData.name}</span> : <span>Back to the event</span>}
          </Link>
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-gray-600 dark:text-slate-400">Floor map</p>
          <h1 className="mt-1 text-balance text-3xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-slate-50 sm:text-4xl">
            {eventData?.name || mapData.name}
          </h1>
          {meta.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-gray-700 dark:text-slate-300">
              {meta.map((part, i) => (
                <span key={part} className="whitespace-nowrap">
                  {i > 0 && <span aria-hidden className="mr-2 text-gray-400 dark:text-slate-500">·</span>}
                  {part}
                </span>
              ))}
            </p>
          )}
        </header>

        {deepLinkError && (
          <div role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {deepLinkError}
          </div>
        )}

        {/* 2. Map: edge to edge on phones, inside the content column from `sm`. */}
        <section ref={mapSectionRef} aria-labelledby="floor-map-title" className="relative -mx-4 mt-6 scroll-mt-4 sm:mx-0" data-testid="public-map">
          <div className="flex items-end justify-between gap-3 px-4 pb-3 sm:px-0">
            <h2 id="floor-map-title" className="text-lg font-bold text-gray-900 dark:text-slate-100">
              {mapData.name}
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="map-booth-count">
              {openTotal} of {boothTotal} {boothTotal === 1 ? 'booth' : 'booths'} open
            </p>
          </div>
          <a
            href="#vendor-directory-heading"
            className="sr-only z-20 m-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-fg focus:not-sr-only focus:absolute focus:outline-none focus:ring-2 focus:ring-brand-link focus:ring-offset-2"
          >
            Skip the map and go to the vendor directory
          </a>
          <div className="overflow-hidden border-y border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl sm:border">
            <div className="relative aspect-square w-full overflow-hidden bg-gray-100 dark:bg-slate-950 sm:aspect-[4/3] lg:aspect-[16/9]">
              {/* Faint grid so the floor reads as a floor, not an empty box. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-40"
                style={{ backgroundImage: 'radial-gradient(circle, rgb(148 163 184 / 0.35) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
              />
              <div ref={canvasRef} className="absolute inset-0">
                <MapCanvas
                  width={mapData.width}
                  height={mapData.height}
                  gridSize={mapData.gridSize}
                  unit={mapData.unit}
                  underlayUrl={mapData.underlayUrl}
                  underlayOpacity={mapData.underlayOpacity}
                  elements={elements}
                  booths={boothsForCanvas}
                  interactive
                  selectionHandles={false}
                  selectedIds={selectedBooth ? new Set([selectedBooth.id]) : undefined}
                  onBoothClick={(booth) => focusBooth(booth.id)}
                  highlightBooth={highlightBooth ?? undefined}
                  transformRef={transformRef}
                  fitOnInit={false}
                  reducedMotion={reducedMotion}
                  tierSwatches={swatchFor}
                  ariaLabel={`Floor map of ${mapData.name}. Choose a booth for its details; the vendor directory below lists the same vendors.`}
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
            <div className="border-t border-gray-200 px-4 py-3 dark:border-slate-700 sm:px-5">
              <Legend map={mapData} />
            </div>
          </div>
          <p className="mt-2 px-4 text-xs text-gray-600 dark:text-slate-400 sm:px-0">
            Pinch or scroll to zoom, drag to move. Sizes are in {mapData.unit === 'm' ? 'metres' : 'feet'}.
          </p>
        </section>

        {/* 3. Vendor directory */}
        <VendorDirectory vendors={mapData.vendors ?? []} onSelectBooth={(id) => focusBooth(id, true)} boothHref={boothHref} />
      </main>

      {selectedBooth && (
        <BoothDetail
          booth={selectedBooth}
          legend={mapData.legend}
          unit={mapData.unit}
          vendor={mapData.vendors?.find((candidate) => candidate.booth?.id === selectedBooth.id)}
          boothHref={boothHref(selectedBooth.id)}
          onClose={closeBooth}
        />
      )}

      {eventData?.organizationId && eventData?.organizationName && (
        <StorefrontFooter organization={{ id: eventData.organizationId, name: eventData.organizationName }} />
      )}
    </BrandScope>
  );
}
