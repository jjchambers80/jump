// Buyer session plumbing for Next route handlers (spec 007 phase 2).
// Server-only: reads/writes the httpOnly `jump_buyer` cookie and forwards
// requests to the backend `/buyer/*` routes with the session as a bearer
// token. The browser never sees the token, so it stays first-party on
// custom domains later (phase 3).

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
  init: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`;

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
