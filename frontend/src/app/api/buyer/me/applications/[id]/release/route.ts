// POST /api/buyer/me/applications/:id/release → give back a held space (spec 037 phase 5).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clientIpFrom, getBuyerToken } from '@/lib/buyerSession';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch(`/buyer/me/applications/${encodeURIComponent(params.id)}/release`, {
    method: 'POST',
    token,
    clientIp: clientIpFrom(req),
  });
  return NextResponse.json(body ?? {}, { status });
}
