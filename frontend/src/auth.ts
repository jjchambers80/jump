// frontend/src/auth.ts
// Full Auth.js v5 configuration with PrismaAdapter, JWT strategy, custom HS256 encode/decode
// This file is NOT edge-safe — it imports Prisma. Use auth.config.ts for middleware.

import NextAuth, { type NextAuthConfig } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@jump/db';
import jwt from 'jsonwebtoken';
import Credentials from 'next-auth/providers/credentials';
import authConfig from './auth.config';
import { applyUserClaims, shouldRefreshClaims, type UserClaims } from '@/lib/sessionClaims';

const AUTH_SECRET = process.env.AUTH_SECRET!;

// Build providers: start with auth.config providers, add dev-only credentials
const providers: NextAuthConfig['providers'] = [...authConfig.providers];

if (process.env.NODE_ENV === 'development') {
  providers.push(
    Credentials({
      id: 'dev-email',
      name: 'Dev Email Sign-In',
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        if (!email) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    })
  );
}

/** Snapshot of the User row that becomes JWT claims; null when the account is gone. */
async function loadUserClaims(userId: string): Promise<UserClaims | null> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      name: true,
      email: true,
      deletedAt: true,
      // Active org = oldest membership; the admin org switcher overrides via X-Jump-Org (spec 007)
      memberships: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { organizationId: true },
      },
    },
  });
  if (!dbUser || dbUser.deletedAt) return null;
  return {
    role: dbUser.role,
    name: dbUser.name,
    email: dbUser.email,
    organizationId: dbUser.memberships[0]?.organizationId ?? null,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      // Role and active org live in the JWT so the backend can trust them without a
      // DB hit per request. Re-read them on sign-in and whenever the snapshot is
      // older than CLAIMS_REFRESH_MS so role changes and new memberships take effect
      // without a re-login. A missing or soft-deleted user invalidates the session.
      const now = Date.now();
      const userId = user?.id ?? token.sub;
      if (!userId) return token;
      if (!user?.id && !shouldRefreshClaims(token, now)) return token;

      const claims = await loadUserClaims(userId);
      if (!claims) return null;
      return applyUserClaims(token, claims, now);
    },
    async session({ session, token }) {
      // Expose role, userId, and raw JWT accessToken in session
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as any).role = token.role;
        (session.user as any).organizationId = token.organizationId ?? null;
      }
      // Generate the raw JWT so the client can send it as a Bearer token to the backend
      (session as any).accessToken = jwt.sign(
        {
          sub: token.sub,
          email: token.email,
          role: token.role,
          name: token.name,
          organizationId: token.organizationId ?? null,
          iat: Math.floor(Date.now() / 1000),
        },
        AUTH_SECRET,
        { algorithm: 'HS256', expiresIn: '30d' }
      );
      return session;
    },
  },
});
