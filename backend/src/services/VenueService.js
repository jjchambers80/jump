// Venue Service
// CRUD operations for venues scoped to organizations per FR-049, FR-010

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError } from '../middleware/errorHandler.js';
import { formatEventSummary } from '../utils/eventSummary.js';

class VenueService {
  /** Create a new venue within an organization. */
  async createVenue(orgId, data) {
    const venue = await prisma.venue.create({
      data: {
        organizationId: orgId,
        name: data.name,
        address: data.address,
        city: data.city || null,
        state: data.state || null,
        postalCode: data.postalCode || null,
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

  /** Get venue by ID, scoped to organization. */
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

  /** Get public venue fields and published event summaries. */
  async getPublicVenueById(id) {
    const venue = await prisma.venue.findFirst({
      where: {
        id,
        isPublic: true,
        organization: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        name: true,
        address: true,
        timezone: true,
        logoUrl: true,
        organization: { select: { brandColor: true, themeMode: true } },
        events: {
          where: { status: 'PUBLISHED' },
          orderBy: { date: 'asc' },
          select: {
            id: true,
            name: true,
            date: true,
            category: true,
            status: true,
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
    });

    if (!venue) {
      throw new NotFoundError('Venue not found');
    }

    const publicVenue = {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      timezone: venue.timezone,
      logoUrl: venue.logoUrl,
      brandColor: venue.organization?.brandColor || null,
      themeMode: venue.organization?.themeMode || 'USER',
    };
    const eventVenue = {
      id: venue.id,
      name: venue.name,
      address: venue.address,
    };

    return {
      venue: publicVenue,
      events: venue.events.map((event) =>
        formatEventSummary({ ...event, venue: eventVenue })
      ),
    };
  }

  /** List venues for an organization. */
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

  /** Update venue metadata after verifying organization ownership. */
  async updateVenue(orgId, id, data) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

    const venue = await prisma.venue.update({ where: { id }, data: updateData });

    logger.info('Venue updated', {
      event: 'venue_updated',
      venueId: venue.id,
      organizationId: orgId,
      changes: Object.keys(updateData),
    });

    return venue;
  }

  /** Set or clear a venue logo after verifying organization ownership. */
  async setVenueLogo(orgId, id, logoUrl, imageId) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      select: { logoUrl: true, imageId: true },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const data = { logoUrl };
    if (imageId !== undefined) data.imageId = imageId;

    const venue = await prisma.venue.update({ where: { id }, data });

    logger.info('Venue logo updated', {
      event: 'venue_logo_updated',
      venueId: id,
      organizationId: orgId,
      removed: logoUrl === null,
    });

    return { venue, previousLogoUrl: existing.logoUrl };
  }

  /** Delete a venue unless linked events exist. */
  async deleteVenue(orgId, id) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const eventCount = await prisma.event.count({
      where: { venueId: id, venue: { organizationId: orgId } },
    });

    if (eventCount > 0) {
      throw new ConflictError(
        `Cannot delete venue — ${eventCount} event(s) are linked to this venue`
      );
    }

    await prisma.venue.delete({ where: { id } });

    logger.info('Venue deleted', {
      event: 'venue_deleted',
      venueId: id,
      organizationId: orgId,
    });
  }
}

export default new VenueService();
