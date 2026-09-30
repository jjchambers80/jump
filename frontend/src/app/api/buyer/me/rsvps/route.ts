// GET /api/buyer/me/rsvps — this buyer's RSVPs at the organization (spec 040).
import { proxyBuyer } from '@/lib/buyerSession';

export async function GET() {
  return proxyBuyer('/buyer/me/rsvps');
}
