// Organization Service
// CRUD operations for organizations per FR-048

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import { formatEventSummary } from '../utils/eventSummary.js';

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

  /** Get public organization info with published events. */
  async getPublicOrganization(id) {
    const org = await prisma.organization.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        coverUrl: true,
        venues: {
          select: {
            events: {
              where: { status: 'PUBLISHED' },
              orderBy: { date: 'asc' },
              select: {
                id: true,
                name: true,
                date: true,
                category: true,
                status: true,
                venue: { select: { id: true, name: true, address: true } },
                priceTiers: {
                  where: { isActive: true },
                  select: {
                    price: true,
                    quantityTotal: true,
                    quantitySold: true,
                    quantityReserved: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const events = org.venues.flatMap((v) => v.events).map(formatEventSummary);
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      organization: {
        id: org.id,
        name: org.name,
        logoUrl: org.logoUrl,
        coverUrl: org.coverUrl,
      },
      events,
    };
  }

  /** Set or clear organization logo. */
  async setOrganizationLogo(id, logoUrl, imageId) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { logoUrl: true, logoImageId: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const data = { logoUrl };
    if (imageId !== undefined) data.logoImageId = imageId;

    const organization = await prisma.organization.update({ where: { id }, data });

    logger.info('Organization logo updated', {
      event: 'organization_logo_updated',
      organizationId: id,
      removed: logoUrl === null,
    });

    return { organization, previousLogoUrl: existing.logoUrl, previousLogoImageId: existing.logoImageId };
  }

  /** Set or clear organization cover image. */
  async setOrganizationCover(id, coverUrl, imageId) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { coverUrl: true, coverImageId: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const data = { coverUrl };
    if (imageId !== undefined) data.coverImageId = imageId;

    const organization = await prisma.organization.update({ where: { id }, data });

    logger.info('Organization cover updated', {
      event: 'organization_cover_updated',
      organizationId: id,
      removed: coverUrl === null,
    });

    return { organization, previousCoverUrl: existing.coverUrl, previousCoverImageId: existing.coverImageId };
  }
}

export default new OrganizationService();
