// Visitor-side storage for private storefront access tokens (Online store ›
// Preferences › Store access). The backend issues a token per organization
// from POST /organizations/:id/storefront-access. services/api.ts sends every
// stored token as X-Storefront-Access (comma-separated) because the browser
// does not know which organization an event or venue belongs to before
// asking; gated routes answer 403 with `details.locked` otherwise.

import type { ThemeMode } from './theme';

const PREFIX = 'jump.storefront-access.';

/** Branding + message the backend returns with a 403 StorefrontLockedError. */
export interface StorefrontLock {
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    brandColor?: string | null;
    themeMode?: ThemeMode | null;
  };
  message: string | null;
}

export function readStorefrontAccess(orgId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + orgId);
  } catch {
    return null;
  }
}

/** Every stored token, for the X-Storefront-Access header. */
export function allStorefrontAccessTokens(): string[] {
  try {
    const tokens: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        const value = window.localStorage.getItem(key);
        if (value) tokens.push(value);
      }
    }
    return tokens;
  } catch {
    return [];
  }
}

export function writeStorefrontAccess(orgId: string, token: string) {
  try {
    window.localStorage.setItem(PREFIX + orgId, token);
  } catch {
    /* private mode / storage blocked: the visitor re-enters the password next time */
  }
}

/** The lock payload when an API error is a private-storefront 403, else null. */
export function storefrontLockFrom(err: unknown): StorefrontLock | null {
  const e = err as { status?: number; details?: { locked?: boolean; organization?: StorefrontLock['organization']; message?: string | null } };
  if (e?.status !== 403 || !e.details?.locked || !e.details.organization) return null;
  return { organization: e.details.organization, message: e.details.message ?? null };
}
