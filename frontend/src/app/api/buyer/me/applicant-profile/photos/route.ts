// POST /api/buyer/me/applicant-profile/photos (spec 011 phase 3): forwards the
// multipart body as-is; backendBuyerFetch is JSON-only.
import { NextResponse } from 'next/server';
import { getBuyerToken } from '@/lib/buyerSession';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export async function POST(req: Request) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  const res = await fetch(`${API_URL}/buyer/me/applicant-profile/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body ?? {}, { status: res.status });
}
