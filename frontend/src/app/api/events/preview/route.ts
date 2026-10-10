// Draft event preview cookie (spec 050 §7.5). GET ?token= keeps the signed
// token in the host-only httpOnly `jump_event_preview` cookie and opens the
// event page on this host (platform, store subdomain or custom domain all use
// /events/:id); the page forwards it as X-Event-Preview and the backend
// verifies it for that event's organization on every load. This route trusts
// nothing: it only reads the claims to know where to go.
// GET without a token (the preview bar's Exit) and DELETE expire it.

import { NextResponse } from 'next/server';
import { eventPath } from '@/lib/publicPaths';
import { publicUrl, safePath } from '@/lib/publicRequestUrl';
import { EVENT_PREVIEW_COOKIE } from '@/lib/eventPreview';

function claims(token: string): { eventId?: unknown; exp?: unknown } {
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
    response.cookies.set(EVENT_PREVIEW_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  }
  const { eventId, exp } = claims(token);
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
    return new NextResponse('Invalid preview link', { status: 400 });
  }
  const response = NextResponse.redirect(publicUrl(eventPath(eventId), request));
  // No `domain`: host-only, so a preview on one storefront never leaks to another.
  response.cookies.set(EVENT_PREVIEW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: typeof exp === 'number' ? Math.max(0, Math.min(60 * 60, exp - Math.floor(Date.now() / 1000))) : 60 * 60,
  });
  return response;
}

export function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(EVENT_PREVIEW_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
