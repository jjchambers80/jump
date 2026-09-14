// Settings › Payments (spec 010 phase 1)
// Shopify-style payment configuration for an organization on the platform's
// Stripe account: whether payments are live, which methods checkout offers,
// what buyers see on their card statement, the rates buyers pay, and fraud
// screening. Payouts arrive with Stripe Connect (phase 2).
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../SettingsNav';
import { CardIcon, ChevronRightIcon, ExternalLinkIcon, ReceiptIcon, ShieldIcon, WarningIcon } from '../icons';
import { formatPhone } from '../formShared';
import BrandBadge from './BrandBadge';
import StatementDescriptorDialog from './StatementDescriptorDialog';
import { describeError, usePaymentsApi } from './usePaymentsApi';
import { CARD_BRAND_LABEL, CHARGES_LABEL, CHARGES_STYLE, formatPercent, type PaymentSettings, type PaymentSettingsResponse } from './types';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const rowClass =
  'flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40';
const MAX_BADGES = 4;

export default function PaymentsSettingsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const paymentsApi = usePaymentsApi();
  const [data, setData] = useState<PaymentSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [editingStatement, setEditingStatement] = useState(false);
  const statementBtnRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await paymentsApi.get());
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load payment settings'));
    }
  }, [paymentsApi]);

  // Wait for the org switcher before the first fetch; refetch on org change
  // (same gate as Settings › Tax).
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  const provider = data?.provider;
  const settings = data?.settings;

  const handleStatementSaved = (next: PaymentSettings) => {
    setData((prev) => (prev ? { ...prev, settings: next } : prev));
    setEditingStatement(false);
    setSavedMessage(next.descriptor.full ? `Buyers will see "${next.descriptor.full}" on their statement.` : 'Statement name saved.');
  };

  const enabledBadges = settings
    ? [
        ...settings.methods.cards,
        ...settings.methods.wallets,
        ...settings.methods.optional.filter((m) => m.enabled).map((m) => m.type),
      ]
    : [];
  const optionalEnabledCount = settings?.methods.optional.filter((m) => m.enabled).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="payments-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="payments-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <CardIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Payments
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {savedMessage && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {savedMessage}
            </p>
          )}

          {/* Provider */}
          <div className={cardClass} data-testid="payments-provider-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Stripe</h3>
              {provider?.manageUrl && (
                <a href={provider.manageUrl} target="_blank" rel="noreferrer" className={secondaryBtn}>
                  Manage
                  <ExternalLinkIcon />
                </a>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
              {provider ? (
                <span
                  data-testid="payments-charges-pill"
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHARGES_STYLE[provider.charges]}`}
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {CHARGES_LABEL[provider.charges]}
                </span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-slate-400">Checking…</span>
              )}
              {provider?.mode === 'test' && (
                <span
                  data-testid="payments-test-mode"
                  className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  Test mode
                </span>
              )}
            </div>
            {provider?.mode === 'test' && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                Stripe is in test mode. Use test cards; no real money moves.
              </p>
            )}
            {provider?.charges === 'unavailable' && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                Stripe could not be reached or charges are not enabled. Checkout may fail until this clears.
              </p>
            )}

            <div className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
              <Link href="/admin/settings/payments/methods" className={rowClass} data-testid="payments-methods-row">
                <CardIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-slate-400" />
                <span className="min-w-0 flex-1 font-medium text-gray-900 dark:text-white">Payment methods</span>
                <span className="flex items-center gap-1" aria-label={`${enabledBadges.length} payment methods enabled`}>
                  {enabledBadges.slice(0, MAX_BADGES).map((b) => (
                    <BrandBadge key={b} brand={b} label={CARD_BRAND_LABEL[b] ?? b} />
                  ))}
                  {enabledBadges.length > MAX_BADGES && (
                    <span className="inline-flex h-6 items-center rounded bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                      +{enabledBadges.length - MAX_BADGES}
                    </span>
                  )}
                </span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
              </Link>
            </div>
            {settings && optionalEnabledCount === 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Cards, Apple Pay and Google Pay are always on. Add more ways to pay on the Payment methods page.</p>
            )}
          </div>

          {/* Customer billing statement */}
          <div className={cardClass} data-testid="payments-statement-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Customer billing statement</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">How your organization appears on a buyer&apos;s card statement.</p>
              </div>
              <button
                ref={statementBtnRef}
                type="button"
                className={secondaryBtn}
                disabled={!settings}
                onClick={() => {
                  setSavedMessage('');
                  setEditingStatement(true);
                }}
              >
                {data?.canEdit ? 'Edit' : 'View'}
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
              {settings ? (
                <>
                  <p data-testid="payments-descriptor" className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                    {settings.descriptor.full ?? 'Not available'}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    {settings.descriptor.full
                      ? settings.descriptor.derived
                        ? 'Using your trade name. Choose a shorter name buyers will recognise.'
                        : 'Name on customer statement.'
                      : 'The platform Stripe account has no statement descriptor prefix yet.'}
                  </p>
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    Support phone{' '}
                    <span className="text-gray-900 dark:text-white">
                      {settings.organization.phoneNumber
                        ? `${settings.organization.phoneCountryCode ?? '+1'} ${formatPhone(settings.organization.phoneNumber)}`
                        : 'not set'}
                    </span>{' '}
                    <Link href="/admin/settings" className="font-medium text-indigo-600 underline dark:text-indigo-300">
                      General ›
                    </Link>
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p>
              )}
            </div>
          </div>

          {/* Rates */}
          <div className={cardClass} data-testid="payments-rates-card">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
              <ReceiptIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
              Rates
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Fees are added on top of the ticket price and paid by the buyer at checkout.</p>
            {settings && (
              <dl className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 text-sm dark:divide-slate-700 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-gray-700 dark:text-slate-300">Service fee</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{formatPercent(settings.rates.platformFeePercent)} of ticket price</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-gray-700 dark:text-slate-300">Processing fee</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">
                    {formatPercent(settings.rates.processingFeePercent)} + ${settings.rates.processingFeeFixed.toFixed(2)} per order
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-gray-700 dark:text-slate-300">Sales tax</dt>
                  <dd>
                    <Link href="/admin/settings/tax" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                      Per Settings › Tax
                    </Link>
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Fraud prevention */}
          <div className={cardClass} data-testid="payments-fraud-card">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Fraud prevention</h3>
            <div className="mt-3 rounded-lg border border-gray-200 dark:border-slate-700">
              {provider?.radarUrl ? (
                <a href={provider.radarUrl} target="_blank" rel="noreferrer" className={rowClass}>
                  <FraudRow />
                  <ExternalLinkIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
                </a>
              ) : (
                <div className={`${rowClass} hover:bg-transparent dark:hover:bg-transparent`}>
                  <FraudRow />
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-gray-500 dark:text-slate-400">
            Payouts to your bank account are coming with Stripe Connect. Until then, the platform settles with you outside Jump.
          </p>
        </section>
      </div>

      {editingStatement && settings && (
        <StatementDescriptorDialog
          settings={settings}
          canEdit={data?.canEdit === true}
          returnFocusRef={statementBtnRef}
          onClose={() => setEditingStatement(false)}
          onSaved={handleStatementSaved}
        />
      )}
    </div>
  );
}

function FraudRow() {
  return (
    <>
      <ShieldIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-gray-900 dark:text-white">Stripe Radar screens every card payment</span>
        <span className="block text-gray-600 dark:text-slate-400">Machine-learning fraud checks and CVC verification run on every charge.</span>
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        Active
      </span>
    </>
  );
}
