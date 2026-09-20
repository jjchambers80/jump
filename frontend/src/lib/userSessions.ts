// Server-only helpers for the revocable session rows behind the JWT `sid`
// claim (spec 030 D). Called from the Auth.js jwt callback, which has no
// request: device/location columns are filled by the backend on the first
// API call (SessionService.touch).

import { prisma } from '@jump/db';

/**
 * The session id a token should carry.
 *
 * - Fresh sign-in (`signIn` true): always a new row.
 * - Token with a `sid`: keep it while the row exists and is not revoked;
 *   return null when revoked (the caller invalidates the cookie); a row
 *   swept away is replaced.
 * - Legacy token without `sid`: adopt it with a new row.
 */
export async function resolveSessionId(
  userId: string,
  sid: string | undefined,
  { signIn, provider }: { signIn: boolean; provider?: string | null }
): Promise<string | null> {
  if (!signIn && sid) {
    const row = await prisma.userSession.findUnique({ where: { id: sid }, select: { revokedAt: true, userId: true } });
    if (row && row.userId === userId) return row.revokedAt ? null : sid;
  }
  const created = await prisma.userSession.create({
    data: { userId, provider: provider ?? null },
    select: { id: true },
  });
  return created.id;
}

/** Mark the row behind a signed-out cookie so it leaves the Devices list at once. */
export async function revokeSessionOnSignOut(sid: string | undefined): Promise<void> {
  if (!sid) return;
  await prisma.userSession.updateMany({
    where: { id: sid, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: 'sign-out' },
  });
}
