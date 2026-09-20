// Session shape exposed by frontend/src/auth.ts. Role/org claims predate this
// file and are still read with `as any` in places; spec 030 adds the account
// preferences here so new code is typed.
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    /** Revocable session id (spec 030 D). */
    sid?: string | null;
    /** The second step of two-step authentication is still due (spec 030 C). */
    mfaPending?: boolean;
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role?: string;
      organizationId?: string | null;
      /** BCP 47, from User.locale (spec 030). */
      locale?: string;
      /** IANA identifier or null for the browser default (spec 030). */
      timeZone?: string | null;
    };
  }
}
