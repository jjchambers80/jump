'use client';

// Settings › Notifications (spec 053): store-edited system emails. Application
// decision emails still come from useTemplatesApi until 053-D moves them here.

import { useMemo } from 'react';
import api from '@/services/api';

export interface NotificationTemplate {
  key: string;
  label: string;
  when: string;
  /** Parts the system adds below the message; the store cannot edit them. */
  blocks: string[];
  mergeFields: { key: string; description: string }[];
  subject: string;
  body: string;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface NotificationGroup {
  key: string;
  label: string;
  notifications: NotificationTemplate[];
}

export type Draft = { subject: string; body: string };

export function useNotificationsApi() {
  return useMemo(
    () => ({
      list: () => api.get<{ groups: NotificationGroup[] }>('/admin/settings/notifications'),
      update: (key: string, draft: Draft) => api.put<NotificationTemplate>(`/admin/settings/notifications/${key}`, draft),
      reset: (key: string) => api.delete<NotificationTemplate>(`/admin/settings/notifications/${key}`),
      preview: (key: string, draft: Draft) => api.post<{ subject: string; html: string }>(`/admin/settings/notifications/${key}/preview`, draft),
      test: (key: string, draft: Draft) => api.post<{ sentTo: string }>(`/admin/settings/notifications/${key}/test`, draft),
    }),
    []
  );
}
