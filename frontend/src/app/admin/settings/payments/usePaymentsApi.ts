'use client';

// API calls for Settings › Payments. Same org scoping as Tax: members are
// scoped by X-Jump-Org (injected by the api client); SYSTEM_ADMIN also sends
// ?organizationId= from the switcher.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { ConnectState, PaymentSettings, PaymentSettingsResponse, UpdatePaymentSettingsBody, UpdatePayoutSettingsBody } from './types';

export function usePaymentsApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  return useMemo(
    () => ({
      get: () => api.get<PaymentSettingsResponse>(`/admin/settings/payments${qs}`),
      update: (body: UpdatePaymentSettingsBody) => api.patch<PaymentSettings>(`/admin/settings/payments${qs}`, body),
      // Stripe Connect (spec 010 phase 2)
      onboard: () => api.post<{ url: string }>(`/admin/settings/payments/connect/onboard${qs}`, {}),
      loginLink: () => api.post<{ url: string }>(`/admin/settings/payments/connect/login-link${qs}`, {}),
      sync: () => api.post<{ connect: ConnectState }>(`/admin/settings/payments/connect/sync${qs}`, {}),
      updatePayouts: (body: UpdatePayoutSettingsBody) => api.patch<{ connect: ConnectState }>(`/admin/settings/payments/connect/payouts${qs}`, body),
    }),
    [qs]
  );
}

export function describeError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | undefined;
  if (e?.status === 404 && /organization/i.test(e.message || '')) return 'No organization is assigned to this account.';
  return e?.message || fallback;
}
