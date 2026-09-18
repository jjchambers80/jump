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
      className="min-h-screen flex flex-col items-center justify-center text-white px-4"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #0f1f1c 0%, #070d0c 60%, #050807 100%)' }}
      data-testid="signup-subscribe-return"
    >
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="mt-2 text-sm text-white/70">{error}</p>
          <button
            type="button"
            onClick={() => router.replace(`/signup/${orgId}/subscribe`)}
            className="mt-6 rounded-full bg-white/10 hover:bg-white/20 px-5 py-2 text-sm font-medium"
          >
            Back to subscription
          </button>
        </div>
      ) : (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          <p className="mt-4 text-sm text-white/70">Confirming your subscription…</p>
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
