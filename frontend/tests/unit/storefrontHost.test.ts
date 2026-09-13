import { describe, expect, it } from 'vitest';
import { isPlatformHost, normalizeHost, platformHostsFromEnv, routeForTenantHost } from '@/lib/storefrontHost';

describe('normalizeHost', () => {
  it('lowercases and strips port and trailing dot', () => {
    expect(normalizeHost('Tickets.Example.com:3001')).toBe('tickets.example.com');
    expect(normalizeHost('tickets.example.com.')).toBe('tickets.example.com');
    expect(normalizeHost(undefined)).toBe('');
  });
});

describe('isPlatformHost', () => {
  const configured = ['app.jump.events'];
  it('treats localhost, railway service hosts, configured hosts and their subdomains as platform', () => {
    expect(isPlatformHost('localhost:3001', configured)).toBe(true);
    expect(isPlatformHost('frontend-production-43e9.up.railway.app', configured)).toBe(true);
    expect(isPlatformHost('APP.jump.events', configured)).toBe(true);
    expect(isPlatformHost('staging.app.jump.events', configured)).toBe(true);
    expect(isPlatformHost('', configured)).toBe(true);
  });
  it('treats anything else as a tenant host', () => {
    expect(isPlatformHost('tickets.venue.com', configured)).toBe(false);
    expect(isPlatformHost('jump.events.evil.com', configured)).toBe(false);
  });
});

describe('platformHostsFromEnv', () => {
  it('merges the list env with hosts parsed from URL envs', () => {
    const hosts = platformHostsFromEnv({
      NEXT_PUBLIC_PLATFORM_HOSTS: 'app.jump.events, Www.Jump.Events',
      AUTH_URL: 'https://frontend-production-43e9.up.railway.app',
      NEXTAUTH_URL: 'not a url',
    });
    expect(hosts.sort()).toEqual(['app.jump.events', 'frontend-production-43e9.up.railway.app', 'www.jump.events']);
  });
});

describe('routeForTenantHost', () => {
  const org = 'org_1';
  const route = (p: string) => routeForTenantHost(p, org);

  it('maps the root and /account onto the organization pages', () => {
    expect(route('/')).toEqual({ kind: 'rewrite', pathname: '/organizations/org_1' });
    expect(route('/account')).toEqual({ kind: 'rewrite', pathname: '/organizations/org_1/account' });
    expect(route('/account/verify')).toEqual({ kind: 'rewrite', pathname: '/organizations/org_1/account/verify' });
  });

  it('passes the organization own paths and public storefront paths', () => {
    expect(route('/organizations/org_1')).toEqual({ kind: 'pass' });
    expect(route('/organizations/org_1/account')).toEqual({ kind: 'pass' });
    for (const p of ['/events/e1', '/checkout/e1', '/confirmation', '/orders/o1', '/tickets/t1', '/venues/v1']) {
      expect(route(p)).toEqual({ kind: 'pass' });
    }
  });

  it('hides other organizations and every platform-only surface', () => {
    expect(route('/organizations/org_2')).toEqual({ kind: 'notFound' });
    for (const p of ['/admin', '/admin/events', '/auth/signin', '/dashboard', '/my-tickets', '/orders', '/orders/lookup', '/unknown']) {
      expect(route(p)).toEqual({ kind: 'notFound' });
    }
  });
});
