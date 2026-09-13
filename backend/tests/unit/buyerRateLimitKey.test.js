// The buyer sign-in rate limiter keys on the client IP forwarded by the Next
// proxy, but only when it is signed with the shared AUTH_SECRET.

import { createHmac } from 'crypto';
import { clientIpForRateLimit } from '../../src/api/routes/buyerAuth.js';

const sign = (ip, secret = process.env.AUTH_SECRET) => createHmac('sha256', secret).update(ip).digest('hex');
const reqWith = (headers, ip = '10.0.0.9') => ({
  ip,
  get: (name) => headers[name.toLowerCase()],
});

describe('clientIpForRateLimit', () => {
  it('uses the forwarded IP when the signature matches', () => {
    const req = reqWith({ 'x-jump-client-ip': '203.0.113.7', 'x-jump-client-ip-sig': sign('203.0.113.7') });
    expect(clientIpForRateLimit(req)).toBe('203.0.113.7');
  });

  it('falls back to req.ip when the signature is wrong', () => {
    const req = reqWith({ 'x-jump-client-ip': '203.0.113.7', 'x-jump-client-ip-sig': sign('203.0.113.7', 'other') });
    expect(clientIpForRateLimit(req)).toBe('10.0.0.9');
  });

  it('falls back to req.ip when the header is unsigned or absent', () => {
    expect(clientIpForRateLimit(reqWith({ 'x-jump-client-ip': '203.0.113.7' }))).toBe('10.0.0.9');
    expect(clientIpForRateLimit(reqWith({}))).toBe('10.0.0.9');
  });

  it('does not accept a signature for a different IP', () => {
    const req = reqWith({ 'x-jump-client-ip': '198.51.100.1', 'x-jump-client-ip-sig': sign('203.0.113.7') });
    expect(clientIpForRateLimit(req)).toBe('10.0.0.9');
  });
});
