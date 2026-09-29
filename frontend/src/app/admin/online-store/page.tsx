'use client';

// Online store — /admin/online-store (spec 038 D16). Organizations in the
// themes rollout get the themes overview; every other organization keeps
// today's branding page, where a SYSTEM_ADMIN can switch themes on.

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import { themesApi, type ThemeStatus } from '@/lib/themes';
import LegacyOnlineStore from './LegacyOnlineStore';
import ThemesOverview from './ThemesOverview';

export default function OnlineStorePage() {
  const { selectedOrg, loading } = useOrg();
  const { data: session } = useSession();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  const [status, setStatus] = useState<ThemeStatus | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await themesApi.status());
    } catch {
      setStatus(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (loading || !selectedOrg) return;
    setChecked(false);
    void load();
  }, [selectedOrg?.id, loading, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!checked && selectedOrg) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8" aria-busy="true" aria-label="Loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        ))}
      </div>
    );
  }
  if (status?.enabled) return <ThemesOverview />;

  const rollout =
    isSystemAdmin && status?.masterSwitch ? (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 p-4 text-sm dark:border-slate-600" data-testid="themes-rollout">
        <p className="text-gray-700 dark:text-slate-300">
          <span className="font-semibold">Themes (pilot).</span> Server-rendered storefront and theme editor for this organization.
        </p>
        <button
          type="button"
          onClick={async () => {
            setStatus(await themesApi.setRollout(true));
          }}
          className="rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Turn on themes
        </button>
      </div>
    ) : null;
  return <LegacyOnlineStore rollout={rollout} />;
}
