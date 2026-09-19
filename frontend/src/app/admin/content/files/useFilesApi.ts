'use client';

// API calls for Content › Files. Same org scoping as Settings › Tax: members
// are scoped by X-Jump-Org (injected by the api client); SYSTEM_ADMIN also
// sends ?organizationId= from the switcher.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { StoreFile, StoreFileDetail, StoreFileList, StoreFileListQuery } from '@/lib/content';

export interface UploadResult {
  files: StoreFile[];
  errors: { name: string; message: string }[];
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: { id: string; message: string }[];
}

export function useFilesApi() {
  const { selectedOrgId } = useOrg();
  const orgParam = selectedOrgId ? `organizationId=${encodeURIComponent(selectedOrgId)}` : '';
  const qs = orgParam ? `?${orgParam}` : '';

  return useMemo(
    () => ({
      list: (query: StoreFileListQuery) => {
        const params = new URLSearchParams();
        if (query.q) params.set('q', query.q);
        if (query.type && query.type !== 'all') params.set('type', query.type);
        if (query.sort) params.set('sort', query.sort);
        if (query.page && query.page > 1) params.set('page', String(query.page));
        if (orgParam) params.set('organizationId', selectedOrgId as string);
        const search = params.toString();
        return api.get<StoreFileList>(`/admin/files${search ? `?${search}` : ''}`);
      },
      get: (id: string) => api.get<StoreFileDetail>(`/admin/files/${id}${qs}`),
      upload: (files: File[]) => {
        const form = new FormData();
        for (const file of files) form.append('files', file, file.name);
        return api.upload<UploadResult>(`/admin/files${qs}`, form);
      },
      fromUrl: (url: string) => api.post<StoreFile>(`/admin/files/from-url${qs}`, { url }),
      update: (
        id: string,
        body: { name?: string; altText?: string | null; focalX?: number; focalY?: number }
      ) => api.patch<StoreFileDetail>(`/admin/files/${id}${qs}`, body),
      remove: (id: string) => api.delete<void>(`/admin/files/${id}${qs}`),
      bulkDelete: (ids: string[]) =>
        api.post<BulkDeleteResult>(`/admin/files/bulk-delete${qs}`, { ids }),
    }),
    [qs, orgParam, selectedOrgId]
  );
}
