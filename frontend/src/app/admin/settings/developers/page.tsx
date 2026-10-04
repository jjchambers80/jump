'use client';

// Settings › Developers (spec 043): Jump CLI sign-ins for this organization.
// Administrators see and revoke everyone's; organizers see their own. A
// revoked token stops working on its next request.

import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import { useAccountFormat } from '@/lib/accountFormat';
import { developerApi, type DeveloperToken } from '@/lib/developerTokens';
import SettingsNav from '../SettingsNav';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const dangerBtn =
  'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';

export default function DevelopersSettingsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { formatDateTime } = useAccountFormat();
  const [tokens, setTokens] = useState<DeveloperToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTokens((await developerApi.list()).tokens);
    } catch (err: any) {
      setError(err?.message || 'Could not load developer sign-ins');
    }
  }, []);

  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    void load();
  }, [load, orgLoading, selectedOrgId]);

  const revoke = async (token: DeveloperToken) => {
    if (!window.confirm(`Revoke “${token.name}” for ${token.user.name}? The CLI must sign in again.`)) return;
    try {
      await developerApi.revoke(token.id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not revoke the token');
    }
  };
  const when = (iso: string) => formatDateTime(iso, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="developers-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="developers-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
            Developers
          </h2>
          <div className={cardClass}>
            <h3 className="font-semibold text-gray-900 dark:text-white">Jump CLI</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Developers pull your theme, edit it locally (by hand or with an AI coding assistant), and push it to a draft theme you
              can preview before publishing. Run <code className="rounded bg-gray-100 px-1 dark:bg-slate-700">jump login --store &lt;your store&gt;</code>{' '}
              to sign in. Each sign-in can only work on themes.
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}

          <div className={cardClass}>
            <h3 className="font-semibold text-gray-900 dark:text-white">Signed-in developers</h3>
            {!tokens ? (
              <div className="mt-4 h-16 animate-pulse rounded bg-gray-100 dark:bg-slate-700" aria-busy="true" aria-label="Loading" />
            ) : tokens.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">No one has signed in to the Jump CLI for this store.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-200 dark:divide-slate-700" data-testid="developer-tokens">
                {tokens.map((token) => (
                  <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {token.name} <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{token.prefix}…</span>
                      </p>
                      <p className="text-sm text-gray-600 dark:text-slate-400">
                        {token.user.name} · {token.scopes.join(', ')} · last used {token.lastUsedAt ? when(token.lastUsedAt) : 'never'} · expires{' '}
                        {when(token.expiresAt)}
                      </p>
                    </div>
                    <button type="button" className={dangerBtn} onClick={() => void revoke(token)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
