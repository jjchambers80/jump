// Unit tests for the Railway custom-domain client (spec 008): both DNS
// records are captured on create and either enum spelling is understood.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const railway = await import('../../src/lib/railwayDomains.js');

const ENV = { RAILWAY_API_TOKEN: 't', RAILWAY_PROJECT_ID: 'p', RAILWAY_ENVIRONMENT_ID: 'e', RAILWAY_FRONTEND_SERVICE_ID: 's' };

function mockGraphql(data) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) });
}

describe('railwayDomains', () => {
  const saved = {};
  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  });
  afterAll(() => {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete global.fetch;
  });

  it('isConfigured needs token, project, environment and service ids', () => {
    expect(railway.isConfigured()).toBe(true);
    const t = process.env.RAILWAY_API_TOKEN;
    delete process.env.RAILWAY_API_TOKEN;
    expect(railway.isConfigured()).toBe(false);
    process.env.RAILWAY_API_TOKEN = t;
  });

  it('createCustomDomain returns the CNAME target and the _railway-verify TXT (typed records)', async () => {
    mockGraphql({
      customDomainCreate: {
        id: 'rw-1',
        domain: 'tickets.example.com',
        status: {
          dnsRecords: [
            { hostlabel: 'tickets', recordType: 'DNS_RECORD_TYPE_CNAME', requiredValue: 'abc.up.railway.app', currentValue: '', status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE' },
            { hostlabel: '_railway-verify.tickets', recordType: 'DNS_RECORD_TYPE_TXT', requiredValue: 'railway-verify=deadbeef', currentValue: '', status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE' },
          ],
        },
      },
    });
    expect(await railway.createCustomDomain('tickets.example.com')).toEqual({
      id: 'rw-1',
      cnameTarget: 'abc.up.railway.app',
      txtHost: '_railway-verify.tickets',
      txtValue: 'railway-verify=deadbeef',
    });
  });

  it('createCustomDomain infers record types from values when recordType is absent', async () => {
    mockGraphql({
      customDomainCreate: {
        id: 'rw-2',
        status: {
          dnsRecords: [
            { hostlabel: '_railway-verify.tickets', requiredValue: 'railway-verify=cafe', status: 'PENDING' },
            { hostlabel: 'tickets', requiredValue: 'xyz.up.railway.app', status: 'PENDING' },
          ],
        },
      },
    });
    expect(await railway.createCustomDomain('tickets.example.com')).toMatchObject({ cnameTarget: 'xyz.up.railway.app', txtValue: 'railway-verify=cafe' });
  });

  it.each([
    ['CERTIFICATE_STATUS_TYPE_VALID', 'ISSUED', true],
    ['ISSUED', 'ISSUED', true],
    ['CERTIFICATE_STATUS_TYPE_ISSUE_FAILED', 'FAILED', false],
    ['FAILED', 'FAILED', false],
    ['CERTIFICATE_STATUS_TYPE_ISSUE_PENDING', 'PENDING', false],
    ['PENDING', 'PENDING', false],
    [undefined, 'PENDING', false],
  ])('getCustomDomainStatus maps certificate %s -> %s', async (raw, expected, ready) => {
    mockGraphql({ customDomain: { id: 'rw-1', status: { certificateStatus: raw, dnsRecords: [{ status: 'VALID' }, { status: 'DNS_RECORD_STATUS_PROPAGATED' }] } } });
    const out = await railway.getCustomDomainStatus('rw-1');
    expect(out).toEqual({ certificateStatus: expected, certificateReady: ready, dnsOk: true });
  });

  it('dnsOk is false while any record is pending in either spelling', async () => {
    mockGraphql({ customDomain: { status: { certificateStatus: 'PENDING', dnsRecords: [{ status: 'VALID' }, { status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE' }] } } });
    expect((await railway.getCustomDomainStatus('rw-1')).dnsOk).toBe(false);
  });

  it('surfaces GraphQL errors with their message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: 'Custom domain limit reached' }] }) });
    await expect(railway.createCustomDomain('tickets.example.com')).rejects.toThrow('Railway API: Custom domain limit reached');
  });

  it('deleteCustomDomain treats not-found as removed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: 'Custom domain not found' }] }) });
    await expect(railway.deleteCustomDomain('rw-1')).resolves.toBeUndefined();
  });
});
