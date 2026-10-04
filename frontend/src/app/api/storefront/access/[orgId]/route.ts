// Store access cookie on the storefront host (spec 038, contracts C2).
// POST proxies the backend unlock and keeps the token in a host-only
// httpOnly cookie that server-rendered pages forward as X-Storefront-Access.
// DELETE expires it: Server Components cannot delete cookies in Next 14, so
// the themed gate calls this when a forwarded cookie was refused.

import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/assets';
import { clientIpFrom, signedClientIpHeaders } from '@/lib/buyerSession';
import { accessCookieName } from '@/theme/server/storefront';

const SERVER_API_URL = process.env.INTERNAL_API_URL || API_URL;
const ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FALLBACK_MAX_AGE = 60 * 60 * 24 * 30; // the backend's ACCESS_TOKEN_TTL (30 d)

/** Seconds until the token's own `exp`, so the cookie never outlives it. */
function maxAgeOf(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number') return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  } catch {
    /* not a JWT we can read: fall back */
  }
  return FALLBACK_MAX_AGE;
}

export async function POST(request: Request, { params }: { params: { orgId: string } }) {
  if (!ORG_ID.test(params.orgId)) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const { password } = (await request.json().catch(() => ({}))) as { password?: unknown };
  const res = await fetch(`${SERVER_API_URL}/organizations/${encodeURIComponent(params.orgId)}/storefront-access`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The unlock limiter counts per visitor, not per Next server (spec 020).
      ...signedClientIpHeaders(clientIpFrom(request)),
    },
    body: JSON.stringify({ password: typeof password === 'string' ? password : '' }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'Store unavailable' }, { status: 502 });
  const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !body.token) return NextResponse.json({ message: body.message ?? 'Incorrect password' }, { status: res.status || 401 });

  const response = NextResponse.json({ token: body.token });
  response.cookies.set(accessCookieName(params.orgId), body.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeOf(body.token),
  });
  return response;
}

export async function DELETE(_request: Request, { params }: { params: { orgId: string } }) {
  if (!ORG_ID.test(params.orgId)) return new NextResponse(null, { status: 404 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(accessCookieName(params.orgId), '', { path: '/', maxAge: 0 });
  return response;
}
