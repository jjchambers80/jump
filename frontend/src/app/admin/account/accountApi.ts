// API surface and types for the signed-in user's own account (spec 030).
// Everything is keyed on the session; no user id is ever sent.

import api from '@/services/api';
import type { SupportedLocale } from '@/lib/locales';

export interface AccountAvatar {
  id: string;
  hash: string;
  urls: { original: string; thumb: string; card: string; hero: string };
}

export interface Account {
  id: string;
  email: string;
  emailVerified: string | null;
  pendingEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  /** E.164 */
  phone: string | null;
  locale: string;
  timeZone: string | null;
  avatar: AccountAvatar | null;
  /** Provider picture (Google) when no photo is uploaded. */
  imageFallbackUrl: string | null;
  providers: { provider: string; connectedAt: string }[];
  supportedLocales: SupportedLocale[];
  createdAt: string;
}

export interface AccountPatch {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  locale?: string;
  timeZone?: string | null;
}

export interface AccountSession {
  id: string;
  current: boolean;
  device: { type: string | null; os: string | null; browser: string | null; label: string };
  provider: string | null;
  createdAt: string;
  lastSeenAt: string;
  location: { city: string | null; region: string | null; country: string | null } | null;
}

export const accountApi = {
  get: () => api.get<Account>('/account'),
  update: (patch: AccountPatch) => api.patch<Account>('/account', patch),
  requestEmailChange: (email: string) => api.post<Account>('/account/email', { email }),
  resendEmailChange: () => api.post<Account>('/account/email/resend', {}),
  cancelEmailChange: () => api.delete<Account>('/account/email/pending'),
  /** Public: the link may open signed out. */
  confirmEmailChange: (token: string) => api.post<{ email: string }>('/account/email/confirm', { token }),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.upload<Account>('/account/avatar', formData);
  },
  removeAvatar: () => api.delete<Account>('/account/avatar'),
  sessions: {
    list: () => api.get<{ sessions: AccountSession[] }>('/account/sessions'),
    revoke: (id: string) => api.delete<{ revoked: number; current: boolean }>(`/account/sessions/${encodeURIComponent(id)}`),
    revokeOthers: () => api.post<{ revoked: number }>('/account/sessions/revoke-others', {}),
  },
};

/** Initials from the display name, for the avatar fallback. */
export function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || '').trim() || (email || '').split('@')[0] || '?';
  return source
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
