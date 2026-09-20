// Server-only: the "remember this device" cookie for two-step (spec 030 C).
// The cookie holds a random token the backend stores hashed; it is set and
// read only by the route handlers under app/api/account/two-step/*.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const TRUSTED_COOKIE = 'jump_trusted';
const DAYS = Number(process.env.TWO_STEP_TRUST_DAYS) || 30;

export function getTrustedToken(): string | null {
  return cookies().get(TRUSTED_COOKIE)?.value ?? null;
}

export function setTrustedCookie(res: NextResponse, token: string) {
  res.cookies.set(TRUSTED_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DAYS * 24 * 60 * 60,
  });
}

export function clearTrustedCookie(res: NextResponse) {
  res.cookies.set(TRUSTED_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
