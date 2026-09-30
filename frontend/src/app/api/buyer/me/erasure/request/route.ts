// POST /api/buyer/me/erasure/request — email the code that confirms "Delete my data" (spec 040 card D).
import { proxyBuyer } from '@/lib/buyerSession';

export async function POST() {
  return proxyBuyer('/buyer/me/erasure/request', { method: 'POST', body: {} });
}
