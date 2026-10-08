'use client';

// Jump CLI sign-in (spec 043). `jump login --store <slug>` opens this page;
// the signed-in staff member approves, confirms it's them (step-up), and the
// browser hands a one-time code back to the CLI's loopback listener. The
// edge middleware has already sent signed-out visitors to sign-in and
// mid-two-step sessions to /auth/two-step.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReauthProvider, isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { developerApi, isLoopbackRedirect, type CliStore } from '@/lib/developerTokens';

const card = 'mx-auto mt-12 max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800';
const primary =
  'rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

function back(redirectUri: string, params: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  window.location.assign(url.toString());
}

function Authorize() {
  const params = useSearchParams();
  const { withReauth } = useReauth();
  const store = params.get('store') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const name = params.get('name') ?? 'Jump CLI';
  const valid = Boolean(store && state && codeChallenge && isLoopbackRedirect(redirectUri));

  const [org, setOrg] = useState<CliStore | null>(null);
  const [error, setError] = useState<string | null>(valid ? null : 'This sign-in link is incomplete. Run `jump login` again.');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle');

  useEffect(() => {
    if (!valid) return;
    developerApi
      .store(store)
      .then(({ organization }) => setOrg(organization))
      .catch((err: any) => setError(err?.status === 403 ? `You are not a member of “${store}”.` : err?.message || 'Store not found'));
  }, [store, valid]);

  const approve = async () => {
    setStatus('busy');
    setError(null);
    try {
      const { code } = await withReauth(() => developerApi.approve({ store, codeChallenge, redirectUri, name }));
      setStatus('done');
      back(redirectUri, { code, state });
    } catch (err: any) {
      setStatus('idle');
      if (!isReauthCancelled(err)) setError(err?.message || 'Could not approve the sign-in');
    }
  };

  return (
    <div className="px-4">
      <section className={card} aria-labelledby="cli-authorize-title">
        <h1 id="cli-authorize-title" className="text-xl font-semibold text-gray-900 dark:text-white">
          Sign in to the Jump CLI
        </h1>
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        )}
        {status === 'done' ? (
          <p role="status" className="mt-4 text-sm text-gray-700 dark:text-slate-300">
            Approved. You can close this tab and return to your terminal.
          </p>
        ) : (
          org && (
            <>
              <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">
                <strong className="font-semibold">{name}</strong> wants to edit the online store themes of{' '}
                <strong className="font-semibold">{org.name}</strong> as you.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-slate-400">
                <li>Read, edit, duplicate, preview and publish themes</li>
                <li>Nothing else: no orders, customers, payments or settings</li>
                <li>Valid for 90 days; revoke it any time in Settings › Developers</li>
              </ul>
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">Only approve if you just ran <code>jump login</code> yourself.</p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className={secondary} onClick={() => back(redirectUri, { error: 'access_denied', state })}>
                  Cancel
                </button>
                <button type="button" className={primary} onClick={() => void approve()} disabled={status === 'busy'}>
                  {status === 'busy' ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </>
          )
        )}
      </section>
    </div>
  );
}

export default function CliAuthorizePage() {
  return (
    <ReauthProvider>
      <Suspense fallback={null}>
        <Authorize />
      </Suspense>
    </ReauthProvider>
  );
}
