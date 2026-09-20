// Spec 030 D: user-agent labelling, IP hashing and the revocation cache path.

import { jest } from '@jest/globals';

const rows = new Map();
const cache = new Map();
jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    userSession: {
      findUnique: jest.fn(async ({ where }) => rows.get(where.id) ?? null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findFirst: jest.fn(async () => null),
    },
  },
}));
jest.unstable_mockModule('../../src/utils/cache.js', () => ({
  cacheGet: jest.fn(async (key) => cache.get(key) ?? null),
  cacheSet: jest.fn(async (key, value) => { cache.set(key, value); }),
  cacheInvalidate: jest.fn(),
}));

const { default: sessionService, describeUserAgent, deviceLabel, hashSessionIp } = await import(
  '../../src/services/SessionService.js'
);
const { prisma } = await import('@jump/db');

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('describeUserAgent / deviceLabel', () => {
  it('labels a desktop browser', () => {
    const d = describeUserAgent(CHROME_MAC);
    expect(d).toEqual({ deviceType: 'desktop', os: 'macOS', browser: 'Chrome' });
    expect(deviceLabel(d)).toBe('macOS · Chrome');
  });
  it('labels a phone', () => {
    const d = describeUserAgent(SAFARI_IPHONE);
    expect(d.deviceType).toBe('mobile');
    expect(d.os).toBe('iOS');
    expect(deviceLabel(d)).toMatch(/iOS · (Mobile )?Safari/);
  });
  it('handles a missing user agent', () => {
    expect(describeUserAgent(null)).toEqual({ deviceType: null, os: null, browser: null });
    expect(deviceLabel({})).toBe('Unknown device');
  });
});

describe('hashSessionIp', () => {
  it('is stable across days and never the raw address', () => {
    const a = hashSessionIp('203.0.113.9', 'salt');
    expect(a).toBe(hashSessionIp('203.0.113.9', 'salt'));
    expect(a).not.toContain('203.0.113.9');
    expect(hashSessionIp('203.0.113.9', 'other')).not.toBe(a);
    expect(hashSessionIp(null)).toBeNull();
  });
});

describe('isRevoked', () => {
  beforeEach(() => {
    rows.clear();
    cache.clear();
    sessionService._revoked.clear();
    prisma.userSession.findUnique.mockClear();
  });

  it('reads the DB once, then the local cache', async () => {
    rows.set('s1', { revokedAt: null });
    expect(await sessionService.isRevoked('s1')).toBe(false);
    expect(await sessionService.isRevoked('s1')).toBe(false);
    expect(prisma.userSession.findUnique).toHaveBeenCalledTimes(1);
  });

  it('treats a missing row as revoked', async () => {
    expect(await sessionService.isRevoked('gone')).toBe(true);
  });

  it('uses Redis before the DB', async () => {
    cache.set('session:revoked:s2', { revoked: true });
    expect(await sessionService.isRevoked('s2')).toBe(true);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('revoke marks every cache layer so the next request is refused', async () => {
    rows.set('s3', { revokedAt: null });
    expect(await sessionService.isRevoked('s3')).toBe(false);
    await sessionService.revoke('u1', 's3');
    expect(await sessionService.isRevoked('s3')).toBe(true);
    expect(cache.get('session:revoked:s3')).toEqual({ revoked: true });
  });
});
