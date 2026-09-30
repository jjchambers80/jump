// Buyer session plumbing for Next route handlers (spec 007 phase 2).
// Server-only: reads/writes the httpOnly `jump_buyer` cookie and forwards
// requests to the backend `/buyer/*` routes with the session as a bearer
// token. The browser never sees the token, so it stays first-party on
// custom domains later (phase 3).

import { createHmac } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const BUYER_COOKIE = 'jump_buyer';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export function getBuyerToken(): string | null {
  return cookies().get(BUYER_COOKIE)?.value ?? null;
}

export function setBuyerCookie(res: NextResponse, token: string) {
  res.cookies.set(BUYER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

export function clearBuyerCookie(res: NextResponse) {
  res.cookies.set(BUYER_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/**
 * Forward a request to the backend buyer API. Passes the buyer session as a
 * bearer token when one exists and returns the backend's status + JSON body
 * unchanged, so pages see the same error shapes the backend produces.
 */
export async function backendBuyerFetch(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; clientIp?: string | null } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`;
  // The backend rate-limits sign-in requests per client IP. Every browser call
  // arrives here server-to-server, so the backend would otherwise see one IP
  // for all buyers. Forward the client address signed with the shared
  // AUTH_SECRET; X-Forwarded-For is not used because the hop count through
  // Railway's edge would make it spoofable.
  Object.assign(headers, signedClientIpHeaders(init.clientIp));

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/**
 * X-Jump-Client-Ip + signature for a server-to-server call, so the backend's
 * per-IP limiters see the visitor, not this server (spec 020). Empty when
 * there is no IP or no AUTH_SECRET.
 */
export function signedClientIpHeaders(clientIp: string | null | undefined): Record<string, string> {
  if (!clientIp || !process.env.AUTH_SECRET) return {};
  return {
    'X-Jump-Client-Ip': clientIp,
    'X-Jump-Client-Ip-Sig': createHmac('sha256', process.env.AUTH_SECRET).update(clientIp).digest('hex'),
  };
}

/** Best-effort client IP for a route handler request (first X-Forwarded-For hop, else X-Real-IP). */
export function clientIpFrom(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim() || null;
  return req.headers.get('x-real-ip');
}

/**
 * Forward one signed-in buyer call and answer with the backend's status and
 * body (spec 040). No cookie → 401 without a backend round trip; a 401 from
 * the backend (expired, or revoked by "sign out of all devices") clears the
 * cookie so the account page falls back to the sign-in form.
 */
export async function proxyBuyer(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<NextResponse> {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch(path, { ...init, token });
  const res = NextResponse.json(body ?? {}, { status });
  if (status === 401) clearBuyerCookie(res);
  return res;
}
