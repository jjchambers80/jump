// Online store themes (spec 038): admin API types and calls. Every call goes
// through services/api.ts, so the org switcher's X-Jump-Org applies.

import api from '@/services/api';

export type ThemeRole = 'MAIN' | 'UNPUBLISHED';

export interface ThemeStatus {
  masterSwitch: boolean;
  organizationEnabled: boolean;
  enabled: boolean;
}

export interface ThemeSummary {
  id: string;
  name: string;
  role: ThemeRole;
  presetKey: string;
  presetVersion: string;
  version: number;
  lastSavedAt: string;
  lastSavedBy: { id: string; name: string | null } | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface ThemeDocumentIndex {
  key: string;
  kind: string;
  version: number;
  updatedAt: string | null;
  isDefault: boolean;
}

export interface ThemeDetail extends ThemeSummary {
  settings: Record<string, any>;
  resolvedSettings: Record<string, any>;
  content: Record<string, string>;
  documents: ThemeDocumentIndex[];
}

export interface ThemeDocumentData {
  root: { props: Record<string, any> };
  content: { type: string; props: Record<string, any> }[];
}

export interface ThemeDocumentResponse {
  key: string;
  kind: string;
  data: ThemeDocumentData;
  version: number;
  isDefault: boolean;
}

export interface ThemeSaveBody {
  themeVersion: number;
  settings?: Record<string, any>;
  content?: Record<string, string>;
  documents?: Record<string, { data: ThemeDocumentData | null; version: number }>;
}

export interface ThemeSaveResult {
  theme: { id: string; version: number; lastSavedAt: string };
  documents: Record<string, number>;
  changedKeys: string[];
}

export interface ThemeRevision {
  id: string;
  changedKeys: string[];
  savedBy: { id: string; name: string | null } | null;
  createdAt: string;
}

/** "Eventimus Default · v1.0" (D14). */
export const PRESET_NAMES: Record<string, string> = { 'eventimus-default': 'Eventimus Default' };
export function presetLabel(theme: Pick<ThemeSummary, 'presetKey' | 'presetVersion'>) {
  return `${PRESET_NAMES[theme.presetKey] ?? theme.presetKey} · v${theme.presetVersion}`;
}

export const editorHref = (themeId: string) => `/admin/online-store/themes/${themeId}/editor`;

export const themesApi = {
  status: () => api.get<ThemeStatus>('/admin/themes/status'),
  setRollout: (enabled: boolean) => api.put<ThemeStatus>('/admin/themes/rollout', { enabled }),
  list: () => api.get<{ themes: ThemeSummary[] }>('/admin/themes'),
  get: (id: string) => api.get<ThemeDetail>(`/admin/themes/${id}`),
  document: (id: string, key: string) => api.get<ThemeDocumentResponse>(`/admin/themes/${id}/documents/${encodeURIComponent(key)}`),
  content: (id: string) => api.get<{ overrides: Record<string, string>; resolved: Record<string, string> }>(`/admin/themes/${id}/content`),
  previewData: (id: string, page: string) => api.get<{ organization: any; resolved: any }>(`/admin/themes/${id}/preview-data?page=${encodeURIComponent(page)}`),
  save: (id: string, body: ThemeSaveBody) => api.put<ThemeSaveResult>(`/admin/themes/${id}/save`, body),
  revisions: (id: string) => api.get<{ revisions: ThemeRevision[] }>(`/admin/themes/${id}/revisions`),
  rename: (id: string, name: string, themeVersion: number) => api.patch<ThemeSummary>(`/admin/themes/${id}`, { name, themeVersion }),
  duplicate: (id: string, name?: string) => api.post<ThemeSummary>(`/admin/themes/${id}/duplicate`, name ? { name } : {}),
  publish: (id: string) => api.post<ThemeSummary>(`/admin/themes/${id}/publish`, {}),
  remove: (id: string) => api.delete<void>(`/admin/themes/${id}`),
  restore: (id: string, revisionId: string, themeVersion: number) =>
    api.post<ThemeSaveResult>(`/admin/themes/${id}/revisions/${revisionId}/restore`, { themeVersion }),
};
