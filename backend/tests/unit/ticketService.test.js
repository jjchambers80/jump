// Unit tests for TicketService
// Tests createTicketsAfterPayment, getCustomerTickets, redeemTicket

import { jest } from '@jest/globals';

// Mock dependencies
const mockTransaction = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();

jest.unstable_mockModule('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $transaction: mockTransaction,
    ticket: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  })),
}));

jest.unstable_mockModule('../../src/utils/metrics.js', () => ({
  recordTicketSale: jest.fn(),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logTicketPurchase: jest.fn(),
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { default: TicketService } = await import('../../src/services/TicketService.js');
const { recordTicketSale } = await import('../../src/utils/metrics.js');

describe('TicketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTicketsAfterPayment', () => {
    it('should create tickets within an atomic transaction', async () => {
      const mockTickets = [
        { id: 'tkt-1', eventId: 'evt-1', customerId: 'cust-1', status: 'VALID', pricePaid: 50 },
        { id: 'tkt-2', eventId: 'evt-1', customerId: 'cust-1', status: 'VALID', pricePaid: 50 },
      ];

      const mockEvent = {
        id: 'evt-1',
        capacity: 100,
        ticketPrice: 50,
        _count: { tickets: 10 },
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          event: {
            findUnique: jest.fn().mockResolvedValue(mockEvent),
          },
          ticket: {
            create: jest
              .fn()
              .mockResolvedValueOnce(mockTickets[0])
              .mockResolvedValueOnce(mockTickets[1]),
          },
        };
        return callback(tx);
      });

      const result = await TicketService.createTicketsAfterPayment(
        'pay-1',
        'evt-1',
        'cust-1',
        2,
        'stripe-123',
        'corr-1'
      );

      expect(result).toHaveLength(2);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundError when event does not exist', async () => {
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          event: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          ticket: { create: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        TicketService.createTicketsAfterPayment(
          'pay-1',
          'evt-1',
          'cust-1',
          2,
          'stripe-123',
          'corr-1'
        )
      ).rejects.toThrow('Event not found');
    });

    it('should throw ConflictError when capacity is insufficient', async () => {
      const mockEvent = {
        id: 'evt-1',
        capacity: 100,
        ticketPrice: 50,
        _count: { tickets: 99 },
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          event: {
            findUnique: jest.fn().mockResolvedValue(mockEvent),
          },
          ticket: { create: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        TicketService.createTicketsAfterPayment(
          'pay-1',
          'evt-1',
          'cust-1',
          5,
          'stripe-123',
          'corr-1'
        )
      ).rejects.toThrow(/Insufficient capacity/);
    });

    it('should record ticket sale metrics for each ticket', async () => {
      const mockEvent = {
        id: 'evt-1',
        capacity: 100,
        ticketPrice: 25,
        _count: { tickets: 0 },
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          event: {
            findUnique: jest.fn().mockResolvedValue(mockEvent),
          },
          ticket: {
            create: jest.fn().mockResolvedValue({ id: 'tkt-1', eventId: 'evt-1' }),
          },
        };
        return callback(tx);
      });

      await TicketService.createTicketsAfterPayment(
        'pay-1',
        'evt-1',
        'cust-1',
        1,
        'stripe-123',
        'corr-1'
      );

      expect(recordTicketSale).toHaveBeenCalledWith('evt-1');
    });
  });

  describe('getCustomerTickets', () => {
    it('should return customer tickets ordered by event date', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockTickets = [
        {
          id: 'tkt-1',
          customerId: 'cust-1',
          status: 'VALID',
          event: { name: 'Concert', date: futureDate, venue: 'Arena' },
        },
      ];

      mockFindMany.mockResolvedValue(mockTickets);

      const result = await TicketService.getCustomerTickets('cust-1');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('VALID');
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust-1' },
          orderBy: { event: { date: 'desc' } },
        })
      );
    });

    it('should mark tickets as EXPIRED when event date + 1 hour < now', async () => {
      const pastDate = new Date(Date.now() - 7200000); // 2 hours ago
      const mockTickets = [
        {
          id: 'tkt-1',
          customerId: 'cust-1',
          status: 'VALID',
          event: { name: 'Past Concert', date: pastDate, venue: 'Arena' },
        },
      ];

      mockFindMany.mockResolvedValue(mockTickets);
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const result = await TicketService.getCustomerTickets('cust-1');

      expect(result[0].status).toBe('EXPIRED');
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['tkt-1'] } },
        data: { status: 'EXPIRED' },
      });
    });

    it('should not expire tickets for future events', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const mockTickets = [
        {
          id: 'tkt-1',
          customerId: 'cust-1',
          status: 'VALID',
          event: { name: 'Future Concert', date: futureDate, venue: 'Arena' },
        },
      ];

      mockFindMany.mockResolvedValue(mockTickets);

      const result = await TicketService.getCustomerTickets('cust-1');

      expect(result[0].status).toBe('VALID');
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('should not re-expire already expired tickets', async () => {
      const pastDate = new Date(Date.now() - 7200000);
      const mockTickets = [
        {
          id: 'tkt-1',
          customerId: 'cust-1',
          status: 'EXPIRED',
          event: { name: 'Past Concert', date: pastDate, venue: 'Arena' },
        },
      ];

      mockFindMany.mockResolvedValue(mockTickets);

      const result = await TicketService.getCustomerTickets('cust-1');

      expect(result[0].status).toBe('EXPIRED');
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('should handle empty ticket list', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await TicketService.getCustomerTickets('cust-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('redeemTicket', () => {
    it('should mark a valid ticket as redeemed', async () => {
      mockFindUnique.mockResolvedValue({ id: 'tkt-1', status: 'VALID' });
      mockUpdate.mockResolvedValue({ id: 'tkt-1', status: 'REDEEMED' });

      const result = await TicketService.redeemTicket('tkt-1');

      expect(result.status).toBe('REDEEMED');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'tkt-1' },
        data: { status: 'REDEEMED' },
      });
    });

    it('should throw NotFoundError for non-existent ticket', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(TicketService.redeemTicket('non-existent')).rejects.toThrow('Ticket not found');
    });

    it('should throw ConflictError for already redeemed ticket', async () => {
      mockFindUnique.mockResolvedValue({ id: 'tkt-1', status: 'REDEEMED' });

      await expect(TicketService.redeemTicket('tkt-1')).rejects.toThrow('Ticket already redeemed');
    });

    it('should throw ConflictError for expired ticket', async () => {
      mockFindUnique.mockResolvedValue({ id: 'tkt-1', status: 'EXPIRED' });

      await expect(TicketService.redeemTicket('tkt-1')).rejects.toThrow('Ticket has expired');
    });
  });

  describe('getTicketById', () => {
    it('should return ticket with event and customer details', async () => {
      const mockTicket = {
        id: 'tkt-1',
        eventId: 'evt-1',
        customerId: 'cust-1',
        status: 'VALID',
        event: { name: 'Concert', date: new Date(), venue: 'Arena' },
        customer: { email: 'user@test.com', name: 'Test User' },
      };

      mockFindUnique.mockResolvedValue(mockTicket);

      const result = await TicketService.getTicketById('tkt-1');

      expect(result.id).toBe('tkt-1');
      expect(result.event.name).toBe('Concert');
      expect(result.customer.email).toBe('user@test.com');
    });

    it('should throw NotFoundError for non-existent ticket', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(TicketService.getTicketById('non-existent')).rejects.toThrow('Ticket not found');
    });
  });

  describe('updateTicketQRCode', () => {
    it('should update ticket with QR code JWT', async () => {
      mockUpdate.mockResolvedValue({ id: 'tkt-1', qrCodeJwt: 'jwt-token-123' });

      const result = await TicketService.updateTicketQRCode('tkt-1', 'jwt-token-123');

      expect(result.qrCodeJwt).toBe('jwt-token-123');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'tkt-1' },
        data: { qrCodeJwt: 'jwt-token-123' },
      });
    });
  });
});
