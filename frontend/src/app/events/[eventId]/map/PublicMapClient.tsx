'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { api, mapsApi, type PublicMap, type PublicMapBooth, type PublicMapLegendTier, type MapBooth, type MapElement } from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import StorefrontFooter from '@/components/storefront/StorefrontFooter';
import MapCanvas from '@/components/maps/MapCanvas';
import MapLegend, { type LegendTier } from '@/components/maps/MapLegend';
import { resolveAssetUrl } from '@/lib/assets';
import { formatPrice } from '@/lib/fees';

interface PublicMapClientProps {
  params: { eventId: string };
}

interface BoothDetailProps {
  booth: PublicMapBooth;
  legend: LegendTier[];
  event: {
    organizationId?: string | null;
    organizationName?: string | null;
    organizationLogoUrl?: string | null;
    organizationBrandColor?: string | null;
    organizationThemeMode?: string | null;
    taxRate?: number;
    taxInclusivePricing?: boolean;
  };
  onClose: () => void;
}

function BoothDetail({ booth, legend, event, onClose }: BoothDetailProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const tier = legend.find((t) => t.id === booth.tier?.id);
  const tierName = booth.tier?.name || 'No tier';
  const allInPrice = tier ? formatPrice(tier.price) : '—';
  const dimensions = `${booth.w}×${booth.h}`;

  let statusLabel = '';
  let vendorLabel = '';
  if (booth.status === 'SOLD') {
    statusLabel = booth.vendorName ? `Sold to ${booth.vendorName}` : 'Sold';
    vendorLabel = booth.vendorName || '';
  } else if (booth.status === 'RESERVED') {
    statusLabel = booth.vendorName ? `Reserved for ${booth.vendorName}` : 'Reserved';
    vendorLabel = booth.vendorName || '';
  } else if (booth.status === 'BLOCKED') {
    statusLabel = 'Not for sale';
  } else if (booth.status === 'AVAILABLE') {
    statusLabel = 'Available';
  } else {
    statusLabel = 'Being purchased';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="booth-detail-title"
    >
      {/* Mobile: bottom sheet */}
      <div
        className="sm:hidden w-full bg-white dark:bg-slate-800 rounded-t-2xl max-h-[70vh] overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h2 id="booth-detail-title" className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Booth {booth.label}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 pb-6 overflow-y-auto space-y-4">
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span className="font-mono text-lg">{booth.label}</span>
            <span className="text-sm text-gray-500 dark:text-slate-400">{dimensions}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>Tier:</span>
            <span className="font-medium">{tierName}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>All-in price:</span>
            <span className="font-bold text-brand-link">{allInPrice}</span>
          </div>
          {vendorLabel && (
            <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
              <span>Vendor:</span>
              <span className="font-medium italic text-brand-link">{vendorLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>Status:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              booth.status === 'BLOCKED'
                ? 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'
                : booth.status === 'AVAILABLE'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
            }`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Desktop: centered dialog */}
      <div
        className="hidden sm:block bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full max-h-[70vh] overflow-hidden m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h2 id="booth-detail-title" className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Booth {booth.label}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span className="font-mono text-lg">{booth.label}</span>
            <span className="text-sm text-gray-500 dark:text-slate-400">{dimensions}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>Tier:</span>
            <span className="font-medium">{tierName}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>All-in price:</span>
            <span className="font-bold text-brand-link">{allInPrice}</span>
          </div>
          {vendorLabel && (
            <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
              <span>Vendor:</span>
              <span className="font-medium italic text-brand-link">{vendorLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-gray-700 dark:text-slate-300">
            <span>Status:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              booth.status === 'BLOCKED'
                ? 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'
                : booth.status === 'AVAILABLE'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
            }`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Convert PublicMapBooth to MapBooth for MapCanvas
function toMapBooth(pb: PublicMapBooth): MapBooth {
  return {
    id: pb.id,
    mapId: '', // not needed for public map
    label: pb.label,
    kind: pb.kind,
    x: pb.x,
    y: pb.y,
    w: pb.w,
    h: pb.h,
    rotation: pb.rotation,
    tierId: pb.tier?.id || null,
    status: pb.status,
    applicationId: null, // not exposed publicly
    assignedById: null,
    createdAt: '',
    updatedAt: '',
    holder: pb.vendorName
      ? {
          id: '',
          status: '',
          paymentStatus: '',
          businessName: pb.vendorName,
        }
      : null,
  };
}

export default function PublicMapClient({ params }: PublicMapClientProps) {
  const { resolvedTheme } = useTheme();
  const searchParams = useSearchParams();
  const [mapData, setMapData] = useState<PublicMap | null>(null);
  const [eventData, setEventData] = useState<{
    organizationId?: string | null;
    organizationName?: string | null;
    organizationLogoUrl?: string | null;
    organizationBrandColor?: string | null;
    organizationThemeMode?: string | null;
    taxRate?: number;
    taxInclusivePricing?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [selectedBooth, setSelectedBooth] = useState<PublicMapBooth | null>(null);
  const [highlightBooth, setHighlightBooth] = useState<string | null>(null);
  const transformRef = useRef<any>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pulseCountRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mediaQuery.matches;
    const handler = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const fetchMap = useCallback(async (matchEtag?: string) => {
    try {
      const data = await mapsApi.getPublicEventMap(params.eventId, matchEtag);
      if (data) {
        setMapData(data);
        setEtag(data.etag);
        setError(null);
      } else {
        // 304 Not Modified
        return;
      }
    } catch (err: any) {
      if (err.status === 304) {
        // Not modified since our ETag: keep what we have.
        return;
      }
      if (err.status === 404) {
        setError('Map not published for this event');
      } else if (err.status === 403) {
        setError('This event is in a private store');
      } else {
        setError(err.message || 'Failed to load map');
      }
    } finally {
      setLoading(false);
    }
  }, [params.eventId]);

  const fetchEvent = useCallback(async () => {
    try {
      const data = await api.get<any>(`/events/${encodeURIComponent(params.eventId)}`);
      setEventData({
        organizationId: data.organizationId,
        organizationName: data.organizationName,
        organizationLogoUrl: data.organizationLogoUrl,
        organizationBrandColor: data.organizationBrandColor,
        organizationThemeMode: data.organizationThemeMode,
        taxRate: data.taxRate,
        taxInclusivePricing: data.taxInclusivePricing,
      });
    } catch {
      // Event fetch failed; map fetch will also fail
    }
  }, [params.eventId]);

  useEffect(() => {
    fetchMap();
    fetchEvent();
  }, [fetchMap, fetchEvent]);

  // Handle ?booth= param for focus
  useEffect(() => {
    const boothParam = searchParams.get('booth');
    if (boothParam && mapData) {
      const booth = mapData.booths.find((b) => b.label === boothParam);
      if (booth) {
        setHighlightBooth(booth.id);
        // Fit to the booth: react-zoom-pan-pinch centres on a DOM node, and the
        // booth <g> carries data-testid="booth-<label>".
        const node = document.querySelector<HTMLElement>(`[data-testid="booth-${CSS.escape(booth.label)}"]`);
        if (transformRef.current && node) {
          transformRef.current.zoomToElement(node, 2, reducedMotionRef.current ? 0 : 300);
        }
        // Pulse 3x
        if (!reducedMotionRef.current) {
          pulseCountRef.current = 0;
          const pulseInterval = setInterval(() => {
            pulseCountRef.current++;
            if (pulseCountRef.current >= 3) {
              clearInterval(pulseInterval);
              setHighlightBooth(null);
            }
          }, 1500);
          return () => clearInterval(pulseInterval);
        }
      }
    }
  }, [searchParams, mapData]);

  // Polling every 30s with If-None-Match while visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(() => {
            fetchMap(etag || undefined);
          }, 30000);
        }
      } else {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibilityChange();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchMap, etag]);

  const handleBoothClick = (booth: MapBooth) => {
    // Find the corresponding PublicMapBooth
    if (mapData) {
      const publicBooth = mapData.booths.find((b) => b.id === booth.id);
      if (publicBooth) {
        setSelectedBooth(publicBooth);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selectedBooth) {
      setSelectedBooth(null);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBooth]);

  if (loading) {
    return (
      <BrandScope color={null} themeMode={null} className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 text-brand-link mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-gray-600 dark:text-slate-400">Loading floor map...</p>
        </div>
      </BrandScope>
    );
  }

  if (error) {
    return (
      <BrandScope color={eventData?.organizationBrandColor || null} themeMode={eventData?.organizationThemeMode as any || 'SYSTEM'} className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Floor Map Not Available</h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">{error}</p>
        </div>
      </BrandScope>
    );
  }

  if (!mapData) {
    return null;
  }

  const underlayUrl = mapData.underlayUrl;

  // Convert MapElement to the expected type
  const elements: MapElement[] = mapData.layout?.elements?.map((el) => ({
    ...el,
    kind: el.kind as MapElement['kind'],
  })) || [];

  const legendTiers: LegendTier[] = mapData.legend.map((l) => ({
    id: l.tierId,
    name: l.name,
    price: l.price,
    swatch: l.swatch,
  }));

  // Convert booths for MapCanvas
  const boothsForCanvas: MapBooth[] = mapData.booths.map(toMapBooth);

  return (
    <BrandScope color={eventData?.organizationBrandColor || null} themeMode={eventData?.organizationThemeMode as any || 'SYSTEM'} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {eventData?.organizationName && (
        <OrganizationHeader
          organization={{ id: eventData.organizationId, name: eventData.organizationName, logoUrl: eventData.organizationLogoUrl }}
          nav
        />
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">{mapData.name}</h1>
          <p className="text-gray-600 dark:text-slate-400 mt-1">Floor Map</p>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* Map canvas */}
          <div className="lg:col-span-3">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 overflow-hidden">
              <MapCanvas
                width={mapData.width}
                height={mapData.height}
                gridSize={mapData.gridSize}
                unit={mapData.unit}
                underlayUrl={underlayUrl}
                underlayOpacity={mapData.underlayOpacity}
                elements={elements}
                booths={boothsForCanvas}
                tierSwatches={Object.fromEntries(legendTiers.map((t) => [t.id, t.swatch]))}
                interactive={true}
                onBoothClick={handleBoothClick}
                highlightBooth={highlightBooth ?? undefined}
                transformRef={transformRef}
                reducedMotion={reducedMotionRef.current}
              />
            </div>
          </div>

          {/* Legend sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 p-4 h-fit sticky top-24">
              <MapLegend tiers={legendTiers} showStates={true} />
            </div>
          </div>
        </div>
      </div>

      {selectedBooth && (
        <BoothDetail
          booth={selectedBooth}
          legend={legendTiers}
          event={eventData || {}}
          onClose={() => setSelectedBooth(null)}
        />
      )}

      {eventData?.organizationId && eventData?.organizationName && (
        <StorefrontFooter organization={{ id: eventData.organizationId, name: eventData.organizationName }} />
      )}
    </BrandScope>
  );
}