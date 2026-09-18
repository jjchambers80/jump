'use client';

// Online store — /admin/online-store
// Public storefront settings (store name, handle, theme, branding) for the
// organization currently picked in the header org switcher.

import React, { useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import OnlineStoreSettings from '@/components/OnlineStoreSettings';
import { resolveAssetUrl } from '@/lib/assets';

export default function OnlineStorePage() {
  const { selectedOrg: org, loading, error: orgError, refresh } = useOrg();
  const [error, setError] = useState<string | null>(null);

  if (loading && !org) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse h-16 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!org) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Online store</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {orgError ?? 'Pick an organization from the menu in the top right.'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Online store</h1>

      {/* Store header */}
      <div className="flex items-center gap-3 mb-6">
        {org.logoUrl ? (
          <img
            src={resolveAssetUrl(org.logoUrl) || undefined}
            alt={`${org.name} logo`}
            className="w-12 h-12 rounded-md object-contain bg-gray-100 dark:bg-slate-700 flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-md bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            <span className="text-gray-400 dark:text-slate-500 text-xl font-bold">
              {org.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{org.name}</h2>
          <div className="flex items-center gap-4 mt-0.5 text-sm text-gray-500 dark:text-slate-400">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                org.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400'
              }`}
            >
              {org.status}
            </span>
            {org._count && (
              <>
                <span>
                  {org._count.venues} venue{org._count.venues !== 1 ? 's' : ''}
                </span>
                <span>
                  {org._count.users} user{org._count.users !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <OnlineStoreSettings org={org} onSaved={refresh} onError={setError} />
      </div>
    </div>
  );
}
