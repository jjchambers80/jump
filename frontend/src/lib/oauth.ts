import api from '@/services/api';

export interface OAuthConsentDetails {
  client: { name: string; clientId: string };
  redirectHost: string;
  loopback: boolean;
  scopes: Array<{ scope: string; description: string }>;
  organizations: Array<{ id: string; name: string; slug: string }>;
  csrfToken: string;
  denyUrl: string;
}

export type OAuthRequest = Record<string, string>;

export const oauthApi = {
  prepare: (request: OAuthRequest) =>
    api.post<OAuthConsentDetails>('/oauth/authorize/prepare', request),
  approve: (request: OAuthRequest & { organization_id: string; csrf_token: string }) =>
    api.post<{ redirect_to: string }>('/oauth/authorize', request),
};
