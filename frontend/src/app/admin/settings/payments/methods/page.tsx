// Settings › Payments › Payment methods (spec 010 phase 1)
// Cards and wallets are always on with Stripe Checkout. Optional methods are
// toggled per row when the platform account has the capability; each toggle
// saves on its own and rolls back on error.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../../SettingsNav';
import { CardIcon, ChevronRightIcon, WarningIcon } from '../../icons';
import BrandBadge from '../BrandBadge';
import { describeError, usePaymentsApi } from '../usePaymentsApi';
import { CARD_BRAND_LABEL, type PaymentMethodRow, type PaymentSettingsResponse } from '../types';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const groupHeading = 'bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-900/40 dark:text-slate-400';
const rowClass = 'flex items-center gap-3 px-4 py-3 text-sm';
const onPill = 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/30 dark:text-green-300';
const offPill = 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-300';

export default function PaymentMethodsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const paymentsApi = usePaymentsApi();
  const [data, setData] = useState<PaymentSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [savingType, setSavingType] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await paymentsApi.get());
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load payment methods'));
    }
  }, [paymentsApi]);

  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  const settings = data?.settings;
  const canEdit = data?.canEdit === true;

  const toggle = async (row: PaymentMethodRow, next: boolean) => {
    if (!settings || !canEdit || savingType) return;
    const before = settings.enabledPaymentMethods;
    const after = next ? [...new Set([...before, row.type])] : before.filter((t) => t !== row.type);
    setSavingType(row.type);
    setError(null);
    setSavedMessage('');
    // Optimistic: flip the row now, restore on failure.
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              enabledPaymentMethods: after,
              methods: { ...prev.settings.methods, optional: prev.settings.methods.optional.map((m) => (m.type === row.type ? { ...m, enabled: next } : m)) },
            },
          }
        : prev
    );
    try {
      const saved = await paymentsApi.update({ enabledPaymentMethods: after });
      setData((prev) => (prev ? { ...prev, settings: saved } : prev));
      setSavedMessage(next ? `${row.label} is now offered at checkout.` : `${row.label} removed from checkout.`);
    } catch (err) {
      setData((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                enabledPaymentMethods: before,
                methods: { ...prev.settings.methods, optional: prev.settings.methods.optional.map((m) => (m.type === row.type ? { ...m, enabled: !next } : m)) },
              },
            }
          : prev
      );
      setError(describeError(err, `Could not update ${row.label}`));
    } finally {
      setSavingType(null);
    }
  };

  const wallets = settings?.methods.optional.filter((m) => m.group === 'wallets') ?? [];
  const more = settings?.methods.optional.filter((m) => m.group === 'more') ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="methods-heading" className="min-w-0 flex-1 space-y-6">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400">
            <Link href="/admin/settings/payments" className="hover:underline">
              Payments
            </Link>
            <ChevronRightIcon className="h-3.5 w-3.5" />
            <span aria-current="page" className="text-gray-900 dark:text-white">
              Payment methods
            </span>
          </nav>
          <h2 id="methods-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <CardIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Payment methods
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

          <div className={cardClass} data-testid="payment-methods-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Online</h3>
              <Link href="/admin/settings/payments#payments-rates-card" className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
                View rates
              </Link>
            </div>

            {!settings ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">{error ? '' : 'Loading…'}</p>
            ) : (
              <div className="mt-3 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
                <div className={groupHeading}>Cards</div>
                {settings.methods.cards.map((brand) => (
                  <div key={brand} className={rowClass} data-testid={`method-${brand}`}>
                    <BrandBadge brand={brand} label={CARD_BRAND_LABEL[brand] ?? brand} />
                    <span className="flex-1 font-medium text-gray-900 dark:text-white">{CARD_BRAND_LABEL[brand] ?? brand}</span>
                    <span className={onPill}>On</span>
                  </div>
                ))}

                <div className={groupHeading}>Wallets</div>
                {settings.methods.wallets.map((brand) => (
                  <div key={brand} className={rowClass} data-testid={`method-${brand}`}>
                    <BrandBadge brand={brand} label={CARD_BRAND_LABEL[brand] ?? brand} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-900 dark:text-white">{CARD_BRAND_LABEL[brand] ?? brand}</span>
                      <span className="block text-gray-600 dark:text-slate-400">Included with cards on Stripe Checkout.</span>
                    </span>
                    <span className={onPill}>On</span>
                  </div>
                ))}
                {wallets.map((m) => (
                  <MethodToggleRow key={m.type} row={m} canEdit={canEdit} saving={savingType === m.type} onToggle={toggle} />
                ))}

                <div className={groupHeading}>More ways to pay</div>
                {more.map((m) => (
                  <MethodToggleRow key={m.type} row={m} canEdit={canEdit} saving={savingType === m.type} onToggle={toggle} />
                ))}
              </div>
            )}

            <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
              Only methods enabled on the platform&apos;s Stripe account can be offered. Cards and wallets are always available.
            </p>
            {settings && !canEdit && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-600 dark:text-slate-400">
                <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Only organization admins can change payment methods.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MethodToggleRow({
  row,
  canEdit,
  saving,
  onToggle,
}: {
  row: PaymentMethodRow;
  canEdit: boolean;
  saving: boolean;
  onToggle: (row: PaymentMethodRow, next: boolean) => void;
}) {
  const id = `method-toggle-${row.type}`;
  return (
    <div className={rowClass} data-testid={`method-${row.type}`}>
      <BrandBadge brand={row.type} label={row.label} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-medium text-gray-900 dark:text-white">{row.label}</span>
        <span className="block text-gray-600 dark:text-slate-400">{row.help}</span>
      </label>
      {row.available ? (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={row.enabled}
          aria-label={`${row.label} at checkout`}
          disabled={!canEdit || saving}
          onClick={() => onToggle(row, !row.enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
            row.enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
          }`}
        >
          <span aria-hidden="true" className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${row.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      ) : (
        <span className={offPill} title="Not enabled on the platform's Stripe account">
          Unavailable
        </span>
      )}
    </div>
  );
}
