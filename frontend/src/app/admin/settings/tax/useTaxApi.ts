'use client';

// API calls for Settings › Tax. Same org scoping as Domains: members are
// scoped by X-Jump-Org (injected by the api client); SYSTEM_ADMIN also sends
// ?organizationId= from the switcher.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { TaxSettingsResponse, UpsertTaxRegionBody, UpsertTaxRegionResponse } from './types';

export function useTaxApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  return useMemo(
    () => ({
      get: () => api.get<TaxSettingsResponse>(`/admin/settings/tax${qs}`),
      saveRegion: (country: string, region: string, body: UpsertTaxRegionBody) =>
        api.put<UpsertTaxRegionResponse>(`/admin/settings/tax/regions/${country}/${region}${qs}`, body),
    }),
    [qs]
  );
}

export function describeError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | undefined;
  if (e?.status === 404 && /organization/i.test(e.message || '')) return 'No organization is assigned to this account.';
  return e?.message || fallback;
}
