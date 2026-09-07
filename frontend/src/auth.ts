// frontend/src/auth.ts
// Full Auth.js v5 configuration with PrismaAdapter, JWT strategy, custom HS256 encode/decode
// This file is NOT edge-safe — it imports Prisma. Use auth.config.ts for middleware.

import NextAuth, { type NextAuthConfig } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@jump/db';
import jwt from 'jsonwebtoken';
import Credentials from 'next-auth/providers/credentials';
import authConfig from './auth.config';

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, populate token with user data from DB
      if (user?.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, name: true, email: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.name = dbUser.name;
          token.email = dbUser.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose role, userId, and raw JWT accessToken in session
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as any).role = token.role;
      }
      // Generate the raw JWT so the client can send it as a Bearer token to the backend
      (session as any).accessToken = jwt.sign(
        {
          sub: token.sub,
          email: token.email,
          role: token.role,
          name: token.name,
          iat: Math.floor(Date.now() / 1000),
        },
        AUTH_SECRET,
        { algorithm: 'HS256', expiresIn: '30d' }
      );
      return session;
    },
    async signIn({ user }) {
      // Contact↔User linking: when a user signs in, link any existing Contact with matching email
      if (user?.email) {
        try {
          await prisma.contact.updateMany({
            where: {
              email: user.email,
              userId: null,
            },
            data: {
              userId: user.id!,
            },
          });
        } catch {
          // Non-fatal — contact linking is best-effort
        }
      }
      return true;
    },
  },
  jwt: {
    // Custom HS256 encode/decode so Express backend can verify with jsonwebtoken
    encode: async ({ token }) => {
      if (!token) return '';
      return jwt.sign(
        {
          sub: token.sub,
          email: token.email,
          role: token.role,
          name: token.name,
          iat: Math.floor(Date.now() / 1000),
        },
        AUTH_SECRET,
        { algorithm: 'HS256', expiresIn: '30d' }
      );
    },
    decode: async ({ token: tokenStr }) => {
      if (!tokenStr) return null;
      try {
        const decoded = jwt.verify(tokenStr, AUTH_SECRET, {
          algorithms: ['HS256'],
        });
        return decoded as any;
      } catch {
        return null;
      }
    },
  },
});
