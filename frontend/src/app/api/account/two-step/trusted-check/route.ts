// POST /api/account/two-step/trusted-check — ask the backend whether this
// browser's trusted-device cookie completes the second step. Returns the
// proof (or null) and clears a cookie the backend no longer recognizes.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { clearTrustedCookie, getTrustedToken } from '@/lib/trustedDevice';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = getTrustedToken();
  if (!token) return NextResponse.json({ proof: null });
  try {
    const upstream = await fetch(`${API_URL}/account/two-step/trusted-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'User-Agent': req.headers.get('user-agent') || '',
      },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    const body = upstream.ok ? await upstream.json() : { proof: null };
    const res = NextResponse.json({ proof: body?.proof ?? null });
    if (!body?.proof) clearTrustedCookie(res);
    return res;
  } catch {
    return NextResponse.json({ proof: null });
  }
}
