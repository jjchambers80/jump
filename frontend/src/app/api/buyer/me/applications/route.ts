// GET /api/buyer/me/applications — this buyer's applications at their organization (spec 011).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch('/buyer/me/applications', { token });
  return NextResponse.json(body ?? {}, { status });
}
