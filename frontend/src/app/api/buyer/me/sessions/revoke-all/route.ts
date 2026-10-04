// POST /api/buyer/me/sessions/revoke-all — sign out every other device (spec 040).
// The backend returns a fresh session for this browser; it replaces the cookie.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clearBuyerCookie, getBuyerToken, setBuyerCookie } from '@/lib/buyerSession';

export async function POST() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch('/buyer/me/sessions/revoke-all', { method: 'POST', body: {}, token });
  if (status !== 200 || !body?.sessionToken) {
    const res = NextResponse.json(body ?? {}, { status: status || 500 });
    if (status === 401) clearBuyerCookie(res);
    return res;
  }
  const res = NextResponse.json({ ok: true });
  setBuyerCookie(res, body.sessionToken);
  return res;
}
