// GET /api/buyer/me — profile for the signed-in buyer (401 when signed out).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clearBuyerCookie, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { status, body } = await backendBuyerFetch('/buyer/me', { token });
  const res = NextResponse.json(body ?? {}, { status });
  if (status === 401) clearBuyerCookie(res); // stale or expired cookie
  return res;
}
