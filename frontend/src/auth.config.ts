// frontend/src/auth.config.ts
// Edge-safe Auth.js configuration — NO Prisma references
// Used by middleware.ts for edge-compatible route protection

import type { NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';
import Google from 'next-auth/providers/google';

export default {
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
