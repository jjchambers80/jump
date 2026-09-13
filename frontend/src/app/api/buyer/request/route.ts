// POST /api/buyer/request — ask the backend to email a sign-in link.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clientIpFrom } from '@/lib/buyerSession';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch('/buyer/auth/request', {
    method: 'POST',
    body: { organizationId: payload.organizationId, email: payload.email },
    clientIp: clientIpFrom(req),
  });
  return NextResponse.json(body ?? {}, { status });
}
