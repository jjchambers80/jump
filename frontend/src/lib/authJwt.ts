// Edge-safe HS256 session token codec for Auth.js.
//
// The backend verifies these tokens with `jsonwebtoken` (HS256, AUTH_SECRET),
// so Auth.js cannot use its default JWE cookies. This codec uses `jose`, which
// runs on the edge, so the same decode works in middleware.ts and in auth.ts.
// Tokens minted here are byte-for-byte compatible with what `jsonwebtoken`
// produced before (same alg, same claims, same secret bytes).

// Subpath imports keep jose's JWE/compression code out of the edge bundle.
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import type { JWTPayload } from 'jose';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/** Claims Auth.js keeps in the session cookie. */
export interface SessionClaims extends JWTPayload {
  sub?: string;
  email?: string | null;
  role?: string;
  name?: string | null;
  organizationId?: string | null;
  /** Spec 030 account preferences + avatar, so the admin UI reads them from the session. */
  locale?: string;
  timeZone?: string | null;
  picture?: string | null;
}

export async function encodeSessionToken(token: SessionClaims): Promise<string> {
  return new SignJWT({
    email: token.email ?? undefined,
    role: token.role,
    name: token.name ?? undefined,
    organizationId: token.organizationId ?? null,
    locale: token.locale ?? undefined,
    timeZone: token.timeZone ?? undefined,
    picture: token.picture ?? undefined,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(token.sub ?? '')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(secretKey());
}

export async function decodeSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return payload as SessionClaims;
  } catch {
    return null;
  }
}
