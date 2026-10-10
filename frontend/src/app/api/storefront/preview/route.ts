// Draft theme preview cookie (spec 038 D11, contracts C7). GET ?token= keeps
// the signed preview token in the host-only httpOnly `jump_theme_preview`
// cookie and opens the organization's home on this host; the themed server
// pages forward it as X-Theme-Preview, and the backend checks it every render.
// GET without a token (the preview bar's Exit) and DELETE expire it.

import { NextResponse } from 'next/server';
import { isPlatformHost, platformHostsFromEnv } from '@/lib/storefrontHost';
import { PREVIEW_COOKIE } from '@/theme/server/storefront';
import { publicUrl, safePath } from '@/lib/publicRequestUrl';

const PLATFORM_HOSTS = platformHostsFromEnv(process.env as Record<string, string | undefined>);

function claims(token: string): { orgId?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    const response = NextResponse.redirect(publicUrl(safePath(url.searchParams.get('to')), request));
    response.cookies.set(PREVIEW_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  }
  // Read, not trusted: the backend verifies the signature on every render.
  const { orgId, exp } = claims(token);
  if (!orgId || !/^[A-Za-z0-9_-]{1,64}$/.test(orgId)) return new NextResponse('Invalid preview link', { status: 400 });
  const target = publicUrl('/', request);
  const home = isPlatformHost(target.host, PLATFORM_HOSTS, process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN) ? `/organizations/${orgId}` : '/';
  const response = NextResponse.redirect(new URL(home, target));
  response.cookies.set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: typeof exp === 'number' ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 60 * 60,
  });
  return response;
}

export function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(PREVIEW_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
