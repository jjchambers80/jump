// Magic-link landing page (spec 007 phase 2).
// Exchanges ?token= for the buyer session cookie via /api/buyer/verify, then
// sends the buyer to their account page for this organization.
'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { takeNext } from '@/lib/buyerNext';

function VerifyInner({ orgId }: { orgId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return; // tokens are single use; never retry on re-render
    attempted.current = true;

    if (!token) {
      setError('This sign-in link is missing its token.');
      return;
    }

    (async () => {
      const res = await fetch('/api/buyer/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'This sign-in link is invalid or has expired.');
        return;
      }
      const { organizationId } = await res.json();
      // Spec 031: return to where the buyer was going (checkout) when the
      // account page stored a same-origin path before sending the link.
      router.replace(takeNext() ?? `/organizations/${organizationId || orgId}/account`);
    })();
  }, [token, orgId, router]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">Sign-in link didn&apos;t work</h1>
            <p className="text-gray-600 dark:text-slate-400 mb-6">{error}</p>
            <Link
              href={`/organizations/${orgId}/account`}
              className="inline-block px-5 py-2 rounded-lg font-semibold bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Request a new link
            </Link>
          </>
        ) : (
          <p className="text-gray-600 dark:text-slate-400">Signing you in...</p>
        )}
      </div>
    </div>
  );
}

export default function BuyerVerifyPage({ params }: { params: { orgId: string } }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-slate-900" />}>
      <VerifyInner orgId={params.orgId} />
    </Suspense>
  );
}
