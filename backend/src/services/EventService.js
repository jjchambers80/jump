// Event Service (Schema Redesign)
// Handles event CRUD, status transitions, and venue-scoped operations
// Per FR-012, FR-013, FR-050

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

class EventService {
  /**
   * Create a new event in DRAFT status with price tiers
   * @param {string} orgId - Organization ID
   * @param {Object} data - Event data including priceTiers array
   * @returns {Promise<Object>} Created event with venue and price tiers
   */
  async createEvent(orgId, data) {
    const { venueId, name, description, date, capacity, category, priceTiers } = data;

    // Validate venue belongs to org
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, organizationId: orgId },
    });
    if (!venue) {
      throw new ValidationError('Venue not found in this organization');
    }

    // Validate capacity
    const capacityNum = parseInt(capacity);
    if (isNaN(capacityNum) || capacityNum < 1 || capacityNum > 100000) {
      throw new ValidationError('Capacity must be between 1 and 100,000');
    }

    // Validate date is in the future
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      throw new ValidationError('Invalid date format');
    }
    if (eventDate <= new Date()) {
      throw new ValidationError('Event date must be in the future');
    }

    // Validate price tier capacity sum
    if (priceTiers && priceTiers.length > 0) {
      const totalTierQuantity = priceTiers.reduce(
        (sum, t) => sum + (parseInt(t.quantityTotal) || 0),
        0
      );
      if (totalTierQuantity > capacityNum) {
        throw new ValidationError(
          `Total tier inventory (${totalTierQuantity}) exceeds event capacity (${capacityNum})`
        );
      }
    }

    // Create event with price tiers in a transaction
    const event = await prisma.event.create({
      data: {
        venueId,
        name,
        description: description || null,
        date: eventDate,
        capacity: capacityNum,
        category: category || null,
        status: 'DRAFT',
        priceTiers: {
          create: (priceTiers || []).map((tier, index) => ({
            name: tier.name,
            price: tier.price,
            quantityTotal: parseInt(tier.quantityTotal),
            displayOrder: tier.displayOrder ?? index,
            minPerOrder: tier.minPerOrder ?? null,
            maxPerOrder: tier.maxPerOrder ?? null,
            isActive: true,
          })),
        },
      },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    logger.info('Event created', {
      event: 'event_created',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    return this._formatEventDetail(event);
  }

  /**
   * Update an event (org-scoped)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated event
   */
  async updateEvent(orgId, eventId, updates) {
    // Find event and verify org ownership
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: {
        priceTiers: true,
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    const updateData = {};

    if (updates.name !== undefined) {
      if (!updates.name || updates.name.length > 255) {
        throw new ValidationError('Event name must be between 1 and 255 characters');
      }
      updateData.name = updates.name;
    }

    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }

    if (updates.date !== undefined) {
      const eventDate = new Date(updates.date);
      if (isNaN(eventDate.getTime()) || eventDate <= new Date()) {
        throw new ValidationError('Event date must be a valid future date');
      }
      updateData.date = eventDate;
    }

    if (updates.capacity !== undefined) {
      const cap = parseInt(updates.capacity);
      if (isNaN(cap) || cap < 1 || cap > 100000) {
        throw new ValidationError('Capacity must be between 1 and 100,000');
      }
      // Capacity floor check: can't go below sum of tier quantities
      const totalTierQuantity = existing.priceTiers.reduce((sum, t) => sum + t.quantityTotal, 0);
      if (cap < totalTierQuantity) {
        throw new ValidationError(
          `Capacity cannot be less than total tier inventory (${totalTierQuantity})`
        );
      }
      updateData.capacity = cap;
    }

    if (updates.category !== undefined) {
      updateData.category = updates.category;
    }

    if (updates.venueId !== undefined) {
      // Validate venue belongs to org
      const venue = await prisma.venue.findFirst({
        where: { id: updates.venueId, organizationId: orgId },
      });
      if (!venue) {
        throw new ValidationError('Venue not found in this organization');
      }
      updateData.venueId = updates.venueId;
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: updateData,
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    logger.info('Event updated', {
      event: 'event_updated',
      orgId,
      eventId: event.id,
      updatedFields: Object.keys(updateData),
    });

    return this._formatEventDetail(event);
  }

  /**
   * Publish an event (DRAFT → PUBLISHED)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Published event
   */
  async publishEvent(orgId, eventId) {
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    if (existing.status !== 'DRAFT') {
      throw new ConflictError(
        `Cannot publish event with status ${existing.status}. Only DRAFT events can be published.`
      );
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    logger.info('Event published', {
      event: 'event_published',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    return this._formatEventDetail(event);
  }

  /**
   * Cancel an event (PUBLISHED → CANCELLED)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Cancelled event
   */
  async cancelEvent(orgId, eventId) {
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    if (existing.status !== 'PUBLISHED') {
      throw new ConflictError(
        `Cannot cancel event with status ${existing.status}. Only PUBLISHED events can be cancelled.`
      );
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED' },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    logger.info('Event cancelled', {
      event: 'event_cancelled',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    // TODO: Notify ticket holders (T076)

    return this._formatEventDetail(event);
  }

  /**
   * List published events (public, no auth required)
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} Paginated events
   */
  async listPublishedEvents({ page = 1, limit = 20, category, dateFrom, dateTo } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { status: 'PUBLISHED' };
    if (category) where.category = category;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          venue: {
            select: { id: true, name: true, address: true },
          },
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
        orderBy: { date: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
    ]);

    const formattedEvents = events.map((event) => {
      const activePrices = event.priceTiers.map((t) => Number(t.price));
      const availableTickets = event.priceTiers.reduce(
        (sum, t) => sum + (t.quantityTotal - t.quantitySold - t.quantityReserved),
        0
      );

      return {
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue,
        category: event.category,
        status: event.status,
        priceRange:
          activePrices.length > 0
            ? { min: Math.min(...activePrices), max: Math.max(...activePrices) }
            : null,
        availableTickets,
      };
    });

    return {
      events: formattedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get single event by ID (public, published only)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Event detail with venue and price tiers
   */
  async getEventById(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    if (!event || event.status !== 'PUBLISHED') {
      throw new NotFoundError('Event not found');
    }

    return this._formatEventDetail(event);
  }

  /**
   * List events for an organization (all statuses, org-scoped)
   * @param {string} orgId - Organization ID
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} Paginated org events
   */
  async listOrgEvents(orgId, { page = 1, limit = 20, status } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { venue: { organizationId: orgId } };
    if (status) where.status = status;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          venue: true,
          priceTiers: { orderBy: { displayOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
    ]);

    return {
      events: events.map((e) => this._formatEventDetail(e)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get event with ticket count (for internal use)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Event with ticket count
   */
  async getEventWithTicketCount(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        priceTiers: true,
        _count: { select: { tickets: true } },
      },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    return {
      ...event,
      soldTickets: event._count.tickets,
      availableTickets: event.capacity - event._count.tickets,
    };
  }

  /**
   * Get analytics for an event: per-tier sold, redeemed, remaining, revenue,
   * plus event-level aggregates.
   * Per FR-057
   *
   * @param {string} orgId - Organization ID (for ownership check)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Analytics breakdown
   */
  async getEventAnalytics(orgId, eventId) {
    // Verify event belongs to org
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: {
        venue: { select: { id: true, name: true } },
        priceTiers: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    // Count redeemed tickets per tier
    const redeemedCounts = await prisma.ticket.groupBy({
      by: ['priceTierId'],
      where: {
        eventId,
        status: 'REDEEMED',
      },
      _count: { id: true },
    });

    const redeemedMap = {};
    for (const row of redeemedCounts) {
      redeemedMap[row.priceTierId] = row._count.id;
    }

    // Build per-tier breakdown
    const tiers = event.priceTiers.map((tier) => {
      const sold = tier.quantitySold;
      const redeemed = redeemedMap[tier.id] || 0;
      const remaining = tier.quantityTotal - sold - tier.quantityReserved;
      const revenue = sold * Number(tier.price);

      return {
        id: tier.id,
        name: tier.name,
        price: Number(tier.price),
        quantityTotal: tier.quantityTotal,
        sold,
        redeemed,
        remaining: Math.max(0, remaining),
        revenue,
      };
    });

    // Event-level aggregates
    const totalSold = tiers.reduce((sum, t) => sum + t.sold, 0);
    const totalRedeemed = tiers.reduce((sum, t) => sum + t.redeemed, 0);
    const totalRemaining = tiers.reduce((sum, t) => sum + t.remaining, 0);
    const totalRevenue = tiers.reduce((sum, t) => sum + t.revenue, 0);

    return {
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        status: event.status,
        capacity: event.capacity,
        venue: event.venue,
      },
      totals: {
        sold: totalSold,
        redeemed: totalRedeemed,
        remaining: totalRemaining,
        revenue: totalRevenue,
      },
      tiers,
    };
  }

  /**
   * Format event detail for API response
   */
  _formatEventDetail(event) {
    return {
      id: event.id,
      name: event.name,
      description: event.description,
      date: event.date,
      capacity: event.capacity,
      category: event.category,
      status: event.status,
      venue: event.venue
        ? {
            id: event.venue.id,
            name: event.venue.name,
            address: event.venue.address,
            timezone: event.venue.timezone,
          }
        : null,
      priceTiers: (event.priceTiers || []).map((t) => ({
        id: t.id,
        eventId: t.eventId,
        name: t.name,
        price: Number(t.price),
        quantityTotal: t.quantityTotal,
        quantitySold: t.quantitySold,
        quantityReserved: t.quantityReserved,
        quantityAvailable: t.quantityTotal - t.quantitySold - t.quantityReserved,
        displayOrder: t.displayOrder,
        minPerOrder: t.minPerOrder,
        maxPerOrder: t.maxPerOrder,
        isActive: t.isActive,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}

export default new EventService();
