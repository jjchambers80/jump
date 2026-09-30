// POST /api/buyer/me/erasure/confirm { code } — schedule erasure after the grace period (spec 040 card D).
import { proxyBuyer } from '@/lib/buyerSession';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  return proxyBuyer('/buyer/me/erasure/confirm', { method: 'POST', body: { code: payload.code } });
}
