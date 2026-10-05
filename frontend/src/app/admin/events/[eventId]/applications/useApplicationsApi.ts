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
  /** Spec 019 phase 3: exact tag. */
  tag?: string;
  /** Spec 014 phase 2: `none` = approved on a map-bound tier with no booth yet; `chosen` = owns one. */
  booth?: 'none' | 'chosen';
  q?: string;
  sort?: string;
  page?: number;
}

/** PATCH /admin/events/:eventId/applications/:id (spec 011 notes + spec 019 phase 3 tags / check-in). */
export interface MetaPatch {
  boothLabel?: string | null;
  internalNote?: string | null;
  tags?: string[];
  checkedIn?: boolean;
  checkedOut?: boolean;
  publicProfile?: boolean;
}

/**
 * Where one scope's applications live: an event's, or a standing form's
 * submissions (spec 044 — no event, so notes and tags only, no money).
 */
export function applicationsBase(eventId: string | null | undefined, standingFormId?: string) {
  return standingFormId ? `/admin/standing-application-forms/${standingFormId}/submissions` : `/admin/events/${eventId}/applications`;
}

/** Spec 019 phase 3: the meta PATCH for a row from any mount (the row knows its event). */
export function patchApplicationMeta(eventId: string | null | undefined, id: string, body: MetaPatch, standingFormId?: string) {
  return api.patch<AdminApplication>(`${applicationsBase(eventId, standingFormId)}/${id}`, body);
}

function qs(query: ListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, string | number | undefined>)) if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * `standingFormId` (spec 044) points the same calls at a standing form: its
 * submissions and its form endpoints. Tier, money and add-on calls are event-only.
 */
export function useApplicationsApi(eventId: string, standingFormId?: string) {
  return useMemo(() => {
    const base = `/admin/events/${eventId}`;
    const apps = applicationsBase(eventId, standingFormId);
    const forms = standingFormId ? '/admin/standing-application-forms' : `${base}/application-forms`;
    return {
      list: (query: ListQuery) => api.get<ApplicationList>(`${apps}${qs(query)}`),
      summary: () => api.get<Record<string, number>>(`${apps}/summary`),
      get: (id: string) => api.get<AdminApplication>(`${apps}/${id}`),
      // Spec 039: `tierId: null` approves without a category (the vendor picks, TIERS forms).
      preview: (id: string, decision: Decision, tierId?: string | null) =>
        api.post<{ subject: string; body: string }>(`${apps}/${id}/preview`, { decision, ...(tierId !== undefined && { tierId }) }),
      decide: (id: string, body: { decision: Decision; tierId?: string | null; note?: string; message?: { subject: string; body: string } | null; sendEmail?: boolean }) =>
        api.post<AdminApplication>(`${apps}/${id}/decision`, body),
      bulk: (body: { ids: string[]; decision: Decision; note?: string }) =>
        api.post<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(`${apps}/bulk`, body),
      updateNotes: (id: string, body: MetaPatch) => api.patch<AdminApplication>(`${apps}/${id}`, body),
      /** Spec 019 phase 3: same PATCH, full shape (tags, check-in). */
      updateMeta: (id: string, body: MetaPatch) => api.patch<AdminApplication>(`${apps}/${id}`, body),
      tags: () => api.get<{ data: string[] }>(`${apps}/tags`),
      retryCharge: (id: string) => api.post<AdminApplication>(`${apps}/${id}/charge`, {}),
      refund: (id: string, body: { amount?: number | null; reason?: string | null }) => api.post<AdminApplication>(`${apps}/${id}/refund`, body),
      updateAddOns: (id: string, addOns: AddOnLineInput[]) => api.patch<AdminApplication>(`${apps}/${id}/add-ons`, { addOns }),
      // Spec 018 phase 3
      changeTier: (id: string, tierId: string) => api.post<AdminApplication>(`${apps}/${id}/tier`, { tierId }),
      addAdjustment: (id: string, body: { amount: number; reason: string }) => api.post<AdminApplication>(`${apps}/${id}/adjustments`, body),
      removeAdjustment: (id: string, adjustmentId: string) => api.delete<AdminApplication>(`${apps}/${id}/adjustments/${adjustmentId}`),
      waive: (id: string, body: { reason: string }) => api.post<AdminApplication>(`${apps}/${id}/waive`, body),
      recordOfflinePayment: (id: string, body: { method: string; amount: number; reference?: string | null; paidAt?: string | null }) =>
        api.post<AdminApplication>(`${apps}/${id}/offline-payment`, body),
      exportUrl: (query: ListQuery) => `${apps}/export.csv${qs(query)}`,
      forms: () =>
        standingFormId ? api.get<AdminForm>(`${forms}/${standingFormId}`).then((form) => ({ data: [form] })) : api.get<{ data: AdminForm[] }>(forms),
      form: (formId: string) => api.get<AdminForm>(`${forms}/${formId}`),
      createForm: (body: Partial<AdminForm> & { kind: 'PAID' | 'FREE'; name: string; templateId?: string }) => api.post<AdminForm>(`${forms}`, body),
      // Spec 019 phase 2: snapshot a form as a template (new name) or replace an existing one.
      saveAsTemplate: (formId: string, body: { name?: string; replaceTemplateId?: string }) => api.post<FormTemplate>(`${forms}/${formId}/save-as-template`, body),
      updateForm: (formId: string, body: Record<string, unknown>) => api.patch<AdminForm>(`${forms}/${formId}`, body),
      deleteForm: (formId: string) => api.delete(`${forms}/${formId}`),
      addTier: (formId: string, body: Record<string, unknown>) => api.post(`${forms}/${formId}/tiers`, body),
      updateTier: (formId: string, tierId: string, body: Record<string, unknown>) => api.patch(`${forms}/${formId}/tiers/${tierId}`, body),
      deleteTier: (formId: string, tierId: string) => api.delete(`${forms}/${formId}/tiers/${tierId}`),
      setTierAddOns: (formId: string, tierId: string, addOnIds: string[]) => api.put<AdminTier>(`${forms}/${formId}/tiers/${tierId}/add-ons`, { addOnIds }),
      addQuestion: (formId: string, body: Record<string, unknown>) => api.post<Question>(`${forms}/${formId}/questions`, body),
      updateQuestion: (formId: string, questionId: string, body: Record<string, unknown>) => api.patch<Question>(`${forms}/${formId}/questions/${questionId}`, body),
      removeQuestion: (formId: string, questionId: string) => api.delete<{ archived: boolean }>(`${forms}/${formId}/questions/${questionId}`),
      reorderQuestions: (formId: string, ids: string[]) => api.patch<{ data: Question[] }>(`${forms}/${formId}/questions/reorder`, { ids }),
    };
  }, [eventId, standingFormId]);
}

export function useTemplatesApi() {
  return useMemo(
    () => ({
      list: (scope?: 'EVENT' | 'STANDING') => {
        const params = scope ? `?scope=${scope}` : '';
        return api.get<{ data: MessageTemplate[]; mergeFields: { key: string; description: string }[] }>(`/admin/settings/application-templates${params}`);
      },
      update: (action: string, body: { subject: string; body: string }, scope?: 'EVENT' | 'STANDING') => {
        const params = scope ? `?scope=${scope}` : '';
        return api.put<MessageTemplate>(`/admin/settings/application-templates/${action}${params}`, body);
      },
      reset: (action: string, scope?: 'EVENT' | 'STANDING') => {
        const params = scope ? `?scope=${scope}` : '';
        return api.delete<MessageTemplate>(`/admin/settings/application-templates/${action}${params}`);
      },
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
