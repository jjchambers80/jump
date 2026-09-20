'use client';

// Landing page for the secondary-email verification link (spec 030 B). Public.

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { accountApi } from '@/app/admin/account/accountApi';

type State = { kind: 'working' } | { kind: 'done'; email: string } | { kind: 'error'; message: string; code?: string };

function ConfirmSecondary() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token.' });
      return;
    }
    let cancelled = false;
    accountApi.secondaryEmail
      .confirm(token)
      .then((r) => !cancelled && setState({ kind: 'done', email: r.email }))
      .catch((e: any) => !cancelled && setState({ kind: 'error', message: e.message || 'This link could not be used.', code: e.code }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {state.kind === 'working' && <p role="status" className="text-sm text-gray-600 dark:text-slate-400">Verifying…</p>}
        {state.kind === 'done' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Secondary email verified</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              <span className="font-medium text-gray-900 dark:text-white">{state.email}</span> can now restore access to your Jump account and receives security notifications.
            </p>
            <Link href="/admin/account/security" className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Go to Security</Link>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{state.code === 'TOKEN_EXPIRED' ? 'This link has expired' : 'This link can’t be used'}</h1>
            <p role="alert" className="mt-2 text-sm text-gray-600 dark:text-slate-400">{state.message}</p>
            <Link href="/admin/account/security" className="mt-6 inline-block text-sm font-medium text-indigo-600 dark:text-indigo-400">Back to Security</Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function ConfirmSecondaryEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmSecondary />
    </Suspense>
  );
}
