// frontend/middleware.ts
// Edge middleware for Auth.js route protection
// Uses auth.config.ts (edge-safe, no Prisma)

import NextAuth from 'next-auth';
import authConfig from './src/auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Protected routes that require authentication
  const protectedPaths = ['/dashboard', '/orders'];
  const isProtected = protectedPaths.some((path) => nextUrl.pathname.startsWith(path));

  if (isProtected && !isLoggedIn) {
    const signInUrl = new URL('/auth/signin', nextUrl);
    signInUrl.searchParams.set('callbackUrl', nextUrl.pathname);
    return Response.redirect(signInUrl);
  }

  return undefined;
});

export const config = {
  matcher: [
    // Match all routes except static files, api routes, and auth routes
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
