'use client';

// OAuth consent is intentionally outside the admin shell. The edge middleware
// requires a complete staff session (including two-step), and approval triggers
// the same recent-auth dialog used by account security changes.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  ReauthProvider,
  isReauthCancelled,
  useReauth,
} from '@/app/admin/account/useReauth';
import { oauthApi, type OAuthConsentDetails, type OAuthRequest } from '@/lib/oauth';

function Consent() {
  const searchParams = useSearchParams();
  const { withReauth } = useReauth();
  const request = useMemo<OAuthRequest>(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams]
  );
  const [details, setDetails] = useState<OAuthConsentDetails | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetails(null);
    setError(null);
    oauthApi
      .prepare(request)
      .then((value) => {
        if (!active) return;
        setDetails(value);
        if (value.organizations.length === 1) setOrganizationId(value.organizations[0].id);
      })
      .catch((reason: any) => {
        if (active) setError(reason?.message || 'This authorization request is invalid or expired.');
      });
    return () => { active = false; };
  }, [request]);

  const approve = async () => {
    if (!details || !organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await withReauth(() =>
        oauthApi.approve({
          ...request,
          organization_id: organizationId,
          csrf_token: details.csrfToken,
        })
      );
      window.location.assign(result.redirect_to);
    } catch (reason: any) {
      setBusy(false);
      if (!isReauthCancelled(reason)) {
        setError(reason?.message || 'Jump could not approve this connection.');
      }
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-white sm:py-12">
      <section
        className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-8"
        aria-labelledby="oauth-consent-title"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Jump agent access</p>
            <h1 id="oauth-consent-title" className="mt-1 text-2xl font-bold tracking-tight">
              Connect an app to your store
            </h1>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        {!details && !error && (
          <p role="status" className="mt-6 text-sm text-slate-600 dark:text-slate-300">
            Checking this connection request…
          </p>
        )}

        {details && (
          <>
            <div className="mt-6 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                <strong className="font-semibold">{details.client.name}</strong> is asking to connect as you.
              </p>
              <p className="mt-2 break-all text-xs text-slate-600 dark:text-slate-400">
                You will return to <strong className="font-medium">{details.redirectHost}</strong> after approval.
              </p>
            </div>

            {details.loopback && (
              <div className="mt-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <p>This app returns to software running on this device. Approve only if you started that connection yourself.</p>
              </div>
            )}

            <div className="mt-6">
              <h2 className="text-sm font-semibold">This app will be able to</h2>
              <ul className="mt-3 space-y-2">
                {details.scopes.map(({ scope, description }) => (
                  <li key={scope} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-sm font-medium">{description}</p>
                    <code className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{scope}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                Agents cannot access customers, ticket holders, applications, orders, payment details, staff, or account security.
              </p>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Choose one store</legend>
              {details.organizations.length ? (
                <div className="mt-3 space-y-2">
                  {details.organizations.map((organization) => (
                    <label key={organization.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 p-3 has-[:checked]:border-indigo-600 has-[:checked]:ring-1 has-[:checked]:ring-indigo-600 dark:border-slate-600">
                      <input
                        type="radio"
                        name="organization"
                        value={organization.id}
                        checked={organizationId === organization.id}
                        onChange={() => setOrganizationId(organization.id)}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      <span className="text-sm font-medium">{organization.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  No eligible stores. You must be an Admin and agent access must be enabled for the store.
                </p>
              )}
            </fieldset>

            <p className="mt-6 text-xs text-slate-600 dark:text-slate-400">
              The connection stays limited to the store and permissions above. Jump can revoke it without waiting for the app.
            </p>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => window.location.assign(details.denyUrl)}
                disabled={busy}
                className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void approve()}
                disabled={!organizationId || busy}
                className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Allow access'}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function OAuthConsentPage() {
  return (
    <ReauthProvider>
      <Suspense fallback={null}>
        <Consent />
      </Suspense>
    </ReauthProvider>
  );
}
