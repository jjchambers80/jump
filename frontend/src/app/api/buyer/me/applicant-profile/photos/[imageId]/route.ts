// DELETE /api/buyer/me/applicant-profile/photos/:imageId (spec 011 phase 3).
import { NextResponse } from 'next/server';
import { backendBuyerFetch, getBuyerToken } from '@/lib/buyerSession';

export async function DELETE(_req: Request, { params }: { params: { imageId: string } }) {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch(`/buyer/me/applicant-profile/photos/${encodeURIComponent(params.imageId)}`, { method: 'DELETE', token });
  return NextResponse.json(body ?? {}, { status });
}
