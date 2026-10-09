// User management service
// Admin-only operations: list users, update roles, deactivation
// Per FR-056

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// Memberships oldest-first; the first one is the active org until an org switcher exists.
const membershipInclude = {
  memberships: {
    orderBy: { createdAt: 'asc' },
    select: { role: true, organization: { select: { id: true, name: true } } },
  },
};

class UserService {
  /**
   * List users with optional filters and pagination.
   * @param {Object} options
   * @param {string} [options.role] - Filter by UserRole
   * @param {string} [options.organizationId] - Filter by organization
   * @param {string} [options.q] - Case-insensitive search on email / name
   * @param {boolean} [options.isActive] - Filter by active status
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.limit=20] - Items per page
   * @returns {Promise<{ users: Array, pagination: Object }>}
   */
  async listUsers({ role, organizationId, q, isActive, page = 1, limit = 20 } = {}) {
    const where = { deletedAt: null };

    if (role) where.role = role;
    if (organizationId) where.memberships = { some: { organizationId } };
    if (isActive !== undefined) where.isActive = isActive;
    if (q) {
      where.OR = ['email', 'name', 'firstName', 'lastName'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      }));
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: membershipInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map(this._formatUser),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update user role or active status.
   * @param {string} userId
   * @param {Object} data
   * @param {string} [data.role] - New role
   * @param {boolean} [data.isActive] - Active status
   * @param {string} [data.organizationId] - Organization to assign (nullable)
   * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient }} [options]
   *   Run inside the caller's transaction (e.g. one holding an advisory lock).
   * @returns {Promise<Object>}
   */
  async updateUser(userId, data, { tx: outerTx } = {}) {
    const user = await (outerTx ?? prisma).user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new NotFoundError('User not found');
    }

    const updateData = {};
    if (data.role !== undefined) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Org assignment is a membership row, not a column. Passing organizationId
    // replaces the user's memberships with that single org (null clears them).
    // Only ADMIN/ORGANIZER hold memberships: SYSTEM_ADMIN is unscoped and
    // UNASSIGNED is not staff, so those roles never get (or keep) one.
    const effectiveRole = data.role ?? user.role;
    const isStaffRole = effectiveRole === 'ADMIN' || effectiveRole === 'ORGANIZER';
    const inTx = (fn) => (outerTx ? fn(outerTx) : prisma.$transaction(fn));
    const updated = await inTx(async (tx) => {
      if (data.organizationId !== undefined || !isStaffRole) {
        await tx.organizationMember.deleteMany({ where: { userId } });
        if (data.organizationId && isStaffRole) {
          await tx.organizationMember.create({
            data: { userId, organizationId: data.organizationId, role: effectiveRole },
          });
        }
      } else if (data.role !== undefined) {
        // Staff role change without reassignment: keep existing memberships in step.
        await tx.organizationMember.updateMany({ where: { userId }, data: { role: data.role } });
      }

      return tx.user.update({
        where: { id: userId },
        data: updateData,
        include: membershipInclude,
      });
    });

    const changes = Object.keys(updateData);
    if (data.organizationId !== undefined) changes.push('organizationId');
    logger.info('User updated', {
      event: 'user_updated',
      userId: updated.id,
      changes,
    });

    return this._formatUser(updated);
  }

  /**
   * Format user for API response (UserSummary schema).
   */
  _formatUser(user) {
    const memberships = user.memberships || [];
    const primary = memberships[0]?.organization || null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: primary?.id || null,
      organizationName: primary?.name || null,
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}

export default new UserService();
