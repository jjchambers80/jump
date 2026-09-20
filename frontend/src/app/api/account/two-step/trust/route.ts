// POST /api/account/two-step/trust — store the trusted-device token the
// backend returned from verify({ rememberDevice: true }) in an httpOnly cookie.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { setTrustedCookie } from '@/lib/trustedDevice';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  setTrustedCookie(res, token);
  return res;
}
