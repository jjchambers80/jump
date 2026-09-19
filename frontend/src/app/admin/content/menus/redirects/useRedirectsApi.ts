'use client';

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';

export interface UrlRedirect {
  id: string;
  fromPath: string;
  toPath: string;
  absolute: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UrlRedirectList {
  redirects: UrlRedirect[];
  total: number;
  page: number;
  pageSize: number;
}

export function useRedirectsApi() {
  const { selectedOrgId } = useOrg();
  const orgParam = selectedOrgId ? `organizationId=${encodeURIComponent(selectedOrgId)}` : '';
  const qs = orgParam ? `?${orgParam}` : '';

  return useMemo(
    () => ({
      list: (q: string, page: number) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (page > 1) params.set('page', String(page));
        if (orgParam) params.set('organizationId', selectedOrgId as string);
        const search = params.toString();
        return api.get<UrlRedirectList>(`/admin/redirects${search ? `?${search}` : ''}`);
      },
      create: (body: { fromPath: string; toPath: string }) =>
        api.post<UrlRedirect>(`/admin/redirects${qs}`, body),
      update: (id: string, body: { fromPath?: string; toPath?: string }) =>
        api.patch<UrlRedirect>(`/admin/redirects/${id}${qs}`, body),
      remove: (id: string) => api.delete<void>(`/admin/redirects/${id}${qs}`),
      bulkDelete: (ids: string[]) =>
        api.post<{ deleted: number }>(`/admin/redirects/bulk-delete${qs}`, { ids }),
    }),
    [qs, orgParam, selectedOrgId]
  );
}
