// POST /api/buyer/me/tickets/:ticketId/refund — self-service refund for a ticket this buyer owns.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function POST(_req: Request, { params }: { params: { ticketId: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { status, body } = await backendBuyerFetch(
    `/buyer/me/tickets/${encodeURIComponent(params.ticketId)}/refund`,
    { method: 'POST', body: {}, token }
  );
  return NextResponse.json(body ?? {}, { status });
}
