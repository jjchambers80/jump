// GET /api/buyer/me/orders/:orderId/receipt — printable receipt for one of the buyer's paid orders (spec 040).
import { proxyBuyer } from '@/lib/buyerSession';

export async function GET(_req: Request, { params }: { params: { orderId: string } }) {
  return proxyBuyer(`/buyer/me/orders/${encodeURIComponent(params.orderId)}/receipt`);
}
