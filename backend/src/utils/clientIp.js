// The real client IP behind the Next proxy (spec 007 / spec 020).

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Client IP for rate limiting. Browser traffic reaches this route through the
 * Next route handler (server-to-server), so req.ip would be the frontend's
 * egress for every buyer. The proxy forwards the real address in
 * X-Jump-Client-Ip signed with the shared AUTH_SECRET; anything unsigned or
 * mis-signed falls back to req.ip.
 */
export function clientIpForRateLimit(req) {
  const ip = req.get('x-jump-client-ip');
  const sig = req.get('x-jump-client-ip-sig');
  const secret = process.env.AUTH_SECRET;
  if (ip && sig && secret) {
    const expected = createHmac('sha256', secret).update(ip).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return ip;
  }
  return req.ip;
}
