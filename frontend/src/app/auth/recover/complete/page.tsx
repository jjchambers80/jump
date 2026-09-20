'use client';

// Landing page for the recovery link: swaps the one-time token for a bridge
// token, then signs in through the `token-bridge` provider.

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

function RecoverComplete() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/recover/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error('This recovery link is invalid or has expired.');
        const { bridgeToken } = await res.json();
        const result = await signIn('token-bridge', { token: bridgeToken, redirect: false, callbackUrl: '/admin/account/security' });
        if (result?.error) throw new Error('Sign-in failed. Request a new link.');
        if (!cancelled) window.location.href = result?.url || '/admin/account/security';
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'This recovery link could not be used.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">This link can’t be used</h1>
            <p role="alert" className="mt-2 text-sm text-gray-600 dark:text-slate-400">{error}</p>
            <Link href="/auth/recover" className="mt-6 inline-block text-sm font-medium text-indigo-600 dark:text-indigo-400">Request a new link</Link>
          </>
        ) : (
          <p role="status" className="text-sm text-gray-600 dark:text-slate-400">Signing you in…</p>
        )}
      </div>
    </main>
  );
}

export default function RecoverCompletePage() {
  return (
    <Suspense fallback={null}>
      <RecoverComplete />
    </Suspense>
  );
}
