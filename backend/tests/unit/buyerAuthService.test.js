// Unit tests for BuyerAuthService (spec 007 phase 2)
// Token hashing, single use, expiry, and session typing — Prisma mocked.

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

const mockTokenCreate = jest.fn();
const mockTokenUpdateMany = jest.fn();
const mockTokenFindUnique = jest.fn();
const mockTokenCount = jest.fn();
const mockContactFindUnique = jest.fn();

const tokenModel = {
  create: mockTokenCreate,
  updateMany: mockTokenUpdateMany,
  findUnique: mockTokenFindUnique,
  count: mockTokenCount,
};
jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    buyerLoginToken: tokenModel,
    contact: { findUnique: mockContactFindUnique },
    // Interactive transaction: hand the callback a client with the same mocks
    $transaction: (fn) => fn({ buyerLoginToken: tokenModel }),
  },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { default: service, BUYER_SESSION_TYP } = await import('../../src/services/BuyerAuthService.js');

const contact = { id: 'contact-1', organizationId: 'org-1', email: 'b@x.test' };
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

describe('BuyerAuthService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('issueToken', () => {
    it('stores only the sha256 of the raw token and applies the purpose TTL', async () => {
      mockTokenCreate.mockResolvedValue({});
      const before = Date.now();
      const { rawToken, expiresAt } = await service.issueToken(contact, 'LOGIN');

      expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
      const data = mockTokenCreate.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(sha256(rawToken));
      expect(data.tokenHash).not.toContain(rawToken);
      expect(data.purpose).toBe('LOGIN');
      expect(data.organizationId).toBe('org-1');
      const ttl = expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(14 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 50);
    });

    it('gives WELCOME tokens a 7-day TTL', async () => {
      mockTokenCreate.mockResolvedValue({});
      const before = Date.now();
      const { expiresAt } = await service.issueToken(contact, 'WELCOME');
      expect(expiresAt.getTime() - before).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    });

    it('rejects unknown purposes', async () => {
      await expect(service.issueToken(contact, 'RESET')).rejects.toThrow(/purpose/);
    });
  });

  describe('requestLogin', () => {
    it('issues nothing for an unknown email', async () => {
      mockContactFindUnique.mockResolvedValue(null);
      await expect(service.requestLogin('org-1', 'nobody@x.test')).resolves.toEqual({ issued: false });
      expect(mockTokenCreate).not.toHaveBeenCalled();
    });

    it('issues nothing for a guest contact (no account)', async () => {
      mockContactFindUnique.mockResolvedValue({ ...contact, accountCreatedAt: null });
      await expect(service.requestLogin('org-1', contact.email)).resolves.toEqual({ issued: false });
    });

    it('looks the contact up by organizationId + lowercased email', async () => {
      mockContactFindUnique.mockResolvedValue(null);
      await service.requestLogin('org-1', 'MiXed@X.Test');
      expect(mockContactFindUnique.mock.calls[0][0].where).toEqual({
        organizationId_email: { organizationId: 'org-1', email: 'mixed@x.test' },
      });
    });

    it('issues a LOGIN token for a login-enabled contact under the rate cap', async () => {
      mockContactFindUnique.mockResolvedValue({ ...contact, accountCreatedAt: new Date() });
      mockTokenCount.mockResolvedValue(2);
      mockTokenCreate.mockResolvedValue({});
      const res = await service.requestLogin('org-1', contact.email);
      expect(res.issued).toBe(true);
      expect(res.rawToken).toBeTruthy();
      expect(mockTokenCreate.mock.calls[0][0].data.purpose).toBe('LOGIN');
    });

    it('refuses to issue once 3 LOGIN tokens exist in the window', async () => {
      mockContactFindUnique.mockResolvedValue({ ...contact, accountCreatedAt: new Date() });
      mockTokenCount.mockResolvedValue(3);
      await expect(service.requestLogin('org-1', contact.email)).resolves.toEqual({ issued: false });
      expect(mockTokenCreate).not.toHaveBeenCalled();
    });
  });

  describe('consumeToken', () => {
    it('claims the token atomically and returns the buyer identity', async () => {
      mockTokenUpdateMany.mockResolvedValue({ count: 1 });
      mockTokenFindUnique.mockResolvedValue({ purpose: 'WELCOME', contact });

      const buyer = await service.consumeToken('raw-token');

      const where = mockTokenUpdateMany.mock.calls[0][0].where;
      expect(where.tokenHash).toBe(sha256('raw-token'));
      expect(where.usedAt).toBeNull();
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
      expect(buyer).toEqual({
        contactId: 'contact-1',
        organizationId: 'org-1',
        email: 'b@x.test',
        purpose: 'WELCOME',
      });
    });

    it('rejects when nothing was claimed (unknown, used, or expired)', async () => {
      mockTokenUpdateMany.mockResolvedValue({ count: 0 });
      await expect(service.consumeToken('raw-token')).rejects.toMatchObject({ statusCode: 401 });
      expect(mockTokenFindUnique).not.toHaveBeenCalled();
    });

    it('rejects empty input without touching the database', async () => {
      await expect(service.consumeToken('')).rejects.toMatchObject({ statusCode: 401 });
      await expect(service.consumeToken(undefined)).rejects.toMatchObject({ statusCode: 401 });
      expect(mockTokenUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('sessions', () => {
    it('round-trips a buyer session with typ buyer', () => {
      const token = service.signSession({ contactId: 'c1', organizationId: 'o1', email: 'e@x.test' });
      const decoded = jwt.decode(token);
      expect(decoded.typ).toBe(BUYER_SESSION_TYP);
      expect(service.verifySession(token)).toEqual({ contactId: 'c1', organizationId: 'o1', email: 'e@x.test' });
    });

    it('rejects a staff (Auth.js) token signed with the same secret', () => {
      const staff = jwt.sign({ sub: 'user-1', role: 'ADMIN', email: 's@x.test' }, process.env.AUTH_SECRET, {
        algorithm: 'HS256',
      });
      expect(() => service.verifySession(staff)).toThrow(/Not a buyer session/);
    });

    it('rejects a tampered or foreign-signed token', () => {
      const forged = jwt.sign({ sub: 'c1', org: 'o1', typ: 'buyer' }, 'wrong-secret', { algorithm: 'HS256' });
      expect(() => service.verifySession(forged)).toThrow(/Invalid or expired/);
    });
  });
});
