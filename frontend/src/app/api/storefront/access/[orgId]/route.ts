// Spike 038-0 (§9a.1): unlock proxy + clearing route on the storefront host.
// POST proxies the backend unlock (POST /organizations/:id/storefront-access)
// and stores the token in a host-only, httpOnly cookie; DELETE expires it.
import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/assets';

const SERVER_API_URL = process.env.INTERNAL_API_URL || API_URL;
function tokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

const cookieName = (orgId: string) => `jump_store_access_${orgId}`;

export async function POST(request: Request, { params }: { params: { orgId: string } }) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  const res = await fetch(`${SERVER_API_URL}/organizations/${encodeURIComponent(params.orgId)}/storefront-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ error: 'Wrong password' }, { status: res.status });
  const { token } = (await res.json()) as { token: string };
  // Max-Age = the token's own lifetime (30 d today), read from its exp claim.
  const exp = tokenExp(token);
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 60 * 60 * 24 * 30;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName(params.orgId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return response;
}

export async function DELETE(_request: Request, { params }: { params: { orgId: string } }) {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(cookieName(params.orgId), '', { path: '/', maxAge: 0 });
  return response;
}
