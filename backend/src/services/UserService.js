// User management service
// Admin-only operations: list users, update roles, deactivation
// Per FR-056

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

class UserService {
  /**
   * List users with optional filters and pagination.
   * @param {Object} options
   * @param {string} [options.role] - Filter by UserRole
   * @param {string} [options.organizationId] - Filter by organization
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.limit=20] - Items per page
   * @returns {Promise<{ users: Array, pagination: Object }>}
   */
  async listUsers({ role, organizationId, page = 1, limit = 20 } = {}) {
    const where = { deletedAt: null };

    if (role) where.role = role;
    if (organizationId) where.organizationId = organizationId;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
        },
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
   * @returns {Promise<Object>}
   */
  async updateUser(userId, data) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new NotFoundError('User not found');
    }

    const updateData = {};
    if (data.role !== undefined) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.organizationId !== undefined) updateData.organizationId = data.organizationId;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    logger.info('User updated', {
      event: 'user_updated',
      userId: updated.id,
      changes: Object.keys(updateData),
    });

    return this._formatUser(updated);
  }

  /**
   * Format user for API response (UserSummary schema).
   */
  _formatUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization?.name || null,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}

export default new UserService();
