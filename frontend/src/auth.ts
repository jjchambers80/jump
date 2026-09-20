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
import { resolveSessionId, revokeSessionOnSignOut } from '@/lib/userSessions';
import { consumeBridgeToken, recordSecurityEvent, verifyPasswordWithBackend } from '@/lib/staffAuth';

const AUTH_SECRET = process.env.AUTH_SECRET!;

// Build providers: start with auth.config providers, add the spec 030 B
// Credentials providers and, in development, the instant dev sign-in.
const providers: NextAuthConfig['providers'] = [
  ...authConfig.providers,
  // Email + password. Verification, rate limiting and audit happen in the
  // backend (POST /auth/password); a user without a password fails like a
  // wrong password.
  Credentials({
    id: 'password',
    name: 'Password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials, request) {
      const email = credentials?.email;
      const password = credentials?.password;
      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return null;
      return verifyPasswordWithBackend(email, password, request);
    },
  }),
  // One-time bridge token minted by the backend after a passkey assertion
  // or a secondary-email recovery link. This is the only way a ceremony
  // that ends outside Auth.js becomes a session.
  Credentials({
    id: 'token-bridge',
    name: 'Token bridge',
    credentials: { token: { label: 'Token', type: 'text' } },
    async authorize(credentials) {
      const token = credentials?.token;
      if (typeof token !== 'string' || !token) return null;
      return consumeBridgeToken(token);
    },
  }),
];

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
      image: true,
      locale: true,
      timeZone: true,
      deletedAt: true,
      // Spec 030: uploaded photo wins over the provider picture
      avatarImage: { select: { id: true, file: { select: { hash: true } } } },
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
    locale: dbUser.locale,
    timeZone: dbUser.timeZone,
    picture: dbUser.avatarImage
      ? `/images/${dbUser.avatarImage.id}/${dbUser.avatarImage.file.hash}/thumb`
      : dbUser.image ?? null,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      // Role and active org live in the JWT so the backend can trust them without a
      // DB hit per request. Re-read them on sign-in, when the client calls
      // useSession().update() (trigger === 'update' — the signup flow does this right
      // after promoting the user, spec 022), and whenever the snapshot is older than
      // CLAIMS_REFRESH_MS so role changes and new memberships take effect without a
      // re-login. A missing or soft-deleted user invalidates the session.
      const now = Date.now();
      const userId = user?.id ?? token.sub;
      if (!userId) return token;
      if (!user?.id && trigger !== 'update' && !shouldRefreshClaims(token, now)) return token;

      const claims = await loadUserClaims(userId);
      if (!claims) return null;

      // Revocable session (spec 030 D): a new row per sign-in, adopted by
      // legacy tokens on their first refresh; a revoked row ends the session.
      const sid = await resolveSessionId(userId, typeof token.sid === 'string' ? token.sid : undefined, {
        signIn: Boolean(user?.id),
        provider: user?.id ? account?.provider ?? null : undefined,
      });
      if (!sid) return null;
      token.sid = sid;

      return applyUserClaims(token, claims, now);
    },
    async session({ session, token }) {
      // Expose role, userId, and raw JWT accessToken in session
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as any).role = token.role;
        (session.user as any).organizationId = token.organizationId ?? null;
        // Spec 030 account preferences + avatar (relative /images URL or provider URL)
        (session.user as any).locale = token.locale ?? 'en-US';
        (session.user as any).timeZone = token.timeZone ?? null;
        session.user.image = (token.picture as string | null | undefined) ?? null;
      }
      (session as any).sid = token.sid ?? null;
      // Generate the raw JWT so the client can send it as a Bearer token to the backend
      (session as any).accessToken = jwt.sign(
        {
          sub: token.sub,
          email: token.email,
          role: token.role,
          name: token.name,
          organizationId: token.organizationId ?? null,
          sid: token.sid ?? undefined,
          iat: Math.floor(Date.now() / 1000),
        },
        AUTH_SECRET,
        { algorithm: 'HS256', expiresIn: '30d' }
      );
      return session;
    },
  },
  events: {
    // "Connect Google" from Account › Security (spec 030 B)
    async linkAccount({ user, account }) {
      if (user.id) await recordSecurityEvent(user.id, 'PROVIDER_CONNECTED', { provider: account.provider });
    },
    // JWT strategy: `token` is the cookie being cleared. Revoke its row so the
    // device disappears from Account › Security › Devices immediately.
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      const sid = token && typeof token.sid === 'string' ? token.sid : undefined;
      await revokeSessionOnSignOut(sid).catch(() => {});
    },
  },
});
