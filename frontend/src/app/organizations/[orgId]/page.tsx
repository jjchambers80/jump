'use client';

import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import { resolveAssetUrl } from '../../../lib/assets';
import EventCard, { EventSummary } from '../../../components/EventCard';
import BrandScope from '../../../components/BrandScope';

interface OrganizationPublic {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor?: string | null;
}

interface OrgPageData {
  organization: OrganizationPublic;
  events: EventSummary[];
}

export default function OrganizationPage({ params }: { params: { orgId: string } }) {
  const [data, setData] = useState<OrgPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrg = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await api.get<OrgPageData>(`/organizations/${params.orgId}/public`);
        setData(result);
      } catch (err: any) {
        setError(err.message || 'Failed to load organization');
      } finally {
        setLoading(false);
      }
    };
    fetchOrg();
  }, [params.orgId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
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
          <p className="text-gray-600 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const logoSrc = resolveAssetUrl(organization.logoUrl);
  const hasCover = Boolean(coverSrc);

  const eventList = (
    <>
      {/* Org header */}
      <div className="mb-8">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={`${organization.name} logo`}
            className="max-h-[85px] w-auto rounded-lg object-contain mb-3"
          />
        ) : (
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            {organization.name}
          </h1>
        )}
      </div>

      {/* Event cards */}
      {events.length === 0 ? (
        <div className="text-center py-16">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300 mb-2">
            No upcoming events
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Check back later for new events from {organization.name}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </>
  );

  // Desktop with cover: two-column, image flush right
  // Desktop without cover: centered single column
  // Mobile: cover at top, then content
  return (
    <BrandScope color={organization.brandColor} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Mobile cover image */}
      {hasCover && (
        <div className="xl:hidden w-full">
          <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
            <img
              src={coverSrc!}
              alt={`${organization.name} cover`}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {hasCover ? (
        /* Two-column desktop layout */
        <div className="xl:flex min-h-screen">
          {/* Left: event content — full width below xl, pushed right at xl+ */}
          <div className="flex-1 xl:flex xl:justify-end">
            <div className="w-full xl:max-w-4xl px-4 sm:px-6 py-8 xl:py-12">
              {eventList}
            </div>
          </div>

          {/* Right: cover image, flush to window edge */}
          <div className="hidden xl:block w-[55%] max-w-3xl sticky top-0 h-screen">
            <img
              src={coverSrc!}
              alt={`${organization.name} cover`}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      ) : (
        /* Centered single column */
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 xl:py-12">
          {eventList}
        </div>
      )}
    </BrandScope>
  );
}
