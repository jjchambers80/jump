'use client';

// "Set up payouts" banner (spec 010 phase 2, plan §5.7): shown on the admin
// dashboard while Stripe Connect is enabled on the platform and the
// organization is not yet receiving payouts. Dismissable for the session.
// Reads the same endpoint as Settings › Payments; any error hides the banner.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { ConnectState, PaymentSettingsResponse } from '../settings/payments/types';

const DISMISS_KEY = 'jump.payoutsBanner.dismissed';

const COPY: Record<ConnectState['status'], { title: string; body: string; cta: string } | null> = {
  not_started: { title: 'Set up payouts', body: 'Connect a bank account to receive ticket revenue directly.', cta: 'Set up payouts' },
  onboarding: { title: 'Finish payout setup', body: 'Stripe setup was started but not completed.', cta: 'Continue setup' },
  restricted: { title: 'Payouts need attention', body: 'Stripe needs more information before payouts can continue.', cta: 'Update details' },
  disconnected: { title: 'Payouts disconnected', body: 'Reconnect your Stripe account to receive payouts.', cta: 'Reconnect' },
  active: null,
};

export default function PayoutsBanner() {
  const { selectedOrgId, loading } = useOrg();
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (loading && !selectedOrgId) return;
    let cancelled = false;
    const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';
    api
      .get<PaymentSettingsResponse>(`/admin/settings/payments${qs}`)
      .then((res) => {
        if (!cancelled) setConnect(res.connect ?? null);
      })
      .catch(() => {
        if (!cancelled) setConnect(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, selectedOrgId]);

  if (dismissed || !connect?.enabled) return null;
  const copy = COPY[connect.status];
  if (!copy) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode: banner returns next load */
    }
  };

  return (
    <div
      role="status"
      data-testid="payouts-banner"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-800 dark:bg-indigo-900/20"
    >
      <div className="min-w-0">
        <p className="font-semibold text-indigo-900 dark:text-indigo-200">{copy.title}</p>
        <p className="text-indigo-800 dark:text-indigo-300">{copy.body}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/admin/settings/payments/payout-bank-account"
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {copy.cta}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss payouts reminder"
          className="rounded-md px-2 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
        >
          Later
        </button>
      </div>
    </div>
  );
}
