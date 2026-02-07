// Admin Event Service
// Handles event creation, updating, and publishing for admins per FR-011, FR-012, FR-013

import { PrismaClient } from '@prisma/client';
import { ValidationError, NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

class AdminEventService {
  /**
   * Create a new event in DRAFT status (FR-011)
   * @param {string} adminId - Admin user ID (organizer)
   * @param {Object} eventData - Event details
   * @returns {Promise<Object>} Created event
   */
  async createEvent(adminId, eventData) {
    const { name, date, venue, capacity, ticketPrice } = eventData;

    // Validate required fields
    if (!name || !date || !venue || capacity === undefined || ticketPrice === undefined) {
      throw new ValidationError(
        'All fields are required: name, date, venue, capacity, ticketPrice'
      );
    }

    // Name length (max 255)
    if (name.length > 255) {
      throw new ValidationError('Event name must be 255 characters or less');
    }

    // Venue length (max 500)
    if (venue.length > 500) {
      throw new ValidationError('Venue must be 500 characters or less');
    }

    // Capacity range: 1-100,000 (FR-012)
    const capacityNum = parseInt(capacity);
    if (isNaN(capacityNum) || capacityNum < 1 || capacityNum > 100000) {
      throw new ValidationError('Capacity must be between 1 and 100,000');
    }

    // Price non-negative (FR-012)
    const priceNum = parseFloat(ticketPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      throw new ValidationError('Ticket price must be 0 or greater');
    }

    // Future date validation
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      throw new ValidationError('Invalid date format. Use ISO 8601');
    }
    if (eventDate <= new Date()) {
      throw new ValidationError('Event date must be in the future');
    }

    // Create event in DRAFT status
    const event = await prisma.event.create({
      data: {
        organizerId: adminId,
        name,
        date: eventDate,
        venue,
        capacity: capacityNum,
        ticketPrice: priceNum,
        status: 'DRAFT',
      },
      include: {
        organizer: {
          select: { name: true, organization: true },
        },
        _count: {
          select: { tickets: true },
        },
      },
    });

    logger.info('Event created', {
      event: 'event_created',
      adminId,
      eventId: event.id,
      eventName: event.name,
    });

    return this._formatEvent(event);
  }

  /**
   * Update an existing event (FR-011)
   * @param {string} eventId - Event UUID
   * @param {string} adminId - Admin user ID (must be organizer)
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated event
   */
  async updateEvent(eventId, adminId, updates) {
    // Find event and verify ownership (RBAC)
    const existing = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    // Verify ownership (T094 - RBAC check)
    if (existing.organizerId !== adminId) {
      throw new ForbiddenError('You can only modify your own events');
    }

    // Build update data (only include provided fields)
    const updateData = {};

    if (updates.name !== undefined) {
      if (updates.name.length > 255) {
        throw new ValidationError('Event name must be 255 characters or less');
      }
      updateData.name = updates.name;
    }

    if (updates.venue !== undefined) {
      if (updates.venue.length > 500) {
        throw new ValidationError('Venue must be 500 characters or less');
      }
      updateData.venue = updates.venue;
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
      updateData.capacity = cap;
    }

    if (updates.ticketPrice !== undefined) {
      const price = parseFloat(updates.ticketPrice);
      if (isNaN(price) || price < 0) {
        throw new ValidationError('Ticket price must be 0 or greater');
      }
      updateData.ticketPrice = price;
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: updateData,
      include: {
        organizer: {
          select: { name: true, organization: true },
        },
        _count: {
          select: { tickets: true },
        },
      },
    });

    logger.info('Event updated', {
      event: 'event_updated',
      adminId,
      eventId: event.id,
      updatedFields: Object.keys(updateData),
    });

    return this._formatEvent(event);
  }

  /**
   * Publish an event, making it visible to customers (FR-011)
   * @param {string} eventId - Event UUID
   * @param {string} adminId - Admin user ID (must be organizer)
   * @returns {Promise<Object>} Published event
   */
  async publishEvent(eventId, adminId) {
    const existing = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    // Verify ownership (RBAC)
    if (existing.organizerId !== adminId) {
      throw new ForbiddenError('You can only publish your own events');
    }

    if (existing.status === 'PUBLISHED') {
      throw new ValidationError('Event is already published');
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
      include: {
        organizer: {
          select: { name: true, organization: true },
        },
        _count: {
          select: { tickets: true },
        },
      },
    });

    logger.info('Event published', {
      event: 'event_published',
      adminId,
      eventId: event.id,
      eventName: event.name,
    });

    return this._formatEvent(event);
  }

  /**
   * Get dashboard statistics for admin (FR-014, FR-025)
   * @param {string} adminId - Admin user ID
   * @param {string|null} eventId - Optional: filter by specific event
   * @returns {Promise<Object>} Dashboard statistics
   */
  async getDashboardStats(adminId, eventId = null) {
    const where = { organizerId: adminId };
    if (eventId) {
      where.id = eventId;
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        _count: {
          select: { tickets: true },
        },
      },
    });

    const totalCapacity = events.reduce((sum, e) => sum + e.capacity, 0);
    const ticketsSold = events.reduce((sum, e) => sum + e._count.tickets, 0);

    // Count redeemed tickets
    const ticketsRedeemedCount = await prisma.ticket.count({
      where: {
        event: { organizerId: adminId, ...(eventId ? { id: eventId } : {}) },
        status: 'REDEEMED',
      },
    });

    // Calculate sales rate (tickets sold in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSales = await prisma.ticket.count({
      where: {
        event: { organizerId: adminId, ...(eventId ? { id: eventId } : {}) },
        purchaseTime: { gte: oneHourAgo },
      },
    });
    const salesRate = parseFloat((recentSales / 60).toFixed(2)); // per minute

    // Payment success rate
    const totalPayments = await prisma.paymentTransaction.count({
      where: {
        event: { organizerId: adminId, ...(eventId ? { id: eventId } : {}) },
      },
    });
    const successfulPayments = await prisma.paymentTransaction.count({
      where: {
        event: { organizerId: adminId, ...(eventId ? { id: eventId } : {}) },
        status: 'SUCCEEDED',
      },
    });
    const paymentSuccessRate =
      totalPayments > 0 ? parseFloat(((successfulPayments / totalPayments) * 100).toFixed(1)) : 100;

    return {
      totalCapacity,
      ticketsSold,
      remainingCapacity: totalCapacity - ticketsSold,
      ticketsRedeemed: ticketsRedeemedCount,
      salesRate,
      paymentSuccessRate,
    };
  }

  /**
   * Get admin's events list
   * @param {string} adminId - Admin user ID
   * @returns {Promise<Array>} List of admin's events
   */
  async getAdminEvents(adminId) {
    const events = await prisma.event.findMany({
      where: { organizerId: adminId },
      include: {
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map((event) => ({
      id: event.id,
      name: event.name,
      date: event.date,
      venue: event.venue,
      capacity: event.capacity,
      ticketPrice: event.ticketPrice,
      status: event.status,
      ticketsSold: event._count.tickets,
      availableTickets: event.capacity - event._count.tickets,
      createdAt: event.createdAt,
    }));
  }

  /**
   * Format event for API response
   */
  _formatEvent(event) {
    return {
      id: event.id,
      name: event.name,
      date: event.date,
      venue: event.venue,
      capacity: event.capacity,
      ticketPrice: event.ticketPrice,
      status: event.status,
      ticketsSold: event._count?.tickets || 0,
      availableTickets: event.capacity - (event._count?.tickets || 0),
      organizer: event.organizer
        ? { name: event.organizer.name, organization: event.organizer.organization }
        : undefined,
      createdAt: event.createdAt,
    };
  }
}

export default new AdminEventService();
