import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSessionToken, encodeSessionToken } from '@/lib/authJwt';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-key-must-be-at-least-32-chars';
});

describe('session token codec (spec 030 D)', () => {
  it('round-trips the sid and preference claims', async () => {
    const token = await encodeSessionToken({
      sub: 'u1',
      email: 'a@example.com',
      role: 'ADMIN',
      name: 'Ada',
      organizationId: 'org1',
      locale: 'en-US',
      timeZone: 'America/New_York',
      picture: '/images/i/h/thumb',
      sid: 'sess_1',
    });
    const claims = await decodeSessionToken(token);
    expect(claims?.sub).toBe('u1');
    expect(claims?.sid).toBe('sess_1');
    expect(claims?.locale).toBe('en-US');
    expect(claims?.timeZone).toBe('America/New_York');
    expect(claims?.picture).toBe('/images/i/h/thumb');
  });

  it('omits sid for legacy tokens and rejects a tampered signature', async () => {
    const token = await encodeSessionToken({ sub: 'u1', role: 'ORGANIZER' });
    const claims = await decodeSessionToken(token);
    expect(claims?.sid).toBeUndefined();
    expect(await decodeSessionToken(`${token}x`)).toBeNull();
  });
});
