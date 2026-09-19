'use client';

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { LinkTargets, Menu, MenuItemInput, MenuSummary } from '@/lib/menus';

export function useMenusApi() {
  const { selectedOrgId } = useOrg();
  const orgParam = selectedOrgId ? `organizationId=${encodeURIComponent(selectedOrgId)}` : '';
  const qs = orgParam ? `?${orgParam}` : '';

  return useMemo(
    () => ({
      list: () => api.get<{ menus: MenuSummary[] }>(`/admin/menus${qs}`),
      get: (id: string) => api.get<Menu>(`/admin/menus/${id}${qs}`),
      create: (title: string) => api.post<Menu>(`/admin/menus${qs}`, { title }),
      replace: (id: string, body: { title?: string; items: MenuItemInput[] }) =>
        api.put<Menu>(`/admin/menus/${id}${qs}`, body),
      duplicate: (id: string) => api.post<Menu>(`/admin/menus/${id}/duplicate${qs}`, {}),
      remove: (id: string) => api.delete<void>(`/admin/menus/${id}${qs}`),
      linkTargets: (q: string) =>
        api.get<LinkTargets>(
          `/admin/menus/link-targets?q=${encodeURIComponent(q)}${orgParam ? `&${orgParam}` : ''}`
        ),
    }),
    [qs, orgParam]
  );
}
