'use client';

// /signup/[orgId]/subscribe/return?session_id=… — Stripe returns here after
// embedded Checkout. Confirm the session server-side (the webhook may lag),
// then continue to the next step.

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import signupService from '@/services/signupService';
import { signupPathFor } from '@/lib/onboarding';

function Return() {
  const router = useRouter();
  const params = useSearchParams();
  const { orgId } = useParams<{ orgId: string }>();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const sessionId = params.get('session_id');
    (async () => {
      try {
        if (!sessionId) throw new Error('Missing Checkout session');
        const { organization } = await signupService.confirmSubscribe(orgId, sessionId);
        router.replace(signupPathFor(organization));
      } catch (err: any) {
        setError(err?.message || 'Could not confirm your subscription');
      }
    })();
  }, [orgId, params, router]);

  return (
    <div
      className="min-h-screen signup-stage flex flex-col items-center justify-center text-gray-900 dark:text-white px-4"
      data-testid="signup-subscribe-return"
    >
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-white/70">{error}</p>
          <button
            type="button"
            onClick={() => router.replace(`/signup/${orgId}/subscribe`)}
            className="mt-6 rounded-full bg-gray-900/10 hover:bg-gray-900/20 dark:bg-white/10 dark:hover:bg-white/20 px-5 py-2 text-sm font-medium"
          >
            Back to subscription
          </button>
        </div>
      ) : (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white" />
          <p className="mt-4 text-sm text-gray-600 dark:text-white/70">Confirming your subscription…</p>
        </>
      )}
    </div>
  );
}

export default function SubscribeReturnPage() {
  return (
    <Suspense fallback={null}>
      <Return />
    </Suspense>
  );
}
