'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EventCard, { type EventSummary } from '@/components/EventCard';
import { resolveAssetUrl } from '@/lib/assets';
import BrandScope from '@/components/BrandScope';
import type { ThemeMode } from '@/lib/theme';
import api from '@/services/api';

interface PublicVenue {
  id: string;
  name: string;
  address: string;
  timezone: string;
  logoUrl: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
}

interface PublicVenueResponse {
  venue: PublicVenue;
  events: EventSummary[];
}

export default function PublicVenuePage({ params }: { params: { venueId: string } }) {
  const [data, setData] = useState<PublicVenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadVenue = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get<PublicVenueResponse>(`/venues/${params.venueId}`);
        if (active) setData(response);
      } catch (requestError: any) {
        if (active) {
          setError(
            requestError.status === 404
              ? 'This venue is not available.'
              : requestError.message || 'Unable to load this venue.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadVenue();
    return () => {
      active = false;
    };
  }, [params.venueId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center" data-testid="venue-loading">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" aria-hidden="true" />
          <p className="text-gray-600 dark:text-slate-400">Loading venue…</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4" data-testid="venue-not-found">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-slate-800">
          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-slate-100">Venue Not Found</h1>
          <p className="mb-6 text-gray-600 dark:text-slate-400">{error}</p>
          <Link href="/events" className="inline-block rounded bg-blue-600 px-6 py-2 font-bold text-white hover:bg-blue-700">
            Browse Events
          </Link>
        </div>
      </main>
    );
  }

  const logoSrc = resolveAssetUrl(data.venue.logoUrl);

  return (
    <BrandScope color={data.venue.brandColor} themeMode={data.venue.themeMode}>
    <main className="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-slate-900">
      <header className="border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-8 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={`${data.venue.name} logo`}
              data-testid="venue-logo"
              className="h-28 w-28 shrink-0 rounded-lg border border-gray-200 bg-white object-contain p-2 dark:border-slate-600"
            />
          ) : (
            <div
              data-testid="venue-logo-fallback"
              role="img"
              aria-label={`${data.venue.name} logo unavailable`}
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-4xl font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            >
              {data.venue.name.trim().charAt(0).toUpperCase() || 'V'}
            </div>
          )}
          <div className="min-w-0">
            <h1 data-testid="venue-name" className="break-words text-3xl font-bold text-gray-900 dark:text-slate-100 sm:text-4xl">
              {data.venue.name}
            </h1>
            <p className="mt-2 break-words text-gray-600 dark:text-slate-400">{data.venue.address}</p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-labelledby="venue-events-heading">
        <h2 id="venue-events-heading" className="mb-8 text-2xl font-bold text-gray-900 dark:text-slate-100">
          Events at {data.venue.name}
        </h2>

        {data.events.length === 0 ? (
          <div data-testid="venue-empty-state" className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-800">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100">No events scheduled</h3>
            <p className="mt-2 text-gray-600 dark:text-slate-400">Check back soon for new events.</p>
          </div>
        ) : (
          <div data-testid="venue-event-list" className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {data.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </main>
    </BrandScope>
  );
}
