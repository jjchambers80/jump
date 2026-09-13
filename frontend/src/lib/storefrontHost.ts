// Storefront host routing (spec 007 phase 3). Pure functions used by
// middleware.ts; no Next.js or Node imports so they run on the edge and in
// vitest.
//
// On a custom host the storefront is one organization: `/` is that org's page
// and `/account` its buyer account page. Paths that would expose the platform
// (admin, staff auth, other organizations) do not exist there.

export type StorefrontRoute =
  | { kind: 'pass' }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'notFound' };

/** Lowercase host without port or trailing dot. */
export function normalizeHost(host: string | null | undefined): string {
  return (host || '').trim().toLowerCase().split(':')[0].replace(/\.$/, '');
}

/**
 * Platform hosts never resolve to an organization: localhost, the configured
 * app host(s), and any *.up.railway.app service URL.
 */
export function isPlatformHost(host: string, configured: string[]): boolean {
  const h = normalizeHost(host);
  if (!h) return true; // no Host header: treat as platform, never as a tenant
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  if (h.endsWith('.up.railway.app')) return true;
  return configured.some((c) => {
    const p = normalizeHost(c);
    return p && (h === p || h.endsWith(`.${p}`));
  });
}

/** Parse the comma-separated PLATFORM_HOSTS env plus hosts of any URLs given. */
export function platformHostsFromEnv(env: Record<string, string | undefined>): string[] {
  const hosts = new Set<string>();
  for (const raw of (env.NEXT_PUBLIC_PLATFORM_HOSTS || env.PLATFORM_HOSTS || '').split(',')) {
    const h = normalizeHost(raw);
    if (h) hosts.add(h);
  }
  for (const key of ['AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL']) {
    const v = env[key];
    if (!v) continue;
    try {
      hosts.add(new URL(v).hostname.toLowerCase());
    } catch {
      /* ignore malformed */
    }
  }
  return [...hosts];
}

const PUBLIC_PASS = [/^\/events(\/|$)/, /^\/checkout(\/|$)/, /^\/confirmation(\/|$)/, /^\/orders\/[^/]+$/, /^\/tickets(\/|$)/, /^\/venues(\/|$)/];
const PLATFORM_ONLY = [/^\/admin(\/|$)/, /^\/auth(\/|$)/, /^\/dashboard(\/|$)/, /^\/my-tickets(\/|$)/, /^\/orders\/?$/, /^\/orders\/lookup(\/|$)/];

/**
 * Decide what a path means on a tenant host for `orgId`.
 * `/api/*`, `/_next/*` and static files are excluded by the middleware matcher
 * and never reach this function.
 */
export function routeForTenantHost(pathname: string, orgId: string): StorefrontRoute {
  const path = pathname || '/';
  if (path === '/' || path === '') return { kind: 'rewrite', pathname: `/organizations/${orgId}` };

  const account = path.match(/^\/account(\/.*)?$/);
  if (account) return { kind: 'rewrite', pathname: `/organizations/${orgId}/account${account[1] || ''}` };

  const org = path.match(/^\/organizations\/([^/]+)(\/.*)?$/);
  if (org) return org[1] === orgId ? { kind: 'pass' } : { kind: 'notFound' };

  if (PLATFORM_ONLY.some((re) => re.test(path))) return { kind: 'notFound' };
  if (PUBLIC_PASS.some((re) => re.test(path))) return { kind: 'pass' };

  return { kind: 'notFound' };
}
