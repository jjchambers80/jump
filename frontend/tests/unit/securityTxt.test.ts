import { afterEach, describe, expect, it } from 'vitest';
import { GET, dynamic } from '../../src/app/well-known/security.txt/route';

const ORIGINAL = process.env.SECURITY_CONTACT_EMAIL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SECURITY_CONTACT_EMAIL;
  else process.env.SECURITY_CONTACT_EMAIL = ORIGINAL;
});

describe('/.well-known/security.txt', () => {
  it('is rendered per request, so the email and Expires are never baked into the build', () => {
    // Without this Next 14 statically renders the handler (it reads no
    // request-scoped API) and SECURITY_CONTACT_EMAIL only takes effect on a rebuild.
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s while SECURITY_CONTACT_EMAIL is unset', async () => {
    delete process.env.SECURITY_CONTACT_EMAIL;
    const res = GET();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('serves the RFC 9116 fields once SECURITY_CONTACT_EMAIL is set', async () => {
    process.env.SECURITY_CONTACT_EMAIL = 'security@jump.events';
    const res = GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    const lines = (await res.text()).split('\n');
    expect(lines).toContain('Contact: mailto:security@jump.events');
    expect(lines).toContain('Preferred-Languages: en');

    const expires = lines.find((line) => line.startsWith('Expires: '))?.slice('Expires: '.length);
    expect(expires).toBeDefined();
    // RFC 9116 §2.5.5: must be in the future. One year out, computed per request.
    const ms = Date.parse(expires!) - Date.now();
    expect(ms).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(367 * 24 * 60 * 60 * 1000);
  });
});
