// Organization Service
// CRUD operations for organizations per FR-048

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';

class OrganizationService {
  /**
   * Create a new organization
   * @param {Object} data - { name }
   * @returns {Promise<Object>} Created organization
   */
  async createOrganization(data) {
    const organization = await prisma.organization.create({
      data: {
        name: data.name,
      },
    });

    logger.info('Organization created', {
      event: 'organization_created',
      organizationId: organization.id,
      name: organization.name,
    });

    return organization;
  }

  /**
   * Get organization by ID
   * @param {string} id - Organization ID
   * @returns {Promise<Object|null>} Organization or null
   */
  async getOrganizationById(id) {
    return prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: { venues: true, users: true },
        },
      },
    });
  }

  /**
   * List all organizations
   * @returns {Promise<Array>} List of organizations
   */
  async listOrganizations() {
    return prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { venues: true, users: true },
        },
      },
    });
  }

  /**
   * Update an organization
   * @param {string} id - Organization ID
   * @param {Object} data - Fields to update { name?, status? }
   * @returns {Promise<Object>} Updated organization
   */
  async updateOrganization(id, data) {
    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;

    const organization = await prisma.organization.update({
      where: { id },
      data: updateData,
    });

    logger.info('Organization updated', {
      event: 'organization_updated',
      organizationId: organization.id,
      changes: Object.keys(updateData),
    });

    return organization;
  }
}

export default new OrganizationService();
