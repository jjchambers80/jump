'use client';

// API calls for Settings › Plan (spec 022 phase 2). Same org scoping as
// Payments: members by X-Jump-Org; SYSTEM_ADMIN also sends ?organizationId=.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { CheckoutStart, PlanStatus } from '@/lib/billing';

export function usePlanApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';
  return useMemo(
    () => ({
      get: () => api.get<PlanStatus>(`/admin/settings/plan${qs}`),
      checkout: () => api.post<CheckoutStart>(`/admin/settings/plan/checkout${qs}`, {}),
      confirm: (sessionId: string) => api.post<PlanStatus & { subscribed: boolean }>(`/admin/settings/plan/confirm${qs}`, { sessionId }),
      portal: () => api.post<{ url: string }>(`/admin/settings/plan/portal${qs}`, {}),
    }),
    [qs]
  );
}
