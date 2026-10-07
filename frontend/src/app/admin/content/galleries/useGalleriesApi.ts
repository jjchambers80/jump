'use client';

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { Gallery, GalleryInput, GallerySummary } from '@/lib/galleries';

export function useGalleriesApi() {
  const { selectedOrgId } = useOrg();
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  return useMemo(
    () => ({
      list: () => api.get<{ galleries: GallerySummary[] }>(`/admin/galleries${qs}`),
      get: (id: string) => api.get<Gallery>(`/admin/galleries/${id}${qs}`),
      create: (title: string) => api.post<Gallery>(`/admin/galleries${qs}`, { title }),
      replace: (id: string, body: GalleryInput) => api.put<Gallery>(`/admin/galleries/${id}${qs}`, body),
      remove: (id: string) => api.delete<void>(`/admin/galleries/${id}${qs}`),
    }),
    [qs]
  );
}
