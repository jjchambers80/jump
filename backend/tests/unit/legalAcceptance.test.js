// Unit tests for the spec 024 phase 3 legal helpers: version checks, the IP
// hash, the presented texts.

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const {
  default: service,
  hashIp,
  requestMeta,
} = await import('../../src/services/LegalAcceptanceService.js');
const { LEGAL_VERSIONS, cardAuthorizationText, applyConsentText, checkoutAcceptanceRequired } =
  await import('../../src/config/legal.js');

const current = (document) => ({
  document,
  version:
    LEGAL_VERSIONS[
      { TERMS: 'terms', PRIVACY: 'privacy', CARD_AUTHORIZATION: 'cardAuthorization' }[document]
    ],
});

describe('assertCurrent', () => {
  test('returns the required documents in required order, dropping extras it checked', () => {
    const out = service.assertCurrent(
      [current('CARD_AUTHORIZATION'), current('PRIVACY'), current('TERMS')],
      ['TERMS', 'PRIVACY']
    );
    expect(out).toEqual([current('TERMS'), current('PRIVACY')]);
  });

  test('lower-case document names are accepted', () => {
    expect(
      service.assertCurrent([
        { document: 'terms', version: LEGAL_VERSIONS.terms },
        { document: 'privacy', version: LEGAL_VERSIONS.privacy },
      ])
    ).toHaveLength(2);
  });

  test.each([
    [undefined, 'LEGAL_ACCEPTANCE_REQUIRED'],
    ['nope', 'LEGAL_ACCEPTANCE_REQUIRED'],
    [[current('TERMS')], 'LEGAL_ACCEPTANCE_REQUIRED'],
    [[current('TERMS'), { document: 'PRIVACY', version: 'old' }], 'LEGAL_VERSION_STALE'],
    [
      [current('TERMS'), current('PRIVACY'), { document: 'NDA', version: '1' }],
      'LEGAL_ACCEPTANCE_REQUIRED',
    ],
    [Array.from({ length: 11 }, () => current('TERMS')), 'LEGAL_ACCEPTANCE_REQUIRED'],
  ])('refuses %j with %s', (input, code) => {
    expect(() => service.assertCurrent(input)).toThrow(
      expect.objectContaining({ code, statusCode: 400 })
    );
  });

  test('card authorization can be required', () => {
    expect(() =>
      service.assertCurrent(
        [current('TERMS'), current('PRIVACY')],
        ['TERMS', 'PRIVACY', 'CARD_AUTHORIZATION']
      )
    ).toThrow(/card authorization/);
  });
});

describe('hashIp / requestMeta', () => {
  test('same address and day → same hash; different day or address → different; never the raw address', () => {
    const a = hashIp('203.0.113.9', { salt: 's', now: new Date('2026-09-19T10:00:00Z') });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(hashIp('203.0.113.9', { salt: 's', now: new Date('2026-09-19T23:00:00Z') }));
    expect(a).not.toBe(hashIp('203.0.113.9', { salt: 's', now: new Date('2026-09-20T01:00:00Z') }));
    expect(a).not.toBe(
      hashIp('203.0.113.10', { salt: 's', now: new Date('2026-09-19T10:00:00Z') })
    );
    expect(a).not.toContain('203');
    expect(hashIp(null)).toBeNull();
  });

  test('requestMeta truncates the user agent and hashes the client IP', () => {
    const meta = requestMeta({
      ip: '10.0.0.1',
      get: (h) => (h === 'user-agent' ? 'x'.repeat(300) : undefined),
    });
    expect(meta.userAgent).toHaveLength(255);
    expect(meta.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(requestMeta(null)).toEqual({ ipHash: null, userAgent: null });
  });
});

describe('texts and flags', () => {
  test('card authorization names the amount, the trigger and the window', () => {
    const text = cardAuthorizationText({
      amount: 288.5,
      paymentDueDays: 1,
      organizationName: 'Geek Expo',
    });
    expect(text).toContain('Geek Expo');
    expect(text).toContain('$288.50');
    expect(text).toContain('only if my application is approved');
    expect(text).toContain('1 day ');
    expect(cardAuthorizationText({ amount: 10 })).toContain('the organizer');
  });

  test('consent text names the organizer; checkout acceptance is optional until the flag flips', () => {
    expect(applyConsentText({ organizationName: 'Geek Expo' })).toMatch(
      /^I agree to Geek Expo and Jump collecting/
    );
    const before = process.env.LEGAL_ACCEPTANCE_REQUIRED;
    delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    expect(checkoutAcceptanceRequired()).toBe(false);
    process.env.LEGAL_ACCEPTANCE_REQUIRED = 'true';
    expect(checkoutAcceptanceRequired()).toBe(true);
    if (before === undefined) delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    else process.env.LEGAL_ACCEPTANCE_REQUIRED = before;
  });
});
