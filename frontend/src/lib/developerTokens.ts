// Jump CLI sign-in and developer tokens (spec 043).
import api from '@/services/api';

export interface DeveloperToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  user: { id: string; name: string };
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface CliStore {
  id: string;
  name: string;
  slug: string;
}

export const developerApi = {
  store: (store: string) => api.get<{ organization: CliStore }>(`/developer/authorize?store=${encodeURIComponent(store)}`),
  approve: (body: { store: string; codeChallenge: string; redirectUri: string; name?: string }) =>
    api.post<{ code: string; organization: CliStore }>('/developer/authorize', body),
  list: () => api.get<{ tokens: DeveloperToken[] }>('/admin/developer-tokens'),
  revoke: (id: string) => api.delete<void>(`/admin/developer-tokens/${id}`),
};

/** RFC 8252 loopback redirect, checked here too so a bad link never asks for approval. */
export function isLoopbackRedirect(uri: string) {
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port !== '' && !url.username;
  } catch {
    return false;
  }
}
