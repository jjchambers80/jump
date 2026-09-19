'use client';

// Chrome for public content pages (blog listing, blog post, page): brand
// scope + organization header, with the loading / gate / not-found states of
// useStorefrontContent handled in one place.

import Link from 'next/link';
import type { ReactNode } from 'react';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import StorefrontPasswordGate from '@/components/StorefrontPasswordGate';
import type { ThemeMode } from '@/lib/theme';
import type { StorefrontContentState } from './useStorefrontContent';

export interface StorefrontOrganization {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
}

interface StorefrontShellProps<T extends { organization: StorefrontOrganization }> {
  orgId: string;
  state: StorefrontContentState<T>;
  notFoundTitle: string;
  children: (data: T) => ReactNode;
}

export default function StorefrontShell<T extends { organization: StorefrontOrganization }>({
  orgId,
  state,
  notFoundTitle,
  children,
}: StorefrontShellProps<T>) {
  const { data, loading, error, notFound, lock, retry } = state;

  if (lock) {
    return (
      <StorefrontPasswordGate
        organization={lock.organization}
        message={lock.message}
        onUnlocked={retry}
      />
    );
  }

  if (loading) {
    return (
      <div
        className="min-h-screen bg-gray-50 dark:bg-slate-900"
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="h-28 animate-pulse border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
          <div className="h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (notFound || error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {notFound ? notFoundTitle : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            {notFound ? 'It may have been moved or is not published yet.' : error}
          </p>
          <Link
            href={`/organizations/${orgId}`}
            className="mt-4 inline-block text-sm font-medium text-brand-link hover:underline"
          >
            Back to the organization page
          </Link>
        </div>
      </div>
    );
  }

  const { organization } = data;
  return (
    <BrandScope
      color={organization.brandColor}
      themeMode={organization.themeMode}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      <OrganizationHeader organization={organization} as="link" />
      {children(data)}
    </BrandScope>
  );
}
