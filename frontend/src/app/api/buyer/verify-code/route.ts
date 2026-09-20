// POST /api/buyer/verify-code — exchange a six-digit sign-in code for the
// session cookie (spec 031 phase 3). Same shape as /api/buyer/verify.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clientIpFrom, setBuyerCookie } from '@/lib/buyerSession';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch('/buyer/auth/verify-code', {
    method: 'POST',
    body: { organizationId: payload.organizationId, email: payload.email, code: payload.code },
    clientIp: clientIpFrom(req),
  });

  if (status !== 200 || !body?.sessionToken) {
    return NextResponse.json(body ?? { error: 'Sign-in failed' }, { status: status || 401 });
  }

  const res = NextResponse.json({ organizationId: body.organizationId });
  setBuyerCookie(res, body.sessionToken);
  return res;
}
