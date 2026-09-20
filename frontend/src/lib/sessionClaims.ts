// frontend/src/lib/sessionClaims.ts
// Pure helpers for keeping the Auth.js JWT's role/org claims in sync with the database.
// auth.ts owns the Prisma call; everything here is testable without a DB.

/** How long a token's role/org claims are trusted before re-reading them from the DB. */
export const CLAIMS_REFRESH_MS = 60_000;

/** Snapshot of the User row that becomes JWT claims. */
export interface UserClaims {
  role: string;
  name: string | null;
  email: string;
  organizationId: string | null;
  /** Spec 030 account preferences; undefined when the caller has no profile data. */
  locale?: string;
  timeZone?: string | null;
  /** Avatar URL (uploaded photo thumb, else the provider picture). */
  picture?: string | null;
  /** Whether the account has two-step authentication on (spec 030 C). */
  twoStepEnabled?: boolean;
}

/** The subset of the Auth.js token this module reads and writes. */
export interface ClaimsToken {
  sub?: string;
  role?: unknown;
  name?: unknown;
  email?: unknown;
  organizationId?: unknown;
  locale?: unknown;
  timeZone?: unknown;
  picture?: unknown;
  /** Revocable session row id (spec 030 D). */
  sid?: unknown;
  /** Two-step state (spec 030 C). */
  mfa?: unknown;
  /** Epoch ms of the last DB read backing role/organizationId. */
  claimsRefreshedAt?: unknown;
}

/**
 * Whether the token's claims are stale enough to re-read from the DB.
 * Tokens minted before this field existed (no claimsRefreshedAt) always refresh.
 */
export function shouldRefreshClaims(token: ClaimsToken, now: number): boolean {
  if (!token.sub) return false;
  const last = typeof token.claimsRefreshedAt === 'number' ? token.claimsRefreshedAt : 0;
  return now - last >= CLAIMS_REFRESH_MS;
}

/** Copy fresh DB claims onto the token and stamp the refresh time. */
export function applyUserClaims<T extends ClaimsToken>(token: T, claims: UserClaims, now: number): T {
  token.role = claims.role;
  token.name = claims.name;
  token.email = claims.email;
  token.organizationId = claims.organizationId;
  if (claims.locale !== undefined) token.locale = claims.locale;
  if (claims.timeZone !== undefined) token.timeZone = claims.timeZone;
  if (claims.picture !== undefined) token.picture = claims.picture;
  token.claimsRefreshedAt = now;
  return token;
}
