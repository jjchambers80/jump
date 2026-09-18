'use client';

// Subscription attention banner (spec 022 phase 2): shown on the dashboard
// while the organization's Jump subscription is past due or unpaid. Reads
// Settings › Plan; any error hides the banner.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { PlanStatus } from '@/lib/billing';

const COPY: Record<string, { title: string; body: string }> = {
  past_due: { title: 'Subscription payment failed', body: 'Update your card so your Jump plan stays active.' },
  unpaid: { title: 'Subscription unpaid', body: 'Your Jump plan is paused until the outstanding invoice is paid.' },
};

export default function PlanBanner() {
  const { selectedOrgId, loading } = useOrg();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (loading && !selectedOrgId) return;
    let cancelled = false;
    const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';
    api
      .get<PlanStatus>(`/admin/settings/plan${qs}`)
      .then((data) => {
        if (!cancelled) setStatus(data.enabled ? data.subscriptionStatus : null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, selectedOrgId]);

  const copy = status ? COPY[status] : null;
  if (!copy) return null;

  return (
    <div
      role="status"
      data-testid="plan-banner"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div>
        <p className="font-semibold text-amber-900 dark:text-amber-200">{copy.title}</p>
        <p className="text-amber-800 dark:text-amber-300">{copy.body}</p>
      </div>
      <Link href="/admin/settings/plan" className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">
        Manage billing
      </Link>
    </div>
  );
}
