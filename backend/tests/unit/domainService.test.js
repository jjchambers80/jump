// Unit tests for DomainService (spec 007 phase 3): hostname normalization,
// DNS verification and status transitions — Prisma, DNS and Railway mocked.

import { jest } from '@jest/globals';

const db = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  delete: jest.fn(),
};
jest.unstable_mockModule('@jump/db', () => ({
  prisma: { organizationDomain: db, $transaction: (ops) => Promise.all(ops) },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const railway = { isConfigured: jest.fn(() => false), createCustomDomain: jest.fn(), getCustomDomainStatus: jest.fn(), deleteCustomDomain: jest.fn() };
jest.unstable_mockModule('../../src/lib/railwayDomains.js', () => railway);

const { default: service, normalizeHostname } = await import('../../src/services/DomainService.js');

const base = {
  id: 'dom-1',
  organizationId: 'org-1',
  hostname: 'tickets.example.com',
  status: 'PENDING',
  verificationToken: 'abc123',
  cnameTarget: 'frontend-production.up.railway.app',
  isPrimary: true,
  railwayDomainId: null,
  verifiedAt: null,
  failingSince: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: new Date(),
};

function dnsWith({ txt, cname }) {
  service._dns = {
    resolveTxt: txt instanceof Error ? jest.fn().mockRejectedValue(txt) : jest.fn().mockResolvedValue(txt),
    resolveCname: cname instanceof Error ? jest.fn().mockRejectedValue(cname) : jest.fn().mockResolvedValue(cname),
  };
}
const nxdomain = () => Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });

describe('normalizeHostname', () => {
  const OLD = process.env.FRONTEND_URL;
  beforeAll(() => { process.env.FRONTEND_URL = 'https://app.jump.events,http://localhost:3001'; });
  afterAll(() => { process.env.FRONTEND_URL = OLD; });

  it('lowercases and strips scheme, port, path, trailing dot', () => {
    expect(normalizeHostname(' HTTPS://Tickets.Example.com:443/foo?x=1 ')).toBe('tickets.example.com');
    expect(normalizeHostname('tickets.example.com.')).toBe('tickets.example.com');
  });
  it('rejects apex domains, IPs, garbage, and empty', () => {
    expect(() => normalizeHostname('example.com')).toThrow(/subdomain/);
    expect(() => normalizeHostname('203.0.113.7')).toThrow();
    expect(() => normalizeHostname('not a host')).toThrow();
    expect(() => normalizeHostname('')).toThrow(/required/);
  });
  it('rejects platform hosts', () => {
    expect(() => normalizeHostname('app.jump.events')).toThrow(/platform/);
    expect(() => normalizeHostname('evil.app.jump.events')).toThrow(/platform/);
    expect(() => normalizeHostname('x.up.railway.app')).toThrow(/platform/);
  });
});

describe('DomainService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service._invalidate();
    railway.isConfigured.mockReturnValue(false);
    db.update.mockImplementation(async ({ data }) => ({ ...base, ...data }));
  });

  describe('addDomain', () => {
    it('creates a PENDING primary domain with a token and the default CNAME target', async () => {
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(0);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      const out = await service.addDomain('org-1', 'Tickets.Example.com');
      const data = db.create.mock.calls[0][0].data;
      expect(data.hostname).toBe('tickets.example.com');
      expect(data.verificationToken).toMatch(/^[0-9a-f]{32}$/);
      expect(data.isPrimary).toBe(true);
      expect(out.dnsRecords).toEqual([
        { type: 'CNAME', name: 'tickets.example.com', value: data.cnameTarget },
        { type: 'TXT', name: '_jump-verify.tickets.example.com', value: `jump-verify=${data.verificationToken}` },
      ]);
    });
    it('is not primary when the org already has a domain', async () => {
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(1);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      await service.addDomain('org-1', 'b.example.com');
      expect(db.create.mock.calls[0][0].data.isPrimary).toBe(false);
    });
    it('409s on a hostname already registered', async () => {
      db.findUnique.mockResolvedValue(base);
      await expect(service.addDomain('org-2', 'tickets.example.com')).rejects.toMatchObject({ statusCode: 409 });
    });
    it('uses Railway CNAME target and stores the Railway id when configured', async () => {
      railway.isConfigured.mockReturnValue(true);
      railway.createCustomDomain.mockResolvedValue({ id: 'rw-1', cnameTarget: 'Abc.Up.Railway.App.' });
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(0);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      await service.addDomain('org-1', 'tickets.example.com');
      const data = db.create.mock.calls[0][0].data;
      expect(data.railwayDomainId).toBe('rw-1');
      expect(data.cnameTarget).toBe('abc.up.railway.app');
    });
  });

  describe('verifyDomain', () => {
    it('activates on TXT + CNAME proof when Railway is not configured', async () => {
      db.findFirst.mockResolvedValue(base);
      dnsWith({ txt: [['jump-verify=abc123']], cname: ['frontend-production.up.railway.app.'] });
      const out = await service.verifyDomain('org-1', 'dom-1');
      const data = db.update.mock.calls[0][0].data;
      expect(data.status).toBe('ACTIVE');
      expect(data.verifiedAt).toBeInstanceOf(Date);
      expect(data.lastError).toBeNull();
      expect(out.status).toBe('ACTIVE');
    });
    it('accepts a TXT record split into chunks', async () => {
      db.findFirst.mockResolvedValue(base);
      dnsWith({ txt: [['jump-veri', 'fy=abc123']], cname: ['frontend-production.up.railway.app'] });
      await service.verifyDomain('org-1', 'dom-1');
      expect(db.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    });
    it('stays PENDING with a readable error when records are missing or wrong', async () => {
      db.findFirst.mockResolvedValue(base);
      dnsWith({ txt: nxdomain(), cname: ['somewhere-else.example.net'] });
      await service.verifyDomain('org-1', 'dom-1');
      const data = db.update.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.lastError).toMatch(/TXT .*not found/);
      expect(data.lastError).toMatch(/CNAME .*somewhere-else/);
    });
    it('VERIFIED (not ACTIVE) while Railway has no certificate yet', async () => {
      railway.getCustomDomainStatus.mockResolvedValue({ certificateReady: false, dnsOk: true });
      db.findFirst.mockResolvedValue({ ...base, railwayDomainId: 'rw-1' });
      dnsWith({ txt: [['jump-verify=abc123']], cname: ['frontend-production.up.railway.app'] });
      await service.verifyDomain('org-1', 'dom-1');
      const data = db.update.mock.calls[0][0].data;
      expect(data.status).toBe('VERIFIED');
      expect(data.lastError).toMatch(/certificate/);
    });
    it('keeps an ACTIVE domain serving through the 72h grace, then FAILED', async () => {
      const verified = { ...base, status: 'ACTIVE', verifiedAt: new Date(Date.now() - 10 * 86400e3) };
      dnsWith({ txt: nxdomain(), cname: nxdomain() });

      db.findFirst.mockResolvedValue({ ...verified, failingSince: null });
      await service.verifyDomain('org-1', 'dom-1');
      expect(db.update.mock.calls[0][0].data.status).toBe('ACTIVE');
      expect(db.update.mock.calls[0][0].data.failingSince).toBeInstanceOf(Date);

      db.findFirst.mockResolvedValue({ ...verified, failingSince: new Date(Date.now() - 73 * 3600e3) });
      await service.verifyDomain('org-1', 'dom-1');
      expect(db.update.mock.calls[1][0].data.status).toBe('FAILED');
    });
    it('404s for a domain owned by another organization', async () => {
      db.findFirst.mockResolvedValue(null);
      await expect(service.verifyDomain('org-2', 'dom-1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('resolveHost / isActiveOrigin', () => {
    it('resolves ACTIVE hosts (case/port-insensitive) and caches misses', async () => {
      db.findFirst.mockResolvedValueOnce({ organizationId: 'org-1' }).mockResolvedValueOnce(null);
      expect(await service.resolveHost('Tickets.Example.com:443')).toBe('org-1');
      expect(await service.resolveHost('tickets.example.com')).toBe('org-1'); // cached
      expect(await service.resolveHost('nope.example.com')).toBeNull();
      expect(await service.resolveHost('nope.example.com')).toBeNull(); // cached miss
      expect(db.findFirst).toHaveBeenCalledTimes(2);
    });
    it('allows origins of ACTIVE hostnames only', async () => {
      db.findMany.mockResolvedValue([{ hostname: 'tickets.example.com' }]);
      expect(await service.isActiveOrigin('https://tickets.example.com')).toBe(true);
      expect(await service.isActiveOrigin('https://other.example.com')).toBe(false);
      expect(await service.isActiveOrigin('garbage')).toBe(false);
    });
  });
});
