// POST /api/buyer/me/applications/:id/pay → { url } (spec 011 phase 2).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch(`/buyer/me/applications/${encodeURIComponent(params.id)}/pay`, { method: 'POST', token });
  return NextResponse.json(body ?? {}, { status });
}
