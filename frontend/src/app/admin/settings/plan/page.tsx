'use client';

// Settings › Plan (spec 022 phase 2): the organization's Jump plan — FREE
// (platform fee only) or STARTER (subscription on Jump's Stripe account).
// Start the trial inline (embedded Checkout), manage through the Stripe
// customer portal. Hidden from the nav until BILLING_ENABLED; the page itself
// still renders the FREE state so a bookmark never breaks.

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../SettingsNav';
import { CardIcon, ExternalLinkIcon } from '../icons';
import { describeError } from '../payments/usePaymentsApi';
import { usePlanApi } from './usePlanApi';
import EmbeddedCheckout from '@/components/billing/EmbeddedCheckout';
import { SUBSCRIPTION_LABEL, formatDate, formatOfferPrice, type PlanStatus } from '@/lib/billing';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

const STATUS_STYLE: Record<string, string> = {
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  past_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  unpaid: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  canceled: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

function PlanContent() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const planApi = usePlanApi();
  const params = useSearchParams();
  const [data, setData] = useState<PlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'confirm' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await planApi.get());
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load your plan'));
    }
  }, [planApi]);

  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    setClientSecret(null);
    load();
  }, [orgLoading, selectedOrgId, load]);

  // Back from embedded Checkout: confirm the session, then show the result
  const confirmed = useRef(false);
  useEffect(() => {
    const sessionId = params.get('session_id');
    if (!sessionId || confirmed.current || (orgLoading && !selectedOrgId)) return;
    confirmed.current = true;
    (async () => {
      try {
        setBusy('confirm');
        const result = await planApi.confirm(sessionId);
        setData(result);
        setNotice(result.subscribed ? 'Your trial has started.' : 'Checkout was not completed.');
        window.history.replaceState(window.history.state, '', window.location.pathname);
      } catch (err) {
        setError(describeError(err, 'Could not confirm your subscription'));
      } finally {
        setBusy(null);
      }
    })();
  }, [params, planApi, orgLoading, selectedOrgId]);

  const startTrial = async () => {
    try {
      setBusy('checkout');
      setError(null);
      const start = await planApi.checkout();
      setClientSecret(start.clientSecret);
    } catch (err) {
      setError(describeError(err, 'Could not start checkout'));
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    try {
      setBusy('portal');
      setError(null);
      const { url } = await planApi.portal();
      window.location.assign(url);
    } catch (err) {
      setError(describeError(err, 'Could not open billing'));
      setBusy(null);
    }
  };

  const status = data?.subscriptionStatus;
  const offer = data?.offer ?? null;
  const price = formatOfferPrice(offer);
  const onPaidPlan = data?.plan === 'STARTER';
  const canEdit = data?.canEdit === true;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="plan-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="plan-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <CardIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Plan
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {notice && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {notice}
            </p>
          )}

          {data && (
            <div className={cardClass} data-testid="plan-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {onPaidPlan ? offer?.productName || 'Jump Starter' : 'Free'}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    {onPaidPlan
                      ? `${price || 'Subscription'}${price ? ' + tax' : ''}. Manage your card, invoices and cancellation through Stripe.`
                      : 'No subscription. Jump keeps its platform fee on each ticket and application charge; everything else is included.'}
                  </p>
                </div>
                {status && (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.canceled}`} data-testid="plan-status">
                    {SUBSCRIPTION_LABEL[status] ?? status}
                  </span>
                )}
              </div>

              {onPaidPlan && (
                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  {status === 'trialing' && data.trialEndsAt && (
                    <div>
                      <dt className="text-gray-500 dark:text-slate-400">Trial ends</dt>
                      <dd className="font-medium text-gray-900 dark:text-white">{formatDate(data.trialEndsAt)}</dd>
                    </div>
                  )}
                  {data.currentPeriodEndsAt && (
                    <div>
                      <dt className="text-gray-500 dark:text-slate-400">{status === 'canceled' ? 'Access until' : 'Next renewal'}</dt>
                      <dd className="font-medium text-gray-900 dark:text-white">{formatDate(data.currentPeriodEndsAt)}</dd>
                    </div>
                  )}
                </dl>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                {data.enabled && !onPaidPlan && canEdit && !clientSecret && (
                  <button type="button" className={primaryBtn} onClick={startTrial} disabled={busy !== null} data-testid="plan-start-trial">
                    {busy === 'checkout' ? 'Loading…' : offer && offer.trialDays > 0 ? `Start ${offer.trialDays}-day free trial` : 'Subscribe'}
                  </button>
                )}
                {data.enabled && data.canManage && canEdit && (
                  <button type="button" className={secondaryBtn} onClick={openPortal} disabled={busy !== null} data-testid="plan-manage">
                    {busy === 'portal' ? 'Opening…' : 'Manage billing'}
                    <ExternalLinkIcon />
                  </button>
                )}
                {!data.enabled && (
                  <p className="text-xs text-gray-500 dark:text-slate-400">Paid plans are not available yet.</p>
                )}
              </div>
            </div>
          )}

          {clientSecret && (
            <div className={cardClass} data-testid="plan-checkout">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {offer && offer.trialDays > 0 ? `${offer.trialDays} days free, then ${price || 'the plan price'} + tax` : price}
                </h3>
                <button type="button" className="text-sm text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200" onClick={() => setClientSecret(null)}>
                  Cancel
                </button>
              </div>
              <EmbeddedCheckout clientSecret={clientSecret} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function PlanSettingsPage() {
  return (
    <Suspense fallback={null}>
      <PlanContent />
    </Suspense>
  );
}
