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
    }),
  ],
  pages: {
    signIn: '/auth/signin',
  },
} satisfies NextAuthConfig;
