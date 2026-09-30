// GET /api/buyer/me/export — "Download my data" (spec 040 PA-10): the backend's
// JSON file passed through as an attachment, never cached.
import { NextResponse } from 'next/server';
import { backendBuyerFetch, clearBuyerCookie, getBuyerToken } from '@/lib/buyerSession';

export async function GET() {
  const token = getBuyerToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { status, body } = await backendBuyerFetch('/buyer/me/export', { token });
  if (status !== 200) {
    const res = NextResponse.json(body ?? {}, { status });
    if (status === 401) clearBuyerCookie(res);
    return res;
  }
  const org = String(body?.organization?.slug || body?.organization?.name || 'organization')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const date = String(body?.generatedAt || new Date().toISOString()).slice(0, 10);
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${org || 'organization'}-my-data-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
