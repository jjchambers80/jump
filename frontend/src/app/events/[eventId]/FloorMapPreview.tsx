'use client';

// Compact, non-interactive floor-map preview on the public event page
// (spec 014 phase 1). Renders nothing until a PUBLISHED map exists; the full
// interactive map lives at /events/:id/map.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { mapsApi, type PublicMap } from '../../../services/api';
import MapCanvas from '../../../components/maps/MapCanvas';
import { eventPath } from '../../../lib/publicPaths';

export default function FloorMapPreview({ eventId }: { eventId: string }) {
  const [mapData, setMapData] = useState<PublicMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    mapsApi
      .getPublicEventMap(eventId)
      .then((data) => {
        if (!cancelled) setMapData(data);
      })
      .catch(() => {
        // 404 (not published) and transient errors alike: the section stays hidden.
        if (!cancelled) setMapData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!mapData) return null;

  const elements = mapData.layout?.elements ?? [];
  const booths = mapData.booths.map((b) => ({
    id: b.id,
    mapId: mapData.id,
    label: b.label,
    kind: b.kind,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    rotation: b.rotation,
    tierId: b.tier?.id ?? null,
    status: b.status,
    applicationId: null,
    assignedById: null,
    createdAt: '',
    updatedAt: '',
    holder: b.vendorName ? { id: '', status: '', paymentStatus: '', businessName: b.vendorName } : null,
  }));
  const boothCount = mapData.booths.length;
  const tierCount = mapData.legend.length;

  return (
    <section className="mt-8" aria-labelledby="floor-map-heading">
      <div className="flex items-center justify-between mb-4">
        <h2 id="floor-map-heading" className="text-xl font-bold text-gray-900 dark:text-slate-100">
          Floor map
        </h2>
        <Link
          href={`${eventPath(eventId)}/map`}
          className="text-sm font-medium text-brand-link hover:underline"
        >
          Open map →
        </Link>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-black/20 overflow-hidden">
        <MapCanvas
          width={mapData.width}
          height={mapData.height}
          gridSize={mapData.gridSize}
          unit={mapData.unit}
          underlayUrl={mapData.underlayUrl}
          underlayOpacity={mapData.underlayOpacity}
          elements={elements}
          booths={booths}
          interactive={false}
        />
      </div>
      <p className="mt-2 text-sm text-gray-500 dark:text-slate-400 text-center">
        {boothCount} booth{boothCount === 1 ? '' : 's'} across {tierCount} tier{tierCount === 1 ? '' : 's'}
      </p>
    </section>
  );
}
