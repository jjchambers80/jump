// POST /api/buyer/me/email { newEmail } — start a verified email change (spec 040).
// DELETE — withdraw the pending change.
import { proxyBuyer } from '@/lib/buyerSession';

export async function POST(req: Request) {
  return proxyBuyer('/buyer/me/email', { method: 'POST', body: await req.json().catch(() => ({})) });
}

export async function DELETE() {
  return proxyBuyer('/buyer/me/email', { method: 'DELETE' });
}
