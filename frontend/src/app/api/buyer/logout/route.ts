// POST /api/buyer/logout — clear the buyer session cookie.
import { NextResponse } from 'next/server';
import { clearBuyerCookie } from '@/lib/buyerSession';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearBuyerCookie(res);
  return res;
}
