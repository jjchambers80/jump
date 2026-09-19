// Unit tests for EventService
// Tests listPublishedEvents, getEventById, getEventWithTicketCount

import { jest } from '@jest/globals';

// Mock PrismaClient
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindUnique = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    event: {
      findMany: mockFindMany,
      count: mockCount,
      findUnique: mockFindUnique,
    },
  },
}));

// Import after mocking
const { default: EventService } = await import('../../src/services/EventService.js');

// Current model: availability and price come from per-tier inventory, not a
// single ticketPrice / _count on the event.
const tier = (price, total, sold = 0, reserved = 0, extra = {}) => ({
  id: `tier-${price}`,
  name: `Tier ${price}`,
  price,
  quantityTotal: total,
  quantitySold: sold,
  quantityReserved: reserved,
  isActive: true,
  displayOrder: 0,
  ...extra,
});
const venue = { id: 'ven-1', name: 'Arena', address: '1 Main St', timezone: 'UTC', organization: { id: 'org-1', name: 'Events Inc', brandColor: null, themeMode: 'SYSTEM' } };
const publishedEvent = (id, priceTiers) => ({
  id,
  name: `Event ${id}`,
  date: new Date('2026-06-15'),
  status: 'PUBLISHED',
  category: 'music',
  capacity: 100,
  taxRate: null,
  venue,
  priceTiers,
  createdAt: new Date(),
});

describe('EventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listPublishedEvents', () => {
    it('should return paginated published events with per-tier availability and price range', async () => {
      mockFindMany.mockResolvedValue([
        publishedEvent('evt-1', [tier(50, 100, 30), tier(80, 20, 5, 5)]),
        publishedEvent('evt-2', [tier(75, 500, 200)]),
      ]);
      mockCount.mockResolvedValue(2);

      const result = await EventService.listPublishedEvents({ page: 1, limit: 20 });

      expect(result.events).toHaveLength(2);
      expect(result.events[0].availableTickets).toBe(70 + 10);
      expect(result.events[0].priceRange).toEqual({ min: 50, max: 80 });
      expect(result.events[1].availableTickets).toBe(300);
      expect(result.events[1].priceRange).toEqual({ min: 75, max: 75 });
      expect(result.pagination).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it('should enforce pagination limits', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents({ page: 1, limit: 200 });

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

      await EventService.listPublishedEvents({ page: -5, limit: 10 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        })
      );
    });

    it('should only query PUBLISHED events of public storefronts', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await EventService.listPublishedEvents();

      const where = { status: 'PUBLISHED', venue: { organization: { storefrontPrivate: false } } };
      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(mockCount).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    it('should calculate totalPages correctly', async () => {
      mockFindMany.mockResolvedValue([publishedEvent('evt-1', [])]);
      mockCount.mockResolvedValue(45);

      const result = await EventService.listPublishedEvents({ page: 1, limit: 20 });
      expect(result.pagination.totalPages).toBe(3);
    });

    it('should return the summary shape only (no raw tier rows, null priceRange without tiers)', async () => {
      mockFindMany.mockResolvedValue([publishedEvent('evt-1', [])]);
      mockCount.mockResolvedValue(1);

      const result = await EventService.listPublishedEvents({});
      expect(result.events[0]).toMatchObject({ id: 'evt-1', availableTickets: 0, priceRange: null });
      expect(result.events[0].priceTiers).toBeUndefined();
    });
  });

  describe('getEventById', () => {
    it('should return event detail with organization and per-tier availability', async () => {
      mockFindUnique.mockResolvedValue(publishedEvent('evt-1', [tier(50, 100, 40)]));

      const result = await EventService.getEventById('evt-1');

      expect(result.id).toBe('evt-1');
      expect(result.organizationId).toBe('org-1');
      expect(result.organizationName).toBe('Events Inc');
      expect(result.venue).toMatchObject({ id: 'ven-1', name: 'Arena' });
      expect(result.priceTiers).toHaveLength(1);
      expect(result.priceTiers[0]).toMatchObject({ quantityAvailable: 60, price: 50 });
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

    it('should report zero availability when every tier is sold out', async () => {
      mockFindUnique.mockResolvedValue(publishedEvent('evt-1', [tier(50, 100, 100), tier(80, 10, 8, 2)]));

      const result = await EventService.getEventById('evt-1');
      expect(result.priceTiers.every((t) => t.quantityAvailable === 0)).toBe(true);
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
