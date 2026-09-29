// Server-side storefront data for themed pages (spec 038, contracts C1-C3).
// Every call is `cache: 'no-store'`: store access, visibility and theme
// changes show on the next request. Only import from Server Components.

import { cookies, headers } from 'next/headers';
import { API_URL } from '@/lib/assets';
import type { StorefrontLockInfo, ThemeRender } from '../types';

const SERVER_API_URL = process.env.INTERNAL_API_URL || API_URL;
const ACCESS_COOKIE_PREFIX = 'jump_store_access_';
// The backend reads at most this many comma-separated tokens (MAX_TOKENS_PER_REQUEST).
const MAX_ACCESS_TOKENS = 10;

/** Frontend half of the master switch (contracts C10). Off: no render call at all. */
export function themesOn() {
  return process.env.NEXT_PUBLIC_THEME_EDITOR_ENABLED === 'true';
}

export function accessCookieName(organizationId: string) {
  return `${ACCESS_COOKIE_PREFIX}${organizationId}`;
}

/**
 * Every store-access cookie on this host, comma-separated (contracts C2).
 * URLs may carry the slug while cookies are keyed by organization id, so the
 * backend picks the one that fits, as it does with the browser's tokens.
 */
export function accessHeader(): string | null {
  const tokens = cookies()
    .getAll()
    .filter((c) => c.name.startsWith(ACCESS_COOKIE_PREFIX) && c.value)
    .slice(0, MAX_ACCESS_TOKENS)
    .map((c) => c.value);
  return tokens.length ? tokens.join(',') : null;
}

/** The custom-domain host when this request came through one (set by middleware). */
export function tenantHost(): string | null {
  return headers().get('x-jump-tenant-host');
}

export interface StorefrontResponse<T> {
  status: number;
  body: T | null;
}

/** GET a public storefront route from the server, forwarding store access. */
export async function storefrontGet<T>(path: string): Promise<StorefrontResponse<T>> {
  const access = accessHeader();
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      cache: 'no-store',
      headers: access ? { 'X-Storefront-Access': access } : {},
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** A 403 private-store answer from the gate (StorefrontLockedError). */
export function lockFrom(response: StorefrontResponse<unknown>): StorefrontLockInfo | null {
  const details = (response.body as { details?: { locked?: boolean } & StorefrontLockInfo } | null)?.details;
  if (response.status !== 403 || !details?.locked || !details.organization) return null;
  return { organization: details.organization, message: details.message ?? null };
}

export type StorefrontFrame =
  | { kind: 'legacy' }
  | { kind: 'locked'; lock: StorefrontLockInfo; hadAccessCookie: boolean }
  | { kind: 'theme'; data: ThemeRender };

/**
 * Which renderer serves this organization page. Anything but a definite
 * theme or gate answer (legacy org, unknown org, backend down) falls back to
 * today's client-rendered page, which handles its own errors: the renderer
 * switch must never be the reason a storefront is down.
 */
export async function loadStorefrontFrame(orgId: string, page: 'home' | 'events' | 'frame'): Promise<StorefrontFrame> {
  if (!themesOn()) return { kind: 'legacy' };
  const response = await storefrontGet<ThemeRender | { renderer: 'legacy' }>(
    `/organizations/${encodeURIComponent(orgId)}/public/storefront/render?page=${page}`,
  );
  const lock = lockFrom(response);
  if (lock) return { kind: 'locked', lock, hadAccessCookie: Boolean(accessHeader()) };
  if (response.status === 200 && response.body?.renderer === 'theme') return { kind: 'theme', data: response.body };
  return { kind: 'legacy' };
}
