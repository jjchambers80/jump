// POST /api/buyer/me/applications/:id/booth { boothId } → hold + buy a booth (spec 014 phase 2).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clientIpFrom, getBuyerToken } from '@/lib/buyerSession';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch(`/buyer/me/applications/${encodeURIComponent(params.id)}/booth`, {
    method: 'POST',
    body: { boothId: payload.boothId },
    token,
    clientIp: clientIpFrom(req),
  });
  return NextResponse.json(body ?? {}, { status });
}
