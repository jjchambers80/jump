// GET /api/buyer/me/erasure — what "Delete my data" would do and what blocks it (spec 040 card D).
// DELETE — cancel a scheduled erasure during the grace period.
import { proxyBuyer } from '@/lib/buyerSession';

export async function GET() {
  return proxyBuyer('/buyer/me/erasure');
}

export async function DELETE() {
  return proxyBuyer('/buyer/me/erasure', { method: 'DELETE' });
}
