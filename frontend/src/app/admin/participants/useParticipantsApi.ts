'use client';

// Admin API calls for the organization-wide Participants list (spec 019).
// Members are scoped through X-Jump-Org by the api client; SYSTEM_ADMIN is
// unscoped and sees every organization. Per-row actions (decisions, detail)
// keep using `useApplicationsApi(row.eventId)`.

import { useMemo } from 'react';
import api from '@/services/api';
import type { ApplicationList, Decision, FormTemplate, FormTemplateSummary, OrgForm, TemplateDefinition } from '@/lib/applications';
import type { ListQuery } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';

/** The per-event query plus the organization-wide `event` filter. */
export interface ParticipantsQuery extends ListQuery {
  event?: string;
  pageSize?: number;
}

function qs(query: ParticipantsQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, string | number | undefined>)) if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useParticipantsApi() {
  return useMemo(
    () => ({
      list: (query: ParticipantsQuery) => api.get<ApplicationList>(`/admin/applications${qs(query)}`),
      summary: () => api.get<Record<string, number>>('/admin/applications/summary'),
      bulk: (body: { ids: string[]; decision: Decision; note?: string }) =>
        api.post<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>('/admin/applications/bulk', body),
      exportUrl: (query: ParticipantsQuery) => `/admin/applications/export.csv${qs(query)}`,
      forms: () => api.get<{ data: OrgForm[] }>('/admin/application-forms'),
      // Phase 2: form templates
      templates: () => api.get<{ data: FormTemplateSummary[] }>('/admin/application-templates'),
      template: (id: string) => api.get<FormTemplate>(`/admin/application-templates/${id}`),
      createTemplate: (body: { name: string; kind: 'PAID' | 'FREE'; definition?: Partial<TemplateDefinition> }) => api.post<FormTemplate>('/admin/application-templates', body),
      updateTemplate: (id: string, body: { name?: string; definition?: TemplateDefinition }) => api.put<FormTemplate>(`/admin/application-templates/${id}`, body),
      deleteTemplate: (id: string) => api.delete(`/admin/application-templates/${id}`),
    }),
    []
  );
}
