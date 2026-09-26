'use client';

import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import { resolveAssetUrl } from '../../../lib/assets';
import EventCard, { EventSummary } from '../../../components/EventCard';
import BrandScope from '../../../components/BrandScope';
import OrganizationHeader from '../../../components/OrganizationHeader';
import StorefrontPasswordGate from '../../../components/StorefrontPasswordGate';
import StorefrontFooter from '../../../components/storefront/StorefrontFooter';
import type { ThemeMode } from '@/lib/theme';

interface OrganizationPublic {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
  /** Settings › Customer accounts › Show sign-in links (spec 031). */
  buyerSignInLinks?: boolean;
}

interface OrgPageData {
  organization: OrganizationPublic;
  events: EventSummary[];
  /** Private mode (Online store › Preferences) and no valid access token. */
  locked?: boolean;
  /** Organizer's message for the password page. */
  message?: string | null;
}

/** Client half of /organizations/[orgId]; page.tsx wraps it with generateMetadata. */
export default function OrganizationStorefront({ orgId }: { orgId: string }) {
  const [data, setData] = useState<OrgPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = async () => {
    try {
      setLoading(true);
      setError(null);
      // services/api.ts attaches any stored X-Storefront-Access tokens.
      const result = await api.get<OrgPageData>(`/organizations/${orgId}/public`);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOrg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (loading) {
    // A skeleton in the shape of the real page, so the first paint does not jump
    // from a centred spinner to a full storefront.
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900" aria-busy="true">
        <p className="sr-only" role="status">
          Loading organization
        </p>
        <div className="w-full border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:px-8">
            <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-gray-200 sm:h-24 sm:w-24 dark:bg-slate-700" />
            <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          </div>
        </div>
        <div className="h-56 w-full animate-pulse bg-gray-200 sm:h-64 md:h-72 lg:h-80 xl:h-96 dark:bg-slate-800" />
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="h-7 w-48 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Organization Not Found
          </h2>
          <p className="text-gray-600 dark:text-slate-400">
            {error || 'This organization does not exist or is inactive.'}
          </p>
        </div>
      </div>
    );
  }

  const { organization, events } = data;
  const coverSrc = resolveAssetUrl(organization.coverUrl);
  const hasCover = Boolean(coverSrc);

  if (data.locked) {
    return (
      <StorefrontPasswordGate
        organization={organization}
        message={data.message ?? null}
        onUnlocked={fetchOrg}
      />
    );
  }

  const eventCount = events.length;

  // Header, then a full-bleed cover band, then the events grid.
  //
  // The cover used to be a sticky 55%-wide column at xl+ with a duplicate <img>
  // for narrow screens. That halved the width available to the events — the one
  // thing a visitor came for — at every desktop size, hard-cropped the artwork,
  // and left a tall dead zone once the sticky column ran out. A bounded
  // full-bleed band keeps the brand impact, downloads the cover once, and hands
  // the full container width back to the grid, matching /events and
  // /venues/[venueId], which already render EventCard three-up.
  return (
    <BrandScope
      color={organization.brandColor}
      themeMode={organization.themeMode}
      className="flex min-h-screen flex-col bg-gray-50 dark:bg-slate-900"
    >
      <OrganizationHeader
        organization={organization}
        as="h1"
        nav
        signIn={organization.buyerSignInLinks !== false}
      />

      {hasCover && (
        <div className="h-56 w-full overflow-hidden bg-gray-200 sm:h-64 md:h-72 lg:h-80 xl:h-96 dark:bg-slate-800">
          <img
            src={coverSrc!}
            alt={`${organization.name} cover`}
            className="h-full w-full object-cover object-center"
          />
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
        <section aria-labelledby="upcoming-events">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2
              id="upcoming-events"
              className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-slate-100"
            >
              Upcoming events
            </h2>
            {eventCount > 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {eventCount} {eventCount === 1 ? 'event' : 'events'}
              </p>
            )}
          </div>

          {eventCount === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-800">
              <svg
                className="mx-auto mb-4 h-14 w-14 text-gray-300 dark:text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300">
                No upcoming events
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
                Check back later for new events from {organization.name}.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>

      <StorefrontFooter organization={organization} />
    </BrandScope>
  );
}
