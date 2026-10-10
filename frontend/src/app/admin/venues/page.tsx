'use client';

// Admin › Venues: every place the organization holds events. Each card links
// to the venue's read-only Details page, which links on to the editor — the
// same list → details → edit path as Events (spec 037). Search and the
// visibility filter live in the URL (?q=, ?visibility=) so the admin search
// "View all" link and the back button land on the same view.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Clock, ExternalLink, MapPin, Pencil, Plus, Search, X } from 'lucide-react';
import VisibilityBadge from '@/components/venues/VisibilityBadge';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { imageVariantUrl } from '@/lib/assets';
import { timeZoneLabel } from '@/lib/timeZones';
import { type AdminVenue, venueLocality, venueMonogram, venuePublicPath } from '@/lib/venues';

type Visibility = '' | 'public' | 'private';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];

function VenuesListContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedOrgId } = useOrg();
  const q = searchParams.get('q') || '';
  const urlVisibility = (['public', 'private'].includes(searchParams.get('visibility') || '')
    ? searchParams.get('visibility')
    : '') as Visibility;
  const notice = searchParams.get('notice');

  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local state answers at once; one debounced writer mirrors it into the URL.
  const [query, setQuery] = useState(q);
  const [visibility, setVisibility] = useState<Visibility>(urlVisibility);

  const fetchVenues = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setLoading(true);
      setError(null);
      setVenues(await api.get<AdminVenue[]>(`/organizations/${selectedOrgId}/venues`));
    } catch (err: any) {
      setError(err?.message || 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const next = { q: query.trim(), visibility };
      if (params.get('q') === (next.q || null) && params.get('visibility') === (next.visibility || null)) return;
      params.delete('notice');
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [query, visibility, pathname, router]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      venues.filter((venue) => {
        if (visibility === 'public' && !venue.isPublic) return false;
        if (visibility === 'private' && venue.isPublic) return false;
        if (!needle) return true;
        return [venue.name, venue.address, venue.city, venue.state, venue.postalCode]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle));
      }),
    [venues, visibility, needle]
  );
  const filtered = Boolean(needle || visibility);
  const orgQuery = searchParams.get('orgId') ? `?orgId=${encodeURIComponent(searchParams.get('orgId')!)}` : '';

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800">
            <MapPin className="h-5 w-5 text-gray-500 dark:text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Venues</h1>
              {!loading && selectedOrgId && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {venues.length} total
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-400">
              Where your events happen. A venue&apos;s time zone sets the clock its event times print in.
            </p>
          </div>
        </div>
        {selectedOrgId && (
          <Link
            href={`/admin/venues/new${orgQuery}`}
            className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover ${focusRing}`}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add venue
          </Link>
        )}
      </header>

      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {!selectedOrgId ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">Choose an organization to see its venues.</p>
      ) : loading ? (
        <ListSkeleton />
      ) : venues.length === 0 ? (
        <EmptyState href={`/admin/venues/new${orgQuery}`} />
      ) : (
        <>
          <div role="search" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <label htmlFor="venue-search" className="sr-only">
                Search venues
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" aria-hidden />
              <input
                id="venue-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, street or city"
                className="block min-h-11 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 sm:min-h-10 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white ${focusRing}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            <fieldset>
              <legend className="sr-only">Visibility</legend>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
                {VISIBILITY_OPTIONS.map((option) => (
                  <label key={option.label} className="cursor-pointer">
                    <input
                      type="radio"
                      name="venue-visibility"
                      value={option.value}
                      checked={visibility === option.value}
                      onChange={() => setVisibility(option.value)}
                      className="peer sr-only"
                    />
                    <span className="flex min-h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 peer-checked:bg-white peer-checked:text-gray-900 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:text-slate-400 dark:hover:text-slate-100 dark:peer-checked:bg-slate-700 dark:peer-checked:text-white motion-reduce:transition-none">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <p role="status" aria-live="polite" className={filtered ? 'mb-3 text-sm text-gray-600 dark:text-slate-400' : 'sr-only'}>
            {shown.length === venues.length
              ? `${venues.length} venue${venues.length === 1 ? '' : 's'}`
              : `${shown.length} of ${venues.length} venues`}
          </p>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center dark:border-slate-600">
              <p className="text-sm text-gray-600 dark:text-slate-400">No venues match these filters.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setVisibility('');
                }}
                className={`mt-3 inline-flex min-h-10 items-center rounded-md border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul role="list" className="grid gap-4 lg:grid-cols-2">
              {shown.map((venue, i) => (
                <li key={venue.id} className="motion-safe:animate-card-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <VenueCard venue={venue} orgQuery={orgQuery} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function VenueCard({ venue, orgQuery }: { venue: AdminVenue; orgQuery: string }) {
  const headingId = `venue-${venue.id}-title`;
  const logo = imageVariantUrl(venue.logoUrl, 'thumb');
  const locality = venueLocality(venue);
  const events = venue._count?.events ?? 0;
  const iconClass = 'h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500';

  return (
    <article
      aria-labelledby={headingId}
      className="group relative flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm shadow-gray-900/[0.03] transition-colors hover:border-accent-300 focus-within:border-accent-300 dark:border-slate-700/80 dark:bg-slate-800 dark:shadow-none dark:hover:border-accent-500/50 motion-reduce:transition-none"
    >
      <div className="flex min-w-0 flex-1 gap-4 p-4 sm:p-5">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-accent-50 ring-1 ring-inset ring-black/5 dark:bg-slate-700/60 dark:ring-white/10 sm:h-16 sm:w-16" aria-hidden>
          {logo ? (
            <img src={logo} alt="" width={64} height={64} loading="lazy" className="h-full w-full bg-white object-contain p-1" />
          ) : (
            <div className="flex h-full w-full items-center justify-center [background-image:repeating-linear-gradient(135deg,rgb(99_102_241/0.10)_0_1px,transparent_1px_7px)]">
              <span className="select-none text-2xl font-black tracking-tighter text-accent-600/70 dark:text-accent-300/50">{venueMonogram(venue.name)}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="min-w-0 text-base font-semibold text-gray-900 [overflow-wrap:anywhere] dark:text-white">
              <Link
                href={`/admin/venues/${venue.id}${orgQuery}`}
                className={`rounded hover:text-accent-700 dark:hover:text-accent-300 after:absolute after:inset-0 after:rounded-xl after:content-[''] ${focusRing}`}
              >
                {venue.name}
              </Link>
            </h2>
            <VisibilityBadge isPublic={venue.isPublic} />
          </div>
          <address className="mt-1 text-sm not-italic text-gray-600 [overflow-wrap:anywhere] dark:text-slate-300">
            {venue.address}
            {locality && <span className="block text-gray-500 dark:text-slate-400">{locality}</span>}
          </address>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 px-4 py-3 dark:border-slate-700/70 sm:px-5">
        <dl className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
          <div className="inline-flex items-center gap-1.5">
            <dt>
              <Clock className={iconClass} aria-hidden />
              <span className="sr-only">Time zone</span>
            </dt>
            <dd>{timeZoneLabel(venue.timezone)}</dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <dt>
              <CalendarDays className={iconClass} aria-hidden />
              <span className="sr-only">Events</span>
            </dt>
            <dd className="tabular-nums">
              {events} event{events === 1 ? '' : 's'}
            </dd>
          </div>
        </dl>
        {/* Above the stretched title link so each stays its own target. */}
        <div className="relative z-10 ml-auto flex items-center gap-1">
          {venue.isPublic && (
            <a
              href={venuePublicPath(venue)}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${venue.name} public page (opens in a new tab)`}
              title="View public page"
              className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
          <Link
            href={`/admin/venues/${venue.id}/edit${orgQuery}`}
            aria-label={`Edit ${venue.name}`}
            title="Edit venue"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ href }: { href: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 px-6 py-14 text-center dark:border-slate-600">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 dark:bg-slate-800">
        <MapPin className="h-6 w-6 text-accent-700 dark:text-accent-300" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">No venues yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-600 dark:text-slate-400">
        Add the places you hold events. Every event needs a venue, and its address sets the time zone tickets print in.
      </p>
      <Link
        href={href}
        className={`mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover ${focusRing}`}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add your first venue
      </Link>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading venues">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none dark:bg-slate-800" />
      ))}
    </div>
  );
}

// useSearchParams() needs a Suspense boundary (Next 14 App Router).
export default function VenuesPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8"><ListSkeleton /></div>}>
      <VenuesListContent />
    </Suspense>
  );
}
