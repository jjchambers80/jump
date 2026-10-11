'use client';

// Review's brand summary (spec 050 §5.1): read-only. Per-event colour or theme
// controls are rejected (§11.6); the store's brand is changed in Settings › Brand.

import Link from 'next/link';
import { useOrg } from '@/components/OrgContext';

const THEME: Record<string, string> = { LIGHT: 'Light', DARK: 'Dark', SYSTEM: "Follows the visitor's device" };

export default function BrandSummary() {
  const { selectedOrg: org } = useOrg();
  return (
    <section aria-labelledby="review-brand" className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="review-brand" className="text-base font-semibold text-gray-900 dark:text-white">
          Brand
        </h2>
        <Link href="/admin/settings/brand" className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-gray-900 underline underline-offset-2 dark:text-white">
          Edit in Settings › Brand
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Your event page uses your store&apos;s brand.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-600 dark:text-slate-400">Logo</dt>
        <dd className="text-gray-900 dark:text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {org?.logoUrl ? <img src={org.logoUrl} alt={`${org.name} logo`} className="h-8 max-w-[10rem] object-contain" /> : 'No logo'}
        </dd>
        <dt className="text-gray-600 dark:text-slate-400">Color</dt>
        <dd className="flex items-center gap-2 text-gray-900 dark:text-white">
          {org?.brandColor ? (
            <>
              <span aria-hidden className="h-5 w-5 rounded border border-gray-300 dark:border-slate-600" style={{ backgroundColor: org.brandColor }} />
              {org.brandColor.toUpperCase()}
            </>
          ) : (
            'Default'
          )}
        </dd>
        <dt className="text-gray-600 dark:text-slate-400">Theme</dt>
        <dd className="text-gray-900 dark:text-white">{THEME[org?.themeMode ?? 'SYSTEM'] ?? THEME.SYSTEM}</dd>
      </dl>
    </section>
  );
}
