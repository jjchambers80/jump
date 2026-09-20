'use client';

// Account › Security (spec 030): passkeys, password, connected accounts,
// secondary email (B), devices (D). Two-step authentication (C) replaces
// the placeholder when it lands.

import { useCallback, useEffect, useState } from 'react';
import { accountApi, type SecurityOverview } from '../accountApi';
import { ReauthProvider } from '../useReauth';
import DevicesCard from './DevicesCard';
import { ConnectedAccountsCard, PasskeysCard, PasswordCard, SecondaryEmailCard, cardClass } from './SignInMethodsCards';

const placeholderClass =
  'rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 sm:p-5';

export default function AccountSecurityPage() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOverview(await accountApi.security());
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to load your security settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = (message: string) => {
    setActionError(null);
    setStatus(message);
    void load();
  };
  const onError = (message: string) => {
    setActionError(message);
    setStatus(message);
  };

  return (
    <ReauthProvider>
      <section aria-labelledby="account-security-heading">
        <h2 id="account-security-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
          Security
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          How you sign in to Jump, and where you&apos;re signed in. Changes here ask you to confirm it&apos;s you first.
        </p>

        {actionError && (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {actionError}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button type="button" onClick={load} className="mt-3 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white">Retry</button>
          </div>
        )}

        {!overview && !error && (
          <div aria-label="Loading security settings" className="mt-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`${cardClass} animate-pulse`}>
                <div className="h-4 w-40 rounded bg-gray-200 dark:bg-slate-700" />
                <div className="mt-4 h-12 rounded-lg bg-gray-100 dark:bg-slate-700/70" />
              </div>
            ))}
          </div>
        )}

        {overview && (
          <div className="mt-4 space-y-4">
            <PasskeysCard overview={overview} onChanged={onChanged} onError={onError} />
            <PasswordCard overview={overview} onChanged={onChanged} onError={onError} />
            <ConnectedAccountsCard overview={overview} onChanged={onChanged} onError={onError} />
            <SecondaryEmailCard overview={overview} onChanged={onChanged} onError={onError} />
            <div className={placeholderClass}>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Two-step authentication</h3>
              <p className="mt-1">Coming soon.</p>
            </div>
            <DevicesCard />
          </div>
        )}

        <div role="status" aria-live="polite" className="sr-only">{status}</div>
      </section>
    </ReauthProvider>
  );
}
