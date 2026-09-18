'use client';

// Admin API calls for an event's applications and forms (spec 011). Org
// scoping: members send X-Jump-Org through the api client; SYSTEM_ADMIN is
// unscoped and may reach any event.

import { useMemo } from 'react';
import api from '@/services/api';
import type { AddOnLineInput, AdminApplication, AdminForm, AdminTier, ApplicationList, Decision, FormTemplate, MessageTemplate, Question } from '@/lib/applications';

export interface DigestSettings {
  enabled: boolean;
  lastRunAt: string | null;
}

export interface ListQuery {
  form?: string;
  status?: string;
  payment?: string;
  tier?: string;
  /** Spec 012: only applications with a line for this add-on. */
  addOn?: string;
  q?: string;
  sort?: string;
  page?: number;
}

function qs(query: ListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, string | number | undefined>)) if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useApplicationsApi(eventId: string) {
  return useMemo(() => {
    const base = `/admin/events/${eventId}`;
    return {
      list: (query: ListQuery) => api.get<ApplicationList>(`${base}/applications${qs(query)}`),
      summary: () => api.get<Record<string, number>>(`${base}/applications/summary`),
      get: (id: string) => api.get<AdminApplication>(`${base}/applications/${id}`),
      preview: (id: string, decision: Decision) => api.post<{ subject: string; body: string }>(`${base}/applications/${id}/preview`, { decision }),
      decide: (id: string, body: { decision: Decision; note?: string; message?: { subject: string; body: string } | null; sendEmail?: boolean }) =>
        api.post<AdminApplication>(`${base}/applications/${id}/decision`, body),
      bulk: (body: { ids: string[]; decision: Decision; note?: string }) =>
        api.post<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(`${base}/applications/bulk`, body),
      updateNotes: (id: string, body: { boothLabel?: string | null; internalNote?: string | null }) => api.patch<AdminApplication>(`${base}/applications/${id}`, body),
      retryCharge: (id: string) => api.post<AdminApplication>(`${base}/applications/${id}/charge`, {}),
      refund: (id: string, body: { amount?: number | null; reason?: string | null }) => api.post<AdminApplication>(`${base}/applications/${id}/refund`, body),
      updateAddOns: (id: string, addOns: AddOnLineInput[]) => api.patch<AdminApplication>(`${base}/applications/${id}/add-ons`, { addOns }),
      // Spec 018 phase 3
      changeTier: (id: string, tierId: string) => api.post<AdminApplication>(`${base}/applications/${id}/tier`, { tierId }),
      addAdjustment: (id: string, body: { amount: number; reason: string }) => api.post<AdminApplication>(`${base}/applications/${id}/adjustments`, body),
      removeAdjustment: (id: string, adjustmentId: string) => api.delete<AdminApplication>(`${base}/applications/${id}/adjustments/${adjustmentId}`),
      waive: (id: string, body: { reason: string }) => api.post<AdminApplication>(`${base}/applications/${id}/waive`, body),
      recordOfflinePayment: (id: string, body: { method: string; amount: number; reference?: string | null; paidAt?: string | null }) =>
        api.post<AdminApplication>(`${base}/applications/${id}/offline-payment`, body),
      exportUrl: (query: ListQuery) => `${base}/applications/export.csv${qs(query)}`,
      forms: () => api.get<{ data: AdminForm[] }>(`${base}/application-forms`),
      form: (formId: string) => api.get<AdminForm>(`${base}/application-forms/${formId}`),
      createForm: (body: Partial<AdminForm> & { kind: 'PAID' | 'FREE'; name: string; templateId?: string }) => api.post<AdminForm>(`${base}/application-forms`, body),
      // Spec 019 phase 2: snapshot a form as a template (new name) or replace an existing one.
      saveAsTemplate: (formId: string, body: { name?: string; replaceTemplateId?: string }) => api.post<FormTemplate>(`${base}/application-forms/${formId}/save-as-template`, body),
      updateForm: (formId: string, body: Record<string, unknown>) => api.patch<AdminForm>(`${base}/application-forms/${formId}`, body),
      deleteForm: (formId: string) => api.delete(`${base}/application-forms/${formId}`),
      addTier: (formId: string, body: Record<string, unknown>) => api.post(`${base}/application-forms/${formId}/tiers`, body),
      updateTier: (formId: string, tierId: string, body: Record<string, unknown>) => api.patch(`${base}/application-forms/${formId}/tiers/${tierId}`, body),
      deleteTier: (formId: string, tierId: string) => api.delete(`${base}/application-forms/${formId}/tiers/${tierId}`),
      setTierAddOns: (formId: string, tierId: string, addOnIds: string[]) => api.put<AdminTier>(`${base}/application-forms/${formId}/tiers/${tierId}/add-ons`, { addOnIds }),
      addQuestion: (formId: string, body: Record<string, unknown>) => api.post<Question>(`${base}/application-forms/${formId}/questions`, body),
      updateQuestion: (formId: string, questionId: string, body: Record<string, unknown>) => api.patch<Question>(`${base}/application-forms/${formId}/questions/${questionId}`, body),
      removeQuestion: (formId: string, questionId: string) => api.delete<{ archived: boolean }>(`${base}/application-forms/${formId}/questions/${questionId}`),
      reorderQuestions: (formId: string, ids: string[]) => api.patch<{ data: Question[] }>(`${base}/application-forms/${formId}/questions/reorder`, { ids }),
    };
  }, [eventId]);
}

export function useTemplatesApi() {
  return useMemo(
    () => ({
      list: () => api.get<{ data: MessageTemplate[]; mergeFields: { key: string; description: string }[] }>('/admin/settings/application-templates'),
      update: (action: string, body: { subject: string; body: string }) => api.put<MessageTemplate>(`/admin/settings/application-templates/${action}`, body),
      reset: (action: string) => api.delete<MessageTemplate>(`/admin/settings/application-templates/${action}`),
      digest: () => api.get<DigestSettings>('/admin/settings/application-digest'),
      updateDigest: (enabled: boolean) => api.patch<DigestSettings>('/admin/settings/application-digest', { enabled }),
    }),
    []
  );
}

export function describeError(err: unknown, fallback: string): string {
  const e = err as { message?: string } | undefined;
  return e?.message || fallback;
}
