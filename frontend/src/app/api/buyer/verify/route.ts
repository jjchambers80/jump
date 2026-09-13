// POST /api/buyer/verify — exchange a magic-link token for the session cookie.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, setBuyerCookie } from '@/lib/buyerSession';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch('/buyer/auth/verify', {
    method: 'POST',
    body: { token: payload.token },
  });

  if (status !== 200 || !body?.sessionToken) {
    return NextResponse.json(body ?? { error: 'Sign-in failed' }, { status: status || 401 });
  }

  const res = NextResponse.json({ organizationId: body.organizationId });
  setBuyerCookie(res, body.sessionToken);
  return res;
}
