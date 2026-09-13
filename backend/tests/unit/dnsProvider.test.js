// Unit tests for DNS provider detection (spec 008): NS suffix matching and
// zone walking with an injected resolver.

import { jest } from '@jest/globals';
import { detectDnsProvider, providerFromNameservers, providerInfo } from '../../src/lib/dnsProvider.js';

const nx = (name) => Object.assign(new Error(`ENOTFOUND ${name}`), { code: 'ENOTFOUND' });

describe('providerFromNameservers', () => {
  it.each([
    [['kim.ns.cloudflare.com', 'rob.ns.cloudflare.com'], 'cloudflare'],
    [['ns37.domaincontrol.com.'], 'godaddy'],
    [['dns1.registrar-servers.com'], 'namecheap'],
    [['NS1.WORLDNIC.COM'], 'networksolutions'],
    [['ns-1234.awsdns-27.org'], 'route53'],
    [['ns1.dnsimple.com'], 'dnsimple'],
    [['ns-cloud-a1.googledomains.com'], 'squarespace'],
    [['ns-cloud-b1.google.com'], 'googlecloud'],
    [['ns1.p01.nsone.net'], null],
    [[], null],
  ])('%j -> %s', (nameservers, expected) => {
    expect(providerFromNameservers(nameservers)).toBe(expected);
  });
});

describe('providerInfo', () => {
  it('returns display data for known keys and null otherwise', () => {
    expect(providerInfo('cloudflare')).toEqual(expect.objectContaining({ key: 'cloudflare', name: 'Cloudflare', dnsConsoleUrl: expect.stringMatching(/^https:/) }));
    expect(providerInfo('nope')).toBeNull();
    expect(providerInfo(null)).toBeNull();
  });
});

describe('detectDnsProvider', () => {
  it('walks up from the hostname to the zone that answers NS', async () => {
    const resolveNs = jest.fn(async (name) => {
      if (name === 'example.com') return ['ns37.domaincontrol.com'];
      throw nx(name);
    });
    expect(await detectDnsProvider('tickets.example.com', { resolveNs })).toBe('godaddy');
    expect(resolveNs.mock.calls.map((c) => c[0])).toEqual(['tickets.example.com', 'example.com']);
  });
  it('uses the delegated subdomain zone when it has its own NS', async () => {
    const resolveNs = jest.fn(async (name) => (name === 'tickets.example.com' ? ['kim.ns.cloudflare.com'] : ['ns37.domaincontrol.com']));
    expect(await detectDnsProvider('tickets.example.com', { resolveNs })).toBe('cloudflare');
  });
  it('returns null when nothing answers or the provider is unknown, and never throws', async () => {
    expect(await detectDnsProvider('tickets.example.com', { resolveNs: async (n) => { throw nx(n); } })).toBeNull();
    expect(await detectDnsProvider('tickets.example.com', { resolveNs: async () => ['ns1.unknown-host.net'] })).toBeNull();
    expect(await detectDnsProvider('', { resolveNs: async () => ['kim.ns.cloudflare.com'] })).toBeNull();
  });
});
