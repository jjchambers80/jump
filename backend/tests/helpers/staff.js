// Staff fixtures for contract/integration tests.
//
// Org-scoped routes resolve access through OrganizationMember (spec 007), so a
// JWT for a user that does not exist in the database is denied. These helpers
// create real users and memberships. Emails are stable per suite, so re-runs
// upsert instead of accumulating rows.

import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';

const AUTH_SECRET = process.env.AUTH_SECRET;

export function signToken(user, overrides = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name || 'Test User', ...overrides },
    AUTH_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

/**
 * Create (or reset) a staff user and return a bearer token for it.
 * Existing memberships are cleared so each suite starts from a known state.
 */
export async function staffToken({ email, role = 'ORGANIZER', name = 'Test User' }) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { role, name, isActive: true, deletedAt: null, memberships: { deleteMany: {} } },
    create: { email, role, name },
  });
  return signToken(user);
}

/** Add the user behind a token to an organization with the given member role. */
export async function joinOrgByToken(token, organizationId, role = 'ORGANIZER') {
  const { sub: userId } = jwt.decode(token);
  await prisma.organizationMember.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    update: { role },
    create: { userId, organizationId, role },
  });
}

/** Remove users created by staffToken (by email). Safe to call when they are gone. */
export async function cleanupStaff(emails) {
  await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => {});
}
