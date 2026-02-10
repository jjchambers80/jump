// Venue Service
// CRUD operations for venues scoped to organizations per FR-049, FR-010

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError } from '../middleware/errorHandler.js';

class VenueService {
  /**
   * Create a new venue within an organization
   * @param {string} orgId - Organization ID
   * @param {Object} data - { name, address, timezone?, isPublic? }
   * @returns {Promise<Object>} Created venue
   */
  async createVenue(orgId, data) {
    const venue = await prisma.venue.create({
      data: {
        organizationId: orgId,
        name: data.name,
        address: data.address,
        timezone: data.timezone || 'America/New_York',
        isPublic: data.isPublic !== undefined ? data.isPublic : true,
      },
    });

    logger.info('Venue created', {
      event: 'venue_created',
      venueId: venue.id,
      organizationId: orgId,
      name: venue.name,
    });

    return venue;
  }

  /**
   * Get venue by ID, scoped to organization
   * @param {string} orgId - Organization ID
   * @param {string} id - Venue ID
   * @returns {Promise<Object|null>} Venue or null
   */
  async getVenueById(orgId, id) {
    return prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });
  }

  /**
   * List venues for an organization
   * @param {string} orgId - Organization ID
   * @returns {Promise<Array>} List of venues
   */
  async listVenuesByOrganization(orgId) {
    return prisma.venue.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });
  }

  /**
   * Update a venue
   * @param {string} orgId - Organization ID
   * @param {string} id - Venue ID
   * @param {Object} data - Fields to update { name?, address?, timezone?, isPublic? }
   * @returns {Promise<Object>} Updated venue
   */
  async updateVenue(orgId, id, data) {
    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

    const venue = await prisma.venue.update({
      where: { id },
      data: updateData,
    });

    logger.info('Venue updated', {
      event: 'venue_updated',
      venueId: venue.id,
      organizationId: orgId,
      changes: Object.keys(updateData),
    });

    return venue;
  }

  /**
   * Delete a venue (FR-010: prevent deletion if linked events exist)
   * @param {string} orgId - Organization ID
   * @param {string} id - Venue ID
   * @returns {Promise<void>}
   */
  async deleteVenue(orgId, id) {
    // Check for linked events
    const eventCount = await prisma.event.count({
      where: { venueId: id },
    });

    if (eventCount > 0) {
      throw new ConflictError(
        `Cannot delete venue — ${eventCount} event(s) are linked to this venue`
      );
    }

    await prisma.venue.delete({
      where: { id },
    });

    logger.info('Venue deleted', {
      event: 'venue_deleted',
      venueId: id,
      organizationId: orgId,
    });
  }
}

export default new VenueService();
