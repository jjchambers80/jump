// GET /api/buyer/me — profile for the signed-in buyer, `null` when signed out.
// Signed out is a normal answer for a storefront visitor, not an error: a 401
// here put a red console line on every guest page view.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clearBuyerCookie, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json(null);

  const { status, body } = await backendBuyerFetch('/buyer/me', { token });
  if (status === 401) {
    const res = NextResponse.json(null);
    clearBuyerCookie(res); // stale or expired cookie
    return res;
  }
  return NextResponse.json(body ?? {}, { status });
}
