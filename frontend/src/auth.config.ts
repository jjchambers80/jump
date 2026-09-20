// frontend/src/auth.config.ts
// Edge-safe Auth.js configuration — NO Prisma references
// Used by middleware.ts for edge-compatible route protection

import type { NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';
import Google from 'next-auth/providers/google';
import { decodeSessionToken, encodeSessionToken } from './lib/authJwt';

export default {
  // Railway (and local dev) sit behind a proxy; Auth.js must trust the Host header.
  trustHost: true,
  // Custom HS256 cookie so the Express backend can verify the same token.
  // Lives here (not auth.ts) so middleware can decode sessions on the edge.
  jwt: {
    encode: async ({ token }) => (token ? encodeSessionToken(token) : ''),
    decode: async ({ token }) => (token ? decodeSessionToken(token) : null),
  },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_RESEND_FROM || 'onboarding@resend.dev',
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Spec 030 B: "Connect Google" from Account › Security links a Google
      // account to the existing user with the same (Google-verified) email
      // instead of failing with OAuthAccountNotLinked.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    // Edge-safe: lets middleware.ts see a session whose second step is
    // pending (spec 030 C). auth.ts replaces `callbacks` wholesale and
    // exposes the same flag.
    session({ session, token }) {
      (session as any).mfaPending = token.mfa === 'pending';
      return session;
    },
  },
} satisfies NextAuthConfig;
