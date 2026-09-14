'use client';

// API calls for Settings › Tax. Same org scoping as Domains: members are
// scoped by X-Jump-Org (injected by the api client); SYSTEM_ADMIN also sends
// ?organizationId= from the switcher.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { TaxReport, TaxSettings, TaxSettingsResponse, UpsertTaxRegionBody, UpsertTaxRegionResponse } from './types';

export function useTaxApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  return useMemo(
    () => ({
      get: () => api.get<TaxSettingsResponse>(`/admin/settings/tax${qs}`),
      saveRegion: (country: string, region: string, body: UpsertTaxRegionBody) =>
        api.put<UpsertTaxRegionResponse>(`/admin/settings/tax/regions/${country}/${region}${qs}`, body),
      recalculateRegion: (country: string, region: string) =>
        api.post<UpsertTaxRegionResponse>(`/admin/settings/tax/regions/${country}/${region}/recalculate${qs}`, {}),
      updateSettings: (body: TaxSettings) => api.patch<TaxSettings>(`/admin/settings/tax${qs}`, body),
      report: (from: string, to: string) =>
        api.get<TaxReport>(`/admin/settings/tax/report${qs ? `${qs}&` : '?'}from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    }),
    [qs]
  );
}

export function describeError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | undefined;
  if (e?.status === 404 && /organization/i.test(e.message || '')) return 'No organization is assigned to this account.';
  return e?.message || fallback;
}
