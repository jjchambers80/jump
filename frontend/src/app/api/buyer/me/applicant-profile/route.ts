// GET/PATCH /api/buyer/me/applicant-profile (spec 011).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch('/buyer/me/applicant-profile', { token });
  return NextResponse.json(body ?? null, { status });
}

export async function PATCH(req: Request) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const payload = await req.json().catch(() => ({}));
  const { status, body } = await backendBuyerFetch('/buyer/me/applicant-profile', { method: 'PATCH', body: payload, token });
  return NextResponse.json(body ?? {}, { status });
}
