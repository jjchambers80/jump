'use client';

import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import type { EventSummary } from '../../../components/EventCard';
import OrganizationEventsBody from '../../../components/storefront/OrganizationEventsBody';
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

  // Events render after the fetch, too late for the browser's own #events jump.
  useEffect(() => {
    if (data && !data.locked && window.location.hash === '#events') {
      document.getElementById('events')?.scrollIntoView();
    }
  }, [data]);

  useEffect(() => {
    void fetchOrg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (loading) {
    return <StorefrontSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400 dark:text-slate-500">404</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
            Organization Not Found
          </h2>
          <p className="mt-2 text-gray-600 dark:text-slate-400">
            {error || 'This organization does not exist or is inactive.'}
          </p>
        </div>
      </div>
    );
  }

  const { organization, events } = data;

  if (data.locked) {
    return (
      <StorefrontPasswordGate
        organization={organization}
        message={data.message ?? null}
        onUnlocked={fetchOrg}
      />
    );
  }

  return (
    <BrandScope
      color={organization.brandColor}
      themeMode={organization.themeMode}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      <OrganizationHeader
        organization={organization}
        as="h1"
        nav
        signIn={organization.buyerSignInLinks !== false}
      />

      <OrganizationEventsBody organization={organization} events={events} />

      <StorefrontFooter organization={organization} />
    </BrandScope>
  );
}

/** Neutral placeholder: the brand color is not known until the organization loads. */
function StorefrontSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900" aria-busy="true" aria-label="Loading">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-5 lg:px-8">
        <div className="h-14 w-14 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700 sm:h-16 sm:w-16" />
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      </div>
      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-12 sm:px-6 lg:px-8">
        <div className="mb-8 h-8 w-56 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[8.5rem] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
            <div className="w-20 animate-pulse bg-gray-100 dark:bg-slate-700/60 sm:w-28" />
            <div className="flex-1 space-y-3 p-5">
              <div className="h-5 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
