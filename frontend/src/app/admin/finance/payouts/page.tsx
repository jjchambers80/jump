// Finance › Payouts — /admin/finance/payouts
// What the organization's connected Stripe account holds and has paid out:
// available / pending balance, the payout schedule and the recent payout
// history, read live from Stripe by GET /admin/finance/payouts. Until a bank
// account is connected the page points to Settings › Payments › Payout bank
// account; it never starts onboarding itself.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Landmark } from 'lucide-react';
import { useOrg } from '@/components/OrgContext';
import { ExternalLinkIcon, WarningIcon } from '../../settings/icons';
import { useConnectActions } from '../../settings/payments/useConnectActions';
import { describeError, usePaymentsApi } from '../../settings/payments/usePaymentsApi';
import {
  CONNECT_DISABLED,
  CONNECT_PILL,
  PAYOUT_STATUS,
  describeSchedule,
  formatMoney,
  type ConnectState,
  type FinancePayoutsResponse,
  type PayoutRow,
} from '../../settings/payments/types';

const BANK_ACCOUNT_PATH = '/admin/settings/payments/payout-bank-account';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primaryLink =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

// Stripe payout arrival dates are calendar days (midnight UTC); render them as such.
function formatDay(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function StatusPill({ status }: { status: string }) {
  const meta = PAYOUT_STATUS[status] ?? { label: status.replace(/_/g, ' '), style: PAYOUT_STATUS.pending.style };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.style}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export default function FinancePayoutsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const paymentsApi = usePaymentsApi();
  const [data, setData] = useState<FinancePayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await paymentsApi.financePayouts());
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load payouts'));
    } finally {
      setLoading(false);
    }
  }, [paymentsApi]);

  // Wait for the org switcher before the first fetch; refetch on org change.
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  // "View in Stripe" opens the Express dashboard for the full history.
  const applyConnect = useCallback((next: ConnectState) => setData((prev) => (prev ? { ...prev, connect: next } : prev)), []);
  const showError = useCallback((message: string) => setError(message), []);
  const actions = useConnectActions(applyConnect, showError);

  const connect = data?.connect ?? CONNECT_DISABLED;
  const account = connect.account;
  const activity = data?.activity ?? null;
  const canEdit = data?.canEdit === true;
  const hasBank = Boolean(account?.bank);
  const pill = CONNECT_PILL[connect.status];
  const upcoming = activity?.payouts.filter((p) => p.status === 'pending' || p.status === 'in_transit') ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payouts</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Transfers of your ticket revenue to your bank account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <button type="button" className={secondaryBtn} disabled={loading} onClick={load} data-testid="finance-payouts-refresh">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {connect.enabled && hasBank && canEdit && account?.detailsSubmitted && (
            <button type="button" className={secondaryBtn} disabled={actions.busy !== null} onClick={actions.openDashboard} data-testid="finance-payouts-stripe">
              {actions.busy === 'login' ? 'Opening…' : 'View in Stripe'}
              <ExternalLinkIcon />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-8 space-y-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200 dark:bg-slate-700" />
          ))}
        </div>
      )}

      {data && !connect.enabled && (
        <div className={`${cardClass} mt-8`} data-testid="finance-payouts-disabled">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Payouts to your bank account are coming with Stripe Connect. Until then, the platform settles with you outside Jump.
          </p>
        </div>
      )}

      {data && connect.enabled && !hasBank && (
        <div className={`${cardClass} mt-8`} data-testid="finance-payouts-empty">
          <div className="flex flex-col items-center px-4 py-10 text-center sm:py-14">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700/60">
              <Landmark className="h-10 w-10 text-gray-400 dark:text-slate-400" strokeWidth={1.5} aria-hidden />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-gray-900 dark:text-white">No payout bank account yet</h2>
            <p className="mt-1 max-w-md text-sm text-gray-600 dark:text-slate-400">
              {connect.status === 'onboarding' || connect.status === 'restricted'
                ? 'Stripe setup is not finished. Complete it to start receiving payouts.'
                : 'Connect the bank account your ticket revenue should be deposited to. Sales continue on the platform account until then.'}
            </p>
            <Link href={BANK_ACCOUNT_PATH} className={`${primaryLink} mt-6`} data-testid="finance-payouts-connect">
              {connect.status === 'not_started' ? 'Connect bank account' : 'Finish setup'}
            </Link>
          </div>
        </div>
      )}

      {data && connect.enabled && hasBank && account && (
        <div className="mt-8 space-y-6">
          {activity?.error && (
            <p role="status" className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" data-testid="finance-payouts-stripe-error">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {activity.error}
            </p>
          )}
          {connect.status === 'restricted' && (
            <p role="status" className="flex items-start gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Stripe needs more information before payouts can continue.{' '}
                <Link href={BANK_ACCOUNT_PATH} className="font-semibold underline">
                  Update details
                </Link>
              </span>
            </p>
          )}
          {connect.status === 'active' && !account.payoutsEnabled && (
            <p role="status" className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" data-testid="finance-payouts-on-hold">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Payouts are on hold while Stripe reviews your bank account. Sales still go through and funds accumulate until then.
            </p>
          )}

          {/* Balance */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className={cardClass} data-testid="finance-balance-available">
              <p className="text-sm text-gray-600 dark:text-slate-400">Available for payout</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{activity?.balance ? formatMoney(activity.balance.available, activity.balance.currency) : '—'}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Goes out on your next scheduled payout.</p>
            </div>
            <div className={cardClass} data-testid="finance-balance-pending">
              <p className="text-sm text-gray-600 dark:text-slate-400">Pending</p>
              <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{activity?.balance ? formatMoney(activity.balance.pending, activity.balance.currency) : '—'}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                {account.payouts.delayDays != null
                  ? `Recent sales still settling (${account.payouts.delayDays} business day${account.payouts.delayDays === 1 ? '' : 's'}).`
                  : 'Recent sales still settling.'}
              </p>
            </div>
            <div className={cardClass} data-testid="finance-payout-schedule">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-gray-600 dark:text-slate-400">Payout schedule</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.style}`}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {pill.label}
                </span>
              </div>
              <p className="mt-1 text-base font-semibold text-gray-900 dark:text-white">{describeSchedule(account.payouts)}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                To {account.bank!.name ?? 'bank account'} •••• {account.bank!.last4} ·{' '}
                <Link href={BANK_ACCOUNT_PATH} className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                  Manage
                </Link>
              </p>
            </div>
          </div>

          {/* Payout history */}
          <div className={cardClass} data-testid="finance-payouts-history">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Payout history</h2>
              {upcoming.length > 0 && (
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {upcoming.length} on the way · {formatMoney(upcoming.reduce((sum, p) => sum + p.amount, 0), upcoming[0].currency)}
                </p>
              )}
            </div>
            {activity && activity.payouts.length === 0 && !activity.error && (
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-400" data-testid="finance-payouts-none">
                No payouts yet. The first one goes out once funds clear and Stripe finishes its initial review; your bank then shows it within 1–3 business days.
              </p>
            )}
            {activity && activity.payouts.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      <th scope="col" className="py-2 pr-4">
                        Arrives
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Status
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Bank
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Type
                      </th>
                      <th scope="col" className="py-2 text-right">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {activity.payouts.map((payout: PayoutRow) => (
                      <tr key={payout.id} data-testid="finance-payout-row">
                        <td className="whitespace-nowrap py-3 pr-4 text-gray-900 dark:text-white">{formatDay(payout.arrivalDate)}</td>
                        <td className="py-3 pr-4">
                          <StatusPill status={payout.status} />
                          {payout.failureMessage && <span className="mt-1 block text-xs text-red-700 dark:text-red-300">{payout.failureMessage}</span>}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-gray-600 dark:text-slate-400">
                          {payout.bank?.last4 ? `${payout.bank.name ?? 'Bank'} •••• ${payout.bank.last4}` : '—'}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-gray-600 dark:text-slate-400">{payout.automatic ? 'Scheduled' : 'Manual'}</td>
                        <td className="whitespace-nowrap py-3 text-right font-medium tabular-nums text-gray-900 dark:text-white">{formatMoney(payout.amount, payout.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Most recent payouts. The full history and per-payout breakdown are in your Stripe dashboard.</p>
          </div>
        </div>
      )}
    </div>
  );
}
