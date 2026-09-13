// frontend/src/middleware.ts
// Edge middleware. Lives in src/ because this project uses the src/ layout; a
// middleware.ts at the package root is ignored by Next.
//
// 1. Tenant-host routing for white-label storefronts (spec 007 phase 3).
// 2. Staff route protection on platform hosts: /admin requires an Auth.js
//    session. auth.config.ts decodes the HS256 cookie with jose, which runs
//    on the edge; pages still keep their client-side guards as a second layer.

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import authConfig from './auth.config';
import { isPlatformHost, normalizeHost, platformHostsFromEnv, routeForTenantHost } from './lib/storefrontHost';

// The email (Resend) provider requires a database adapter, which does not
// exist on the edge; Auth() would throw MissingAdapter and skip the check.
// Session decoding needs no providers, so keep only adapter-free ones here.
const { auth } = NextAuth({
  ...authConfig,
  providers: authConfig.providers.filter((provider) => {
    const resolved = typeof provider === 'function' ? (provider as () => { type: string })() : provider;
    return resolved.type !== 'email';
  }),
});

const STAFF_ONLY_PREFIXES = ['/admin'];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const PLATFORM_HOSTS = platformHostsFromEnv(process.env as Record<string, string | undefined>);

// host -> { orgId | null, expires }. Per edge isolate; the backend also caches.
const RESOLVE_TTL_MS = 60 * 1000;
const hostCache = new Map<string, { orgId: string | null; expires: number }>();

async function resolveTenantHost(host: string): Promise<string | null> {
  const hit = hostCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.orgId;
  let orgId: string | null = null;
  try {
    const res = await fetch(`${API_URL}/domains/resolve?host=${encodeURIComponent(host)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) orgId = (await res.json())?.organizationId ?? null;
  } catch {
    orgId = null; // backend unreachable: behave as unknown host
  }
  hostCache.set(host, { orgId, expires: Date.now() + RESOLVE_TTL_MS });
  return orgId;
}

function notFound(req: NextRequest) {
  // Rewrite to a path no route serves so the app's not-found page renders on this host
  return NextResponse.rewrite(new URL('/__storefront-not-found', req.url), { status: 404 });
}

export default auth(async (req: NextRequest & { auth: unknown }) => {
  const host = normalizeHost(req.headers.get('host'));

  if (isPlatformHost(host, PLATFORM_HOSTS)) {
    const { pathname } = req.nextUrl;
    const staffOnly = STAFF_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (staffOnly && !req.auth) {
      const signInUrl = new URL('/auth/signin', req.nextUrl);
      signInUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // Tenant (custom) host: one organization's storefront, no staff surface
  const orgId = await resolveTenantHost(host);
  if (!orgId) return notFound(req);

  const route = routeForTenantHost(req.nextUrl.pathname, orgId);
  if (route.kind === 'notFound') return notFound(req);

  const headers = new Headers(req.headers);
  headers.set('x-jump-org-id', orgId);
  headers.set('x-jump-tenant-host', host);
  if (route.kind === 'rewrite') {
    const url = req.nextUrl.clone();
    url.pathname = route.pathname;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
});

export const config = {
  // Everything except API routes, Next internals and static files.
  // /api/buyer/* must pass untouched on tenant hosts (same-origin cookie flow).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)'],
};
