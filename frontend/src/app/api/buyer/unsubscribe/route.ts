// GET/POST /api/buyer/unsubscribe?t= — one-click unsubscribe without signing in (spec 040).
// GET describes what the link would do; POST does it. The page asks for one
// click so link scanners in mail filters never unsubscribe anyone.
import { NextResponse } from 'next/server';
import { backendBuyerFetch } from '@/lib/buyerSession';

function tokenFrom(req: Request) {
  return new URL(req.url).searchParams.get('t') ?? '';
}

export async function GET(req: Request) {
  const { status, body } = await backendBuyerFetch(`/buyer/unsubscribe?t=${encodeURIComponent(tokenFrom(req))}`);
  return NextResponse.json(body ?? {}, { status });
}

export async function POST(req: Request) {
  const { status, body } = await backendBuyerFetch(`/buyer/unsubscribe?t=${encodeURIComponent(tokenFrom(req))}`, { method: 'POST', body: {} });
  return NextResponse.json(body ?? {}, { status });
}
