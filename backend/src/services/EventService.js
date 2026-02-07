// Event Service
// Handles event listing and retrieval per FR-001

import { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../middleware/errorHandler.js';

const prisma = new PrismaClient();

class EventService {
  /**
   * List published events with pagination
   * @param {number} page - Page number (1-indexed)
   * @param {number} limit - Number of events per page
   * @returns {Promise<{events: Array, total: number, page: number, limit: number}>}
   */
  async listPublishedEvents(page = 1, limit = 20) {
    // Validate inputs
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Get published events only with ticket count
    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
        },
        select: {
          id: true,
          name: true,
          date: true,
          venue: true,
          capacity: true,
          ticketPrice: true,
          status: true,
          createdAt: true,
          _count: {
            select: { tickets: true },
          },
        },
        orderBy: {
          date: 'asc',
        },
        skip,
        take: limitNum,
      }),
      prisma.event.count({
        where: {
          status: 'PUBLISHED',
        },
      }),
    ]);

    // Add available capacity to each event
    const eventsWithAvailability = events.map((event) => ({
      ...event,
      soldTickets: event._count.tickets,
      availableTickets: event.capacity - event._count.tickets,
      _count: undefined, // Remove _count from response
    }));

    return {
      events: eventsWithAvailability,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  /**
   * Get single event by ID (published only)
   * @param {string} eventId - UUID of the event
   * @returns {Promise<Object>} Event details with availability
   */
  async getEventById(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: {
          select: {
            name: true,
            organization: true,
          },
        },
        _count: {
          select: { tickets: true },
        },
      },
    });

    // Event not found or not published
    if (!event || event.status !== 'PUBLISHED') {
      throw new NotFoundError('Event not found');
    }

    // Calculate availability
    const soldTickets = event._count.tickets;
    const availableTickets = event.capacity - soldTickets;

    return {
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue,
        capacity: event.capacity,
        ticketPrice: event.ticketPrice,
        status: event.status,
        organizer: event.organizer,
        soldTickets,
        availableTickets,
        isSoldOut: availableTickets <= 0,
      },
    };
  }

  /**
   * Get event with ticket count (for internal use, includes draft events)
   * @param {string} eventId - UUID of the event
   * @returns {Promise<Object>} Event with ticket count
   */
  async getEventWithTicketCount(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        _count: {
          select: { tickets: true },
        },
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
}

export default new EventService();
