// Settings › Payments › Payouts (spec 010 phase 2)
// The organization's Stripe Connect (Express) account: onboarding state, bank
// account snapshot, payout schedule and statement name. Bank details and the
// payout history live in Stripe's Express dashboard — Jump stores none of it.
// Stripe returns here with ?onboarding=complete (pull the account state) or
// ?onboarding=refresh (the Account Link expired; mint a new one).
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../../SettingsNav';
import { BankIcon, ChevronRightIcon, ExternalLinkIcon, WarningIcon } from '../../icons';
import PayoutScheduleDialog from '../PayoutScheduleDialog';
import { useConnectActions } from '../useConnectActions';
import { describeError, usePaymentsApi } from '../usePaymentsApi';
import { CONNECT_ACTION, CONNECT_DISABLED, CONNECT_PILL, describeRequirement, describeSchedule, type ConnectState, type PaymentSettingsResponse } from '../types';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const rowClass =
  'flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40';

// Stripe payout arrival dates are calendar days (midnight UTC); render them as such.
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function PayoutsContent() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboardingReturn = searchParams.get('onboarding');
  const paymentsApi = usePaymentsApi();
  const [data, setData] = useState<PaymentSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const scheduleBtnRef = useRef<HTMLButtonElement>(null);

  const applyConnect = useCallback((next: ConnectState) => setData((prev) => (prev ? { ...prev, connect: next } : prev)), []);
  const showError = useCallback((message: string) => setError(message), []);
  const actions = useConnectActions(applyConnect, showError);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await paymentsApi.get();
      setData(next);
      return next;
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load payout settings'));
      return null;
    }
  }, [paymentsApi]);

  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  // Returning from Stripe: `complete` → pull state now and report what is left;
  // `refresh` → the link expired, send them straight back into onboarding.
  const handledReturn = useRef(false);
  useEffect(() => {
    if (!data || !onboardingReturn || handledReturn.current) return;
    handledReturn.current = true;
    const connect = data.connect ?? CONNECT_DISABLED;
    if (!connect.enabled || !data.canEdit) return;
    const clearQuery = () => router.replace('/admin/settings/payments/payouts');
    if (onboardingReturn === 'refresh') {
      actions.onboard();
      return;
    }
    if (onboardingReturn === 'complete') {
      actions.sync().then((next) => {
        clearQuery();
        if (!next) return;
        if (next.status === 'active') setNotice({ tone: 'ok', text: 'Stripe setup complete. Payouts go to the bank account below.' });
        else if (next.account?.currentlyDue.length) {
          setNotice({ tone: 'warn', text: `Almost there — Stripe still needs: ${[...new Set(next.account.currentlyDue.map(describeRequirement))].join(', ')}.` });
        } else setNotice({ tone: 'warn', text: 'Stripe is still reviewing your details. Check back shortly or press Refresh.' });
      });
      return;
    }
    clearQuery();
  }, [data, onboardingReturn, actions, router]);

  const connect = data?.connect ?? CONNECT_DISABLED;
  const account = connect.account;
  const canEdit = data?.canEdit === true;
  const action = CONNECT_ACTION[connect.status];
  const pill = CONNECT_PILL[connect.status];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="payouts-heading" className="min-w-0 flex-1 space-y-6">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400">
            <Link href="/admin/settings/payments" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
              Payments
            </Link>
            <ChevronRightIcon className="h-3.5 w-3.5" />
            <span aria-current="page">Payouts</span>
          </nav>
          <h2 id="payouts-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <BankIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Payouts
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {notice && (
            <p
              role="status"
              data-testid="payouts-notice"
              className={
                notice.tone === 'ok'
                  ? 'rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
                  : 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
              }
            >
              {notice.text}
            </p>
          )}

          {data && !connect.enabled && (
            <div className={cardClass} data-testid="payouts-disabled">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Payouts to your bank account are coming with Stripe Connect. Until then, the platform settles with you outside Jump.
              </p>
            </div>
          )}

          {data && connect.enabled && (
            <>
              {/* Status */}
              <div className={cardClass} data-testid="payouts-status-card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">Stripe account</h3>
                    <span data-testid="payouts-status-pill" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.style}`}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${connect.status === 'not_started' ? 'border border-current' : 'bg-current'}`} />
                      {pill.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {account && canEdit && (
                      <button type="button" className={secondaryBtn} disabled={actions.busy !== null} onClick={() => actions.sync()} data-testid="payouts-sync">
                        {actions.busy === 'sync' ? 'Refreshing…' : 'Refresh'}
                      </button>
                    )}
                    {connect.status === 'active' && canEdit && (
                      <button type="button" className={secondaryBtn} disabled={actions.busy !== null} onClick={actions.openDashboard} data-testid="payouts-view">
                        {actions.busy === 'login' ? 'Opening…' : 'View payouts'}
                        <ExternalLinkIcon />
                      </button>
                    )}
                    {action && canEdit && (
                      <button type="button" className={primaryBtn} disabled={actions.busy !== null} onClick={actions.onboard} data-testid="payouts-action">
                        {actions.busy === 'onboard' ? 'Redirecting…' : action}
                      </button>
                    )}
                  </div>
                </div>

                {connect.status === 'not_started' && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">
                    Connect a bank account so ticket revenue is paid out to you directly. Stripe collects your business and bank details on a secure page; Jump never
                    stores them. Until setup is complete, sales continue on the platform account.
                  </p>
                )}
                {connect.status === 'onboarding' && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">Setup was started but not finished. Continue where you left off.</p>
                )}
                {connect.status === 'restricted' && account && (
                  <div className="mt-3 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300" data-testid="payouts-restricted">
                    <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Stripe needs more information before payouts can continue.
                      {account.currentlyDue.length > 0 && <> Outstanding: {[...new Set(account.currentlyDue.map(describeRequirement))].join(', ')}.</>}
                      {account.disabledReason && <> Reason: {account.disabledReason.replace(/[._]/g, ' ')}.</>}
                    </span>
                  </div>
                )}
                {connect.status === 'disconnected' && (
                  <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">This Stripe account no longer allows Jump to send payouts. Reconnect to start a new setup.</p>
                )}
                {connect.status === 'active' && account && !account.payoutsEnabled && (
                  <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300" data-testid="payouts-on-hold">
                    <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    Payouts are on hold while Stripe reviews your bank account. Sales still go through and funds accumulate until then.
                  </p>
                )}
                {account?.payouts.lastPayoutFailure && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" data-testid="payouts-failure">
                    <span className="flex items-start gap-1.5">
                      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      Last payout failed: {account.payouts.lastPayoutFailure}
                    </span>
                    {canEdit && (
                      <button type="button" className={secondaryBtn} disabled={actions.busy !== null} onClick={actions.openDashboard}>
                        Fix in Stripe
                        <ExternalLinkIcon />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Bank account */}
              {account && (
                <div className={cardClass} data-testid="payouts-bank-card">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Payout bank account</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    {account.payouts.lastPayoutAt ? `Latest payout on ${formatDate(account.payouts.lastPayoutAt)}.` : 'No payouts yet.'}
                  </p>
                  <div className="mt-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
                    {account.bank ? (
                      <>
                        <p className="text-sm font-medium text-gray-900 dark:text-white" data-testid="payouts-bank">
                          {account.bank.name ?? 'Bank account'} •••• {account.bank.last4}
                        </p>
                        <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-400">{(account.bank.currency ?? 'usd').toUpperCase()}</p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-600 dark:text-slate-400">No bank account on file yet.</p>
                    )}
                  </div>
                  {connect.status === 'active' && canEdit && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Change the bank account from View payouts — it opens your Stripe dashboard.</p>
                  )}
                </div>
              )}

              {/* Payout settings */}
              {account && (
                <div className={cardClass} data-testid="payouts-settings-card">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Payout settings</h3>
                  <div className="mt-3 rounded-lg border border-gray-200 dark:border-slate-700">
                    <button
                      ref={scheduleBtnRef}
                      type="button"
                      className={rowClass}
                      disabled={!canEdit || !account.detailsSubmitted}
                      onClick={() => {
                        setNotice(null);
                        setEditingSchedule(true);
                      }}
                      data-testid="payouts-schedule-row"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-gray-900 dark:text-white">Payout schedule</span>
                        <span className="block text-gray-600 dark:text-slate-400">
                          {describeSchedule(account.payouts)}
                          {account.payouts.statementDescriptor ? ` · ${account.payouts.statementDescriptor}` : ''}
                        </span>
                      </span>
                      {canEdit && account.detailsSubmitted && <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                    {account.payouts.delayDays != null
                      ? `Funds are available ${account.payouts.delayDays} business day${account.payouts.delayDays === 1 ? '' : 's'} after a transaction.`
                      : 'Stripe holds funds for a short period after each transaction.'}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {editingSchedule && account && (
        <PayoutScheduleDialog
          account={account}
          returnFocusRef={scheduleBtnRef}
          onClose={() => setEditingSchedule(false)}
          onSaved={(next) => {
            applyConnect(next);
            setEditingSchedule(false);
            setNotice({ tone: 'ok', text: 'Payout settings saved.' });
          }}
        />
      )}
    </div>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={null}>
      <PayoutsContent />
    </Suspense>
  );
}
