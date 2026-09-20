// Settings › Customer accounts (spec 031)
// Organizer controls for the buyer accounts that already exist (spec 007):
// whether the storefront shows sign-in links, how buyers sign in, and the
// public account URL. Phase 1: sign-in links toggle + read-only cards.
// Phase 2: the self-serve refund policy (cutoff before the event, fee).
// Phase 3: the sign-in method (email link, or a six-digit code).
'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import api, { type BuyerSignInMethod, type CustomerAccountSettings, type CustomerAccountSettingsInput, type SelfServeRefundFeeType } from '@/services/api';
import SettingsNav from '../SettingsNav';
import { UsersIcon } from '../icons';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const rowClass = 'flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0';
const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const fieldLabel = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const primaryBtn =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function CustomerAccountsSettingsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';

  const [settings, setSettings] = useState<CustomerAccountSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Refund policy drafts (saved with their own button, unlike the toggles)
  const [cutoff, setCutoff] = useState('');
  const [feeType, setFeeType] = useState<SelfServeRefundFeeType>('NONE');
  const [feeValue, setFeeValue] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const applySettings = useCallback((next: CustomerAccountSettings) => {
    setSettings(next);
    setCutoff(next.refundPolicy.cutoffHours == null ? '' : String(next.refundPolicy.cutoffHours));
    setFeeType(next.refundPolicy.feeType);
    setFeeValue(next.refundPolicy.feeValue == null ? '' : String(next.refundPolicy.feeValue));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      applySettings(await api.get<CustomerAccountSettings>('/admin/settings/customer-accounts'));
    } catch (err) {
      setSettings(null);
      setError(errorMessage(err, 'Could not load customer account settings'));
    }
  }, [applySettings]);

  // Wait for the org switcher before the first fetch; refetch on org change (same gate as Settings › Tax).
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  const patch = async (body: CustomerAccountSettingsInput) => {
    if (!settings) return;
    const previous = settings;
    // Optimistic update for the two toggles; the response replaces it.
    setSettings({
      ...settings,
      ...(body.buyerSignInLinks !== undefined ? { buyerSignInLinks: body.buyerSignInLinks } : {}),
      ...(body.buyerSignInMethod !== undefined ? { signInMethod: body.buyerSignInMethod } : {}),
      ...(body.selfServeRefundsEnabled !== undefined
        ? { refundPolicy: { ...settings.refundPolicy, enabled: body.selfServeRefundsEnabled } }
        : {}),
    });
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      applySettings(await api.patch<CustomerAccountSettings>('/admin/settings/customer-accounts', body));
      setSaved(true);
    } catch (err) {
      setSettings(previous);
      setError(errorMessage(err, 'Could not save customer account settings'));
    } finally {
      setSaving(false);
    }
  };

  const toggleRefunds = (next: boolean) => void patch({ selfServeRefundsEnabled: next });

  const cutoffNumber = cutoff.trim() === '' ? null : Number(cutoff);
  const feeNumber = feeValue.trim() === '' ? null : Number(feeValue);
  const cutoffInvalid = cutoffNumber !== null && (!Number.isInteger(cutoffNumber) || cutoffNumber < 0 || cutoffNumber > 8760);
  const feeInvalid =
    feeType !== 'NONE' &&
    (feeNumber === null || !Number.isFinite(feeNumber) || feeNumber <= 0 || (feeType === 'PERCENT' && feeNumber > 100));
  const policyDirty =
    !!settings &&
    (cutoffNumber !== settings.refundPolicy.cutoffHours ||
      feeType !== settings.refundPolicy.feeType ||
      (feeType !== 'NONE' && feeNumber !== settings.refundPolicy.feeValue));

  const savePolicy = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || cutoffInvalid || feeInvalid) return;
    setPolicySaving(true);
    setPolicyError(null);
    setSaved(false);
    try {
      applySettings(
        await api.patch<CustomerAccountSettings>('/admin/settings/customer-accounts', {
          selfServeRefundCutoffHours: cutoffNumber,
          selfServeRefundFeeType: feeType,
          selfServeRefundFeeValue: feeType === 'NONE' ? null : feeNumber,
        })
      );
      setSaved(true);
    } catch (err) {
      setPolicyError(errorMessage(err, 'Could not save the refund policy'));
    } finally {
      setPolicySaving(false);
    }
  };

  const copyUrl = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.accountUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the URL — select it and copy manually');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="customer-accounts-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="customer-accounts-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <UsersIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Customer accounts
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {saved && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              Saved
            </p>
          )}

          {!settings && !error ? (
            <div className="space-y-3" aria-busy="true">
              {[1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-slate-700" />
              ))}
            </div>
          ) : settings ? (
            <>
              {/* Sign-in links */}
              <div className={cardClass} data-testid="sign-in-links-card">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Sign-in links</h3>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                  <label htmlFor="sign-in-links" className="text-sm font-medium text-gray-900 dark:text-white">
                    Show sign-in links
                    <span className="mt-0.5 block text-sm font-normal text-gray-500 dark:text-slate-400">
                      Show a sign-in link in the header of your online store and at checkout. Buyers who sign in
                      see their orders and tickets and skip typing their details.
                    </span>
                    {!canEdit && (
                      <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">Only admins can change this.</span>
                    )}
                  </label>
                  <Toggle
                    id="sign-in-links"
                    checked={settings.buyerSignInLinks}
                    onChange={(next) => void patch({ buyerSignInLinks: next })}
                    disabled={!canEdit || saving}
                    label="Show sign-in links"
                  />
                </div>
              </div>

              {/* Customer accounts */}
              <div className={cardClass} data-testid="customer-accounts-card">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Customer accounts</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                  Buyers get an account when they tick the box at checkout. Accounts are passwordless and belong to
                  your organization only.
                </p>
                <div className="mt-3 divide-y divide-gray-200 dark:divide-slate-700">
                  <div className={rowClass}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Branding</p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        Checkout and the account page use your brand color, logo and theme.
                      </p>
                    </div>
                    <Link href="/admin/settings" className={secondaryBtn}>
                      Customize
                    </Link>
                  </div>
                  <div className={rowClass} data-testid="authentication-row">
                    <fieldset className="min-w-0 flex-1">
                      <legend className="text-sm font-medium text-gray-900 dark:text-white">Authentication</legend>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        No passwords. Buyers stay signed in for 30 days.
                      </p>
                      <div className="mt-3 space-y-2">
                        {(
                          [
                            ['LINK', 'Email link', 'The email has a sign-in button. Works for 15 minutes.'],
                            ['CODE', 'Email code', 'The email shows a 6-digit code to type on the sign-in page (10 minutes), plus the link. Best when buyers read email on a different device.'],
                          ] as [BuyerSignInMethod, string, string][]
                        ).map(([value, title, help]) => (
                          <label key={value} className="flex cursor-pointer items-start gap-3 text-sm">
                            <input
                              type="radio"
                              name="sign-in-method"
                              value={value}
                              checked={settings.signInMethod === value}
                              onChange={() => void patch({ buyerSignInMethod: value })}
                              disabled={!canEdit || saving}
                              className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                            />
                            <span>
                              <span className="font-medium text-gray-900 dark:text-white">{title}</span>
                              <span className="block text-gray-500 dark:text-slate-400">{help}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  <div className={rowClass} data-testid="self-serve-refunds-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <label htmlFor="self-serve-refunds" className="text-sm font-medium text-gray-900 dark:text-white">
                          Self-serve refunds
                          <span className="mt-0.5 block text-sm font-normal text-gray-500 dark:text-slate-400">
                            Let buyers refund tickets from their account. Only tiers marked refundable qualify; set a
                            cutoff and a fee below.
                          </span>
                        </label>
                        <Toggle
                          id="self-serve-refunds"
                          checked={settings.refundPolicy.enabled}
                          onChange={toggleRefunds}
                          disabled={!canEdit || saving}
                          label="Self-serve refunds"
                        />
                      </div>
                      {settings.refundPolicy.enabled && (
                        <form onSubmit={savePolicy} className="mt-4 space-y-4" data-testid="refund-policy-form">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div>
                              <label htmlFor="refund-cutoff" className={fieldLabel}>
                                Cutoff (hours before the event)
                              </label>
                              <input
                                id="refund-cutoff"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={8760}
                                step={1}
                                value={cutoff}
                                onChange={(e) => setCutoff(e.target.value)}
                                disabled={!canEdit}
                                placeholder="Until the event starts"
                                className={field}
                              />
                              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                                Blank: refunds close when the event starts. 48 = two days before.
                              </p>
                            </div>
                            <div>
                              <label htmlFor="refund-fee-type" className={fieldLabel}>
                                Fee
                              </label>
                              <select
                                id="refund-fee-type"
                                value={feeType}
                                onChange={(e) => setFeeType(e.target.value as SelfServeRefundFeeType)}
                                disabled={!canEdit}
                                className={field}
                              >
                                <option value="NONE">No fee</option>
                                <option value="FIXED">Fixed amount per ticket</option>
                                <option value="PERCENT">Percentage of the ticket price</option>
                              </select>
                            </div>
                            {feeType !== 'NONE' && (
                              <div>
                                <label htmlFor="refund-fee-value" className={fieldLabel}>
                                  {feeType === 'FIXED' ? 'Fee amount ($)' : 'Fee (%)'}
                                </label>
                                <input
                                  id="refund-fee-value"
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={feeType === 'PERCENT' ? 100 : undefined}
                                  step={0.01}
                                  value={feeValue}
                                  onChange={(e) => setFeeValue(e.target.value)}
                                  disabled={!canEdit}
                                  className={field}
                                />
                              </div>
                            )}
                          </div>
                          {(cutoffInvalid || feeInvalid) && (
                            <p className="text-xs text-red-600 dark:text-red-400">
                              {cutoffInvalid
                                ? 'The cutoff must be a whole number of hours from 0 to 8760.'
                                : feeType === 'PERCENT'
                                  ? 'Enter a percentage above 0 and up to 100.'
                                  : 'Enter a fee amount above 0.'}
                            </p>
                          )}
                          {policyError && (
                            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                              {policyError}
                            </p>
                          )}
                          {canEdit && (
                            <button
                              type="submit"
                              disabled={!policyDirty || cutoffInvalid || feeInvalid || policySaving}
                              className={primaryBtn}
                              data-testid="refund-policy-save"
                            >
                              {policySaving ? 'Saving…' : 'Save refund policy'}
                            </button>
                          )}
                        </form>
                      )}
                    </div>
                  </div>
                  <div className={rowClass} data-testid="account-url-row">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">URL</p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        Use this URL anywhere you&apos;d like buyers to access their account.
                        {settings.domain
                          ? ` It lives on your domain ${settings.domain.hostname}.`
                          : ' Connect a custom domain to host it on your own address.'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          readOnly
                          aria-label="Customer account URL"
                          value={settings.accountUrl}
                          onFocus={(event) => event.currentTarget.select()}
                          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-sm text-gray-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button type="button" onClick={copyUrl} className={secondaryBtn}>
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <Link href="/admin/settings/domains" className={secondaryBtn}>
                      Manage
                    </Link>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
