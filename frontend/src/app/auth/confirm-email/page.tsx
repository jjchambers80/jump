'use client';

// Landing page for the email-change confirmation link (spec 030). Public:
// the link may be opened signed out or in another browser; the token
// identifies the account.

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { accountApi } from '@/app/admin/account/accountApi';

type State = { kind: 'working' } | { kind: 'done'; email: string } | { kind: 'error'; message: string; code?: string };

function ConfirmEmail() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const { status, update } = useSession();
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This confirmation link is missing its token.' });
      return;
    }
    let cancelled = false;
    accountApi
      .confirmEmailChange(token)
      .then((result) => {
        if (cancelled) return;
        setState({ kind: 'done', email: result.email });
        // Signed in here too: refresh the session claims so the new address shows at once.
        if (status === 'authenticated') void update();
      })
      .catch((error: any) => {
        if (cancelled) return;
        setState({ kind: 'error', message: error.message || 'This confirmation link could not be used.', code: error.code });
      });
    return () => {
      cancelled = true;
    };
    // Run once per token; the session status is only read for the refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {state.kind === 'working' && (
          <p role="status" className="text-sm text-gray-600 dark:text-slate-400">Confirming your new email address…</p>
        )}
        {state.kind === 'done' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Email address confirmed</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              Your Jump account now uses <span className="font-medium text-gray-900 dark:text-white">{state.email}</span>. Sign-in links go there from now on.
            </p>
            <Link href="/admin/account" className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              Go to your account
            </Link>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {state.code === 'TOKEN_EXPIRED' ? 'This link has expired' : 'This link can’t be used'}
            </h1>
            <p role="alert" className="mt-2 text-sm text-gray-600 dark:text-slate-400">{state.message}</p>
            <Link href="/admin/account" className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
              Back to account settings
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmail />
    </Suspense>
  );
}
