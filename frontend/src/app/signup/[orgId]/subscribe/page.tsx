'use client';

// /signup/[orgId]/subscribe — the subscribe step (spec 022 phase 2).
// Reference: docs/research/shopify-onboarding-subscribe.png. Left: the trial
// ledger; right: Stripe embedded Checkout in subscription mode. Skip records
// the decision and moves on. When billing is off the backend never resumes
// here and the subscribe call answers 409, so the page moves to the survey.

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import signupService from '@/services/signupService';
import EmbeddedCheckout from '@/components/billing/EmbeddedCheckout';
import { formatDate, formatOfferPrice, trialEndDate, type BillingOffer } from '@/lib/billing';
import { signupPathFor } from '@/lib/onboarding';

export default function SubscribeStep() {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [offer, setOffer] = useState<BillingOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const org = await signupService.get(orgId);
        if (cancelled) return;
        if (org.step !== 'subscribe') {
          router.replace(signupPathFor(org));
          return;
        }
        const start = await signupService.subscribe(orgId);
        if (cancelled) return;
        setClientSecret(start.clientSecret);
        setOffer(start.offer);
      } catch (err: any) {
        if (cancelled) return;
        if (err?.status === 404) {
          router.replace('/signup');
          return;
        }
        if (err?.status === 409) {
          router.replace(`/signup/${orgId}/survey`);
          return;
        }
        setError(err?.message || 'Could not load the subscription offer');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, router]);

  const handleSkip = async () => {
    try {
      setBusy(true);
      setError(null);
      const org = await signupService.skipSubscribe(orgId);
      router.replace(signupPathFor(org));
    } catch (err: any) {
      setError(err?.message || 'Could not skip');
      setBusy(false);
    }
  };

  const trialDays = offer?.trialDays ?? 0;
  const price = formatOfferPrice(offer);
  const renews = trialDays > 0 ? formatDate(trialEndDate(trialDays).toISOString()) : 'Today';

  return (
    <div
      className="min-h-screen signup-stage text-gray-900 dark:text-white px-4 py-10 sm:py-16"
      data-testid="signup-subscribe"
    >
      <button
        type="button"
        onClick={handleSkip}
        disabled={busy}
        className="fixed top-4 right-4 rounded-full bg-gray-900/10 hover:bg-gray-900/20 dark:bg-white/10 dark:hover:bg-white/20 px-4 py-2 text-sm font-medium transition disabled:opacity-50"
      >
        Skip
      </button>

      <div className="max-w-4xl mx-auto mt-6 sm:mt-10 rounded-2xl bg-gray-100 dark:bg-[#0d1a17] shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_1.1fr]">
        {/* Ledger */}
        <div className="p-7 sm:p-9 flex flex-col">
          <h1 className="text-3xl font-light leading-tight">
            {trialDays > 0 ? (
              <>
                Get {trialDays} days
                <br />
                to explore
              </>
            ) : (
              'Start your Jump plan'
            )}
          </h1>
          <dl className="mt-8 space-y-4 text-sm">
            {trialDays > 0 && (
              <div className="flex justify-between border-b border-gray-900/10 dark:border-white/10 pb-3">
                <dt className="text-gray-600 dark:text-white/70">Today</dt>
                <dd>{trialDays} days free</dd>
              </div>
            )}
            <div className="flex justify-between border-b border-gray-900/10 dark:border-white/10 pb-3">
              <dt className="text-gray-600 dark:text-white/70">{renews}</dt>
              <dd>{price ? `${price} + tax` : '—'}</dd>
            </div>
            <div className="flex justify-between border-b border-gray-900/10 dark:border-white/10 pb-3">
              <dt className="text-gray-600 dark:text-white/70">Always</dt>
              <dd>Cancel anytime</dd>
            </div>
          </dl>
          <p className="mt-auto pt-8 text-xs text-gray-500 dark:text-white/50">
            Your card is only charged when the trial ends. Ticket revenue is never touched: it goes to your own Stripe account.
          </p>
        </div>

        {/* Stripe embedded Checkout */}
        <div className="bg-white text-gray-900 p-4 sm:p-6 min-h-[360px]">
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          ) : clientSecret ? (
            <EmbeddedCheckout clientSecret={clientSecret} />
          ) : (
            <div className="h-full flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
