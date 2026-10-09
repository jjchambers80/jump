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
import {
  hostifyRedirectTarget,
  isPlatformHost,
  normalizeHost,
  platformHostsFromEnv,
  routeForTenantHost,
  tenantResourceFor,
} from './lib/storefrontHost';

// The email (Resend) provider requires a database adapter, which does not
// exist on the edge; Auth() would throw MissingAdapter and skip the check.
// Session decoding needs no providers, so keep only adapter-free ones here.
const { auth } = NextAuth({
  ...authConfig,
  providers: authConfig.providers.filter((provider) => {
    const resolved =
      typeof provider === 'function' ? (provider as () => { type: string })() : provider;
    return resolved.type !== 'email';
  }),
});

const STAFF_ONLY_PREFIXES = ['/admin', '/oauth'];

/** Sign-in's default callbackUrl; routed by role below (auth/signin/page.tsx). */
const SIGN_IN_LANDING = '/auth/landing';

function oauthFrameProtection(response: NextResponse, pathname: string) {
  if (pathname === '/oauth/consent') {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    response.headers.set('X-Frame-Options', 'DENY');
  }
  return response;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const PLATFORM_HOSTS = platformHostsFromEnv(process.env as Record<string, string | undefined>);
const STORE_ROOT = process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN;

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

// (kind:id) -> { orgId | null, expires }. Ownership never changes, so cache longer.
const OWNER_TTL_MS = 5 * 60 * 1000;
const ownerCache = new Map<string, { orgId: string | null; expires: number }>();

async function resourceOwner(
  kind: 'event' | 'order' | 'venue',
  id: string
): Promise<string | null> {
  const key = `${kind}:${id}`;
  const hit = ownerCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.orgId;
  let orgId: string | null = null;
  try {
    const res = await fetch(`${API_URL}/domains/owner?${kind}Id=${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) orgId = (await res.json())?.organizationId ?? null;
  } catch {
    orgId = null; // backend unreachable: fail closed on tenant hosts
  }
  ownerCache.set(key, { orgId, expires: Date.now() + OWNER_TTL_MS });
  return orgId;
}

// URL redirects (spec 028): consulted only for paths that would otherwise 404
// on a tenant host. Fails open to the 404 when the backend is unreachable.
async function redirectTarget(orgId: string, pathname: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/organizations/${encodeURIComponent(orgId)}/public/redirect?path=${encodeURIComponent(pathname)}`,
      {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { to?: string };
    return typeof data?.to === 'string' && data.to ? data.to : null;
  } catch {
    return null;
  }
}

function notFound(req: NextRequest) {
  // Rewrite to a path no route serves so the app's not-found page renders on this host
  return NextResponse.rewrite(new URL('/__storefront-not-found', req.url), { status: 404 });
}

/** Where a session that must turn on two-step is sent (also used by services/api.ts). */
const TWO_STEP_SETUP_PATH = '/admin/account/security?required=two-step';

export default auth(async (req: NextRequest & { auth: unknown }) => {
  const host = normalizeHost(req.headers.get('host'));

  if (isPlatformHost(host, PLATFORM_HOSTS, STORE_ROOT)) {
    const { pathname } = req.nextUrl;
    const staffOnly = STAFF_ONLY_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    );
    // Default post-sign-in destination (no explicit callbackUrl): the role is
    // only known once the session exists, and Google / email links redirect
    // straight to the callbackUrl, so the decision is made here for every
    // provider. SYSTEM_ADMIN → /admin (→ /admin/system below, via
    // /auth/two-step first when the second step is pending); everyone else
    // keeps the old /events default.
    if (pathname === SIGN_IN_LANDING) {
      const session = req.auth as { role?: string; mfaPending?: boolean } | null;
      let to = '/events';
      if (session?.role === 'SYSTEM_ADMIN') {
        to = session.mfaPending ? `/auth/two-step?callbackUrl=${encodeURIComponent('/admin')}` : '/admin';
      }
      return NextResponse.redirect(new URL(to, req.nextUrl));
    }
    if (staffOnly && !req.auth) {
      const signInUrl = new URL('/auth/signin', req.nextUrl);
      signInUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
      return oauthFrameProtection(NextResponse.redirect(signInUrl), pathname);
    }
    // Spec 030 C: the first factor passed but the second step is due — the
    // admin area waits at /auth/two-step (the page itself is public).
    if (staffOnly && (req.auth as { mfaPending?: boolean } | null)?.mfaPending) {
      const twoStepUrl = new URL('/auth/two-step', req.nextUrl);
      twoStepUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
      return oauthFrameProtection(NextResponse.redirect(twoStepUrl), pathname);
    }
    // Settings › Users "secure sign-in method": an organization requires
    // two-step and it is off — only the user's own account pages stay open.
    if (
      staffOnly &&
      (req.auth as { twoStepSetupRequired?: boolean } | null)?.twoStepSetupRequired &&
      !(pathname === '/admin/account' || pathname.startsWith('/admin/account/'))
    ) {
      return oauthFrameProtection(NextResponse.redirect(new URL(TWO_STEP_SETUP_PATH, req.nextUrl)), pathname);
    }
    // System administration: SYSTEM_ADMIN lands there from /admin, nobody
    // else gets in. The role claim can lag the DB by up to 60 s; the
    // system layout re-checks on the client and the API enforces it.
    if (staffOnly) {
      const isSystemAdmin = (req.auth as { role?: string } | null)?.role === 'SYSTEM_ADMIN';
      if (pathname === '/admin' || pathname === '/admin/') {
        const home = new URL(isSystemAdmin ? '/admin/system' : '/admin/dashboard', req.nextUrl);
        home.search = req.nextUrl.search;
        return NextResponse.redirect(home);
      }
      if (!isSystemAdmin && (pathname === '/admin/system' || pathname.startsWith('/admin/system/'))) {
        return NextResponse.redirect(new URL('/admin/dashboard', req.nextUrl));
      }
    }
    return oauthFrameProtection(NextResponse.next(), pathname);
  }

  // Tenant host (custom domain or store subdomain): one organization's storefront, no staff surface
  const orgId = await resolveTenantHost(host);
  if (!orgId) return notFound(req);

  const route = routeForTenantHost(req.nextUrl.pathname, orgId);
  if (route.kind === 'notFound') {
    const to = await redirectTarget(orgId, req.nextUrl.pathname);
    if (to)
      return NextResponse.redirect(new URL(hostifyRedirectTarget(to, orgId, true), req.url), 301);
    return notFound(req);
  }

  // A resource in the URL must belong to this organization: tickets.a.com
  // must not render org B's event, checkout, order or venue pages.
  const resource = tenantResourceFor(req.nextUrl.pathname, req.nextUrl.searchParams);
  if (resource && (await resourceOwner(resource.kind, resource.id)) !== orgId) return notFound(req);

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
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)',
  ],
};
