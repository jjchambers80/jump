// POST /api/buyer/me/applications/:id/select { boothId?, addOns?, useSavedCard? }
// → choose a space (spec 037 phase 5): hold a booth or the category, open the order.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clientIpFrom, getBuyerToken } from '@/lib/buyerSession';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const payload = await req.json().catch(() => ({}));
  const body: Record<string, unknown> = {};
  if (payload.boothId !== undefined) body.boothId = payload.boothId;
  if (payload.addOns !== undefined) body.addOns = payload.addOns;
  if (payload.useSavedCard !== undefined) body.useSavedCard = payload.useSavedCard;
  const res = await backendBuyerFetch(`/buyer/me/applications/${encodeURIComponent(params.id)}/select`, {
    method: 'POST',
    body,
    token,
    clientIp: clientIpFrom(req),
  });
  return NextResponse.json(res.body ?? {}, { status: res.status });
}
