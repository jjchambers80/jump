// POST /api/buyer/me/rsvps/:id/cancel (spec 040).
import { proxyBuyer } from '@/lib/buyerSession';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return proxyBuyer(`/buyer/me/rsvps/${encodeURIComponent(params.id)}/cancel`, { method: 'POST', body: {} });
}
