// POST /api/buyer/me/email/confirm { token } — the link from the new address (spec 040).
// The token is the proof: no session needed, the link often opens in another browser.
import { NextResponse } from 'next/server';
import { backendBuyerFetch } from '@/lib/buyerSession';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch('/buyer/me/email/confirm', { method: 'POST', body: { token: payload.token } });
  return NextResponse.json(body ?? {}, { status });
}
