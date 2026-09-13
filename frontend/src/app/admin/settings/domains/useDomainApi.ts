'use client';

// API calls for Settings › Domains. SYSTEM_ADMIN has no membership, so the
// backend takes ?organizationId= from them and ignores it for scoped staff.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { DomainListResponse, StorefrontDomain } from './types';

export function useDomainApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  return useMemo(
    () => ({
      list: () => api.get<DomainListResponse>(`/admin/settings/domains${qs}`),
      get: (id: string) => api.get<StorefrontDomain>(`/admin/settings/domains/${id}${qs}`),
      add: (hostname: string) => api.post<StorefrontDomain>(`/admin/settings/domains${qs}`, { hostname }),
      verify: (id: string) => api.post<StorefrontDomain>(`/admin/settings/domains/${id}/verify${qs}`, {}),
      makePrimary: (id: string) => api.post<StorefrontDomain>(`/admin/settings/domains/${id}/primary${qs}`, {}),
      remove: (id: string) => api.delete(`/admin/settings/domains/${id}${qs}`),
    }),
    [qs]
  );
}

export function describeError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | undefined;
  if (e?.status === 404 && /organization/i.test(e.message || '')) return 'No organization is assigned to this account.';
  return e?.message || fallback;
}
