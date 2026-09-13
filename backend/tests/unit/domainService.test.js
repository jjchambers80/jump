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

const { default: service, normalizeHostname, txtPrefixFor, zoneOf } = await import('../../src/services/DomainService.js');

const base = {
  id: 'dom-1',
  organizationId: 'org-1',
  hostname: 'tickets.example.com',
  status: 'PENDING',
  verificationHost: '_jump-verify',
  verificationToken: 'jump-verify=abc123',
  certificateStatus: null,
  dnsProvider: null,
  lastDnsSnapshot: null,
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
    service._dns = {}; // no network: provider detection is skipped unless a test installs resolveNs
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
      expect(data.verificationToken).toMatch(/^jump-verify=[0-9a-f]{32}$/);
      expect(data.verificationHost).toBe('_jump-verify');
      expect(data.isPrimary).toBe(true);
      expect(out.dnsRecords).toEqual([
        { key: 'cname', type: 'CNAME', name: 'tickets.example.com', value: data.cnameTarget, currentValue: null, status: 'pending' },
        { key: 'txt', type: 'TXT', name: '_jump-verify.tickets.example.com', value: data.verificationToken, currentValue: null, status: 'pending' },
      ]);
      expect(out.zone).toBe('example.com');
      expect(out.certificateStatus).toBeNull();
      expect(out.dnsProvider).toBeNull();
    });
    it('records the detected DNS provider when the resolver supports NS lookups', async () => {
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(0);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      service._dns = { resolveNs: jest.fn().mockResolvedValue(['kim.ns.cloudflare.com', 'rob.ns.cloudflare.com']) };
      const out = await service.addDomain('org-1', 'tickets.example.com');
      expect(db.create.mock.calls[0][0].data.dnsProvider).toBe('cloudflare');
      expect(out.dnsProvider).toMatchObject({ key: 'cloudflare', name: 'Cloudflare' });
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
    it('uses Railway CNAME target and TXT record and stores the Railway id when configured', async () => {
      railway.isConfigured.mockReturnValue(true);
      railway.createCustomDomain.mockResolvedValue({
        id: 'rw-1',
        cnameTarget: 'Abc.Up.Railway.App.',
        txtHost: '_railway-verify.tickets',
        txtValue: 'railway-verify=deadbeef',
      });
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(0);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      const out = await service.addDomain('org-1', 'tickets.example.com');
      const data = db.create.mock.calls[0][0].data;
      expect(data.railwayDomainId).toBe('rw-1');
      expect(data.cnameTarget).toBe('abc.up.railway.app');
      expect(data.verificationHost).toBe('_railway-verify');
      expect(data.verificationToken).toBe('railway-verify=deadbeef');
      expect(out.dnsRecords[1]).toMatchObject({ type: 'TXT', name: '_railway-verify.tickets.example.com', value: 'railway-verify=deadbeef' });
      expect(out.certificateStatus).toBe('PENDING');
    });
    it('falls back to _jump-verify when Railway returns no TXT record', async () => {
      railway.isConfigured.mockReturnValue(true);
      railway.createCustomDomain.mockResolvedValue({ id: 'rw-2', cnameTarget: 'abc.up.railway.app', txtHost: null, txtValue: null });
      db.findUnique.mockResolvedValue(null);
      db.count.mockResolvedValue(0);
      db.create.mockImplementation(async ({ data }) => ({ ...base, ...data }));
      await service.addDomain('org-1', 'tickets.example.com');
      const data = db.create.mock.calls[0][0].data;
      expect(data.verificationHost).toBe('_jump-verify');
      expect(data.verificationToken).toMatch(/^jump-verify=/);
    });
    it('surfaces a Railway rejection (plan limit, invalid host) as a 400 with its message', async () => {
      railway.isConfigured.mockReturnValue(true);
      railway.createCustomDomain.mockRejectedValue(new Error('Railway API: Custom domain limit reached'));
      db.findUnique.mockResolvedValue(null);
      await expect(service.addDomain('org-1', 'tickets.example.com')).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Custom domain limit reached'),
      });
      expect(db.create).not.toHaveBeenCalled();
    });
  });

  describe('txtPrefixFor / zoneOf', () => {
    it('reduces Railway host labels of any shape to the prefix before the hostname', () => {
      expect(txtPrefixFor('_railway-verify.tickets.example.com', 'tickets.example.com')).toBe('_railway-verify');
      expect(txtPrefixFor('_railway-verify.tickets', 'tickets.example.com')).toBe('_railway-verify');
      expect(txtPrefixFor('_railway-verify', 'tickets.example.com')).toBe('_railway-verify');
      expect(txtPrefixFor('_railway-verify.shop.tickets', 'shop.tickets.example.com')).toBe('_railway-verify');
    });
    it('derives the registrable zone', () => {
      expect(zoneOf('tickets.example.com')).toBe('example.com');
      expect(zoneOf('a.b.example.co.uk')).toBe('example.co.uk');
      expect(zoneOf('example.com')).toBe('example.com');
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
    it('persists a per-record snapshot (current value + status) for the setup page', async () => {
      db.findFirst.mockResolvedValue(base);
      dnsWith({ txt: [['jump-verify=stale']], cname: nxdomain() });
      const out = await service.verifyDomain('org-1', 'dom-1');
      const data = db.update.mock.calls[0][0].data;
      expect(data.lastDnsSnapshot).toEqual({
        txt: { currentValue: 'jump-verify=stale', status: 'invalid' },
        cname: { currentValue: null, status: 'missing' },
      });
      expect(out.dnsRecords).toEqual([
        expect.objectContaining({ key: 'cname', currentValue: null, status: 'missing' }),
        expect.objectContaining({ key: 'txt', currentValue: 'jump-verify=stale', status: 'invalid' }),
      ]);
    });
    it('verifies the TXT at the stored verification host (Railway record)', async () => {
      db.findFirst.mockResolvedValue({ ...base, verificationHost: '_railway-verify', verificationToken: 'railway-verify=xyz' });
      dnsWith({ txt: [['railway-verify=xyz']], cname: ['frontend-production.up.railway.app'] });
      await service.verifyDomain('org-1', 'dom-1');
      expect(service._dns.resolveTxt).toHaveBeenCalledWith('_railway-verify.tickets.example.com');
      expect(db.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    });
    it('returns the stored row without resolving inside the user cooldown; the sweep always checks', async () => {
      const OLD = process.env.DOMAIN_VERIFY_COOLDOWN_MS;
      process.env.DOMAIN_VERIFY_COOLDOWN_MS = '15000';
      try {
        db.findFirst.mockResolvedValue({ ...base, lastCheckedAt: new Date(Date.now() - 2000) });
        dnsWith({ txt: [['jump-verify=abc123']], cname: ['frontend-production.up.railway.app'] });
        const out = await service.verifyDomain('org-1', 'dom-1');
        expect(service._dns.resolveTxt).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(out.status).toBe('PENDING');
        await service.verifyDomain(null, 'dom-1');
        expect(service._dns.resolveTxt).toHaveBeenCalled();
      } finally {
        process.env.DOMAIN_VERIFY_COOLDOWN_MS = OLD;
      }
    });
    it('stores the Railway certificate status and explains a failed issuance', async () => {
      railway.getCustomDomainStatus.mockResolvedValue({ certificateStatus: 'FAILED', certificateReady: false, dnsOk: true });
      db.findFirst.mockResolvedValue({ ...base, railwayDomainId: 'rw-1' });
      db.update.mockImplementation(async ({ data }) => ({ ...base, railwayDomainId: 'rw-1', ...data }));
      dnsWith({ txt: [['jump-verify=abc123']], cname: ['frontend-production.up.railway.app'] });
      const out = await service.verifyDomain('org-1', 'dom-1');
      const data = db.update.mock.calls[0][0].data;
      expect(data.certificateStatus).toBe('FAILED');
      expect(data.status).toBe('VERIFIED');
      expect(data.lastError).toMatch(/certificate could not be issued/);
      expect(out.certificateStatus).toBe('FAILED');
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
