// PATCH /api/buyer/me/preferences { emailSubscribed } — marketing email from this organization (spec 040).
import { proxyBuyer } from '@/lib/buyerSession';

export async function PATCH(req: Request) {
  return proxyBuyer('/buyer/me/preferences', { method: 'PATCH', body: await req.json().catch(() => ({})) });
}
