// GET /api/buyer/me/tickets — this buyer's tickets at their organization.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { status, body } = await backendBuyerFetch('/buyer/me/tickets', { token });
  return NextResponse.json(body ?? {}, { status });
}
