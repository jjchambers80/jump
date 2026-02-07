// Unit tests for EventService
// Tests listPublishedEvents, getEventById, getEventWithTicketCount

import { jest } from '@jest/globals';

// Mock PrismaClient
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindUnique = jest.fn();

jest.unstable_mockModule('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    event: {
      findMany: mockFindMany,
      count: mockCount,
      findUnique: mockFindUnique,
    },
  })),
}));

// Import after mocking
const { default: EventService } = await import('../../src/services/EventService.js');

describe('EventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listPublishedEvents', () => {
    it('should return paginated published events with availability', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          name: 'Concert',
          date: new Date('2026-06-15'),
          venue: 'Arena',
          capacity: 100,
          ticketPrice: 50.0,
          status: 'PUBLISHED',
          createdAt: new Date(),
          _count: { tickets: 30 },
        },
        {
          id: 'evt-2',
          name: 'Festival',
          date: new Date('2026-07-20'),
          venue: 'Park',
          capacity: 500,
          ticketPrice: 75.0,
          status: 'PUBLISHED',
          createdAt: new Date(),
          _count: { tickets: 200 },
        },
      ];

      mockFindMany.mockResolvedValue(mockEvents);
      mockCount.mockResolvedValue(2);

      const result = await EventService.listPublishedEvents(1, 20);

      expect(result.events).toHaveLength(2);
      expect(result.events[0].soldTickets).toBe(30);
      expect(result.events[0].availableTickets).toBe(70);
      expect(result.events[1].soldTickets).toBe(200);
      expect(result.events[1].availableTickets).toBe(300);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should enforce pagination limits', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents(1, 200);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });

    it('should default to page 1 and limit 20', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents();

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        })
      );
    });

    it('should handle negative page numbers by defaulting to page 1', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents(-5, 10);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        })
      );
    });

    it('should only query PUBLISHED events', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents();

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PUBLISHED' },
        })
      );
      expect(mockCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PUBLISHED' },
        })
      );
    });

    it('should calculate totalPages correctly', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(55);

      const result = await EventService.listPublishedEvents(1, 20);

      expect(result.totalPages).toBe(3);
    });

    it('should remove _count from response events', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          name: 'Concert',
          date: new Date(),
          venue: 'Arena',
          capacity: 100,
          ticketPrice: 50.0,
          status: 'PUBLISHED',
          createdAt: new Date(),
          _count: { tickets: 10 },
        },
      ];

      mockFindMany.mockResolvedValue(mockEvents);
      mockCount.mockResolvedValue(1);

      const result = await EventService.listPublishedEvents();

      expect(result.events[0]._count).toBeUndefined();
    });
  });

  describe('getEventById', () => {
    it('should return event with availability details', async () => {
      const mockEvent = {
        id: 'evt-1',
        name: 'Concert',
        date: new Date('2026-06-15'),
        venue: 'Arena',
        capacity: 100,
        ticketPrice: 50.0,
        status: 'PUBLISHED',
        organizer: { name: 'John', organization: 'Events Inc' },
        _count: { tickets: 40 },
      };

      mockFindUnique.mockResolvedValue(mockEvent);

      const result = await EventService.getEventById('evt-1');

      expect(result.event.id).toBe('evt-1');
      expect(result.event.soldTickets).toBe(40);
      expect(result.event.availableTickets).toBe(60);
      expect(result.event.isSoldOut).toBe(false);
      expect(result.event.organizer).toEqual({ name: 'John', organization: 'Events Inc' });
    });

    it('should throw NotFoundError for non-existent event', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(EventService.getEventById('non-existent')).rejects.toThrow('Event not found');
    });

    it('should throw NotFoundError for draft events', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'evt-1',
        status: 'DRAFT',
        _count: { tickets: 0 },
      });

      await expect(EventService.getEventById('evt-1')).rejects.toThrow('Event not found');
    });

    it('should mark event as sold out when no available tickets', async () => {
      const mockEvent = {
        id: 'evt-1',
        name: 'Concert',
        date: new Date(),
        venue: 'Arena',
        capacity: 100,
        ticketPrice: 50.0,
        status: 'PUBLISHED',
        organizer: { name: 'John', organization: 'Events Inc' },
        _count: { tickets: 100 },
      };

      mockFindUnique.mockResolvedValue(mockEvent);

      const result = await EventService.getEventById('evt-1');

      expect(result.event.isSoldOut).toBe(true);
      expect(result.event.availableTickets).toBe(0);
    });
  });

  describe('getEventWithTicketCount', () => {
    it('should return event with ticket count including draft events', async () => {
      const mockEvent = {
        id: 'evt-1',
        name: 'Draft Event',
        capacity: 50,
        status: 'DRAFT',
        _count: { tickets: 5 },
      };

      mockFindUnique.mockResolvedValue(mockEvent);

      const result = await EventService.getEventWithTicketCount('evt-1');

      expect(result.soldTickets).toBe(5);
      expect(result.availableTickets).toBe(45);
    });

    it('should throw NotFoundError for non-existent event', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(EventService.getEventWithTicketCount('non-existent')).rejects.toThrow(
        'Event not found'
      );
    });
  });
});
