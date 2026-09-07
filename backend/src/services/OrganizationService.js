// Organization Service
// CRUD operations for organizations per FR-048

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';

export const serializeBusinessDetails = (organization) => {
  const { ein, ...businessDetails } = organization;
  const lastFour = ein?.slice(-4);

  return {
    ...businessDetails,
    hasEin: Boolean(ein),
    einMasked: lastFour ? `••-•••${lastFour}` : null,
  };
};

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

  /** Return masked business details for the organization assigned to a user. */
  async getBusinessDetailsForUser(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organization: true },
    });

    return user?.organization ? serializeBusinessDetails(user.organization) : null;
  }

  /** Update only the organization assigned to a user and return a masked response. */
  async updateBusinessDetailsForUser(userId, data) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    if (!user?.organizationId) return null;

    const organization = await prisma.organization.update({
      where: { id: user.organizationId },
      data,
    });

    logger.info('Organization business details updated', {
      event: 'organization_business_details_updated',
      organizationId: organization.id,
      changes: Object.keys(data),
    });

    return serializeBusinessDetails(organization);
  }
}

export default new OrganizationService();
