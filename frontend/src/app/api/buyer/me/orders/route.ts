// GET /api/buyer/me/orders — this buyer's orders at their organization.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function GET(req: Request) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const search = new URL(req.url).search;
  const { status, body } = await backendBuyerFetch(`/buyer/me/orders${search}`, { token });
  return NextResponse.json(body ?? {}, { status });
}
