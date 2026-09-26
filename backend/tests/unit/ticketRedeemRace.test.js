// Unit tests for concurrent ticket redemption at the door.
//
// Two scanners reading the same barcode in the same second is the default case
// at a door, not an edge case: staff work two lanes, and a phone on venue wifi
// retries a request it never saw answered. Redemption used to read the row,
// check the status, then write REDEEMED unconditionally — so both scans won,
// two people entered on one ticket, and neither scanner was told.
//
// These tests drive the real service over a stateful in-memory row whose
// updateMany honours the status guard, which is what makes the interleaving
// observable: both callers read VALID before either writes.

import { jest } from '@jest/globals';
import { ConflictError } from '../../src/middleware/errorHandler.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../src/services/QRService.js', () => ({
  default: {
    verifyQRCode: jest.fn(() => ({ sub: 't_1' })),
    isJumpPayload: jest.fn(() => false),
    parseQRPayload: jest.fn(() => null),
  },
}));

const { default: service } = await import('../../src/services/TicketService.js');

/**
 * One mutable ticket row plus a Prisma double that enforces the status guard,
 * so a conditional updateMany can actually lose.
 */
function seedTicket(overrides = {}) {
  const row = {
    id: 't_1',
    barcode: 'JUMP-RACE00000001',
    eventId: 'evt_1',
    status: 'VALID',
    redeemedAt: null,
    ...overrides,
  };

  const hydrate = () => ({
    ...row,
    // Tomorrow, so lazy expiration never fires in these tests
    event: {
      id: 'evt_1',
      name: 'Night Market',
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      venue: { organizationId: 'org_1', timezone: 'America/New_York' },
    },
    priceTier: { name: 'General' },
    contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    order: { addOns: [] },
  });

  mockPrisma.ticket = {
    findUnique: jest.fn(async () => hydrate()),
    updateMany: jest.fn(async ({ where, data }) => {
      if (where.status && row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    update: jest.fn(async ({ data }) => {
      Object.assign(row, data);
      return hydrate();
    }),
  };

  return row;
}

describe('concurrent ticket redemption', () => {
  describe('redeemByBarcode', () => {
    test('claims the row conditionally on it still being VALID', async () => {
      seedTicket();

      await service.redeemByBarcode('JUMP-RACE00000001');

      expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 't_1', status: 'VALID' },
        data: { status: 'REDEEMED', redeemedAt: expect.any(Date) },
      });
      // The unguarded write is what let both scans through
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    test('only one of two simultaneous scans redeems the ticket', async () => {
      const row = seedTicket();

      const results = await Promise.allSettled([
        service.redeemByBarcode('JUMP-RACE00000001'),
        service.redeemByBarcode('JUMP-RACE00000001'),
      ]);

      const redeemed = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(redeemed).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      expect(rejected[0].reason.redemptionStatus).toBe('ALREADY_REDEEMED');
      expect(row.status).toBe('REDEEMED');
    });

    test('tells the losing scanner when the ticket was first redeemed', async () => {
      seedTicket();

      const results = await Promise.allSettled([
        service.redeemByBarcode('JUMP-RACE00000001'),
        service.redeemByBarcode('JUMP-RACE00000001'),
      ]);
      const winner = results.find((r) => r.status === 'fulfilled');
      const loser = results.find((r) => r.status === 'rejected');

      // The door needs a time to show, not just a refusal — and it has to be
      // the winner's stamp, not the moment the second scan was refused
      expect(loser.reason.ticketId).toBe('t_1');
      expect(loser.reason.originalRedemptionTime).toEqual(winner.value.redeemedAt);
    });

    test('reports VOIDED when the ticket is refunded mid-scan', async () => {
      const row = seedTicket();
      mockPrisma.ticket.updateMany = jest.fn(async () => {
        // A staff refund landed between the status check and the write
        row.status = 'VOIDED';
        return { count: 0 };
      });

      await expect(service.redeemByBarcode('JUMP-RACE00000001')).rejects.toMatchObject({
        redemptionStatus: 'VOIDED',
      });
    });

    test('reports EXPIRED when the row expired mid-scan', async () => {
      const row = seedTicket();
      mockPrisma.ticket.updateMany = jest.fn(async () => {
        row.status = 'EXPIRED';
        return { count: 0 };
      });

      await expect(service.redeemByBarcode('JUMP-RACE00000001')).rejects.toMatchObject({
        redemptionStatus: 'EXPIRED',
        statusCode: 410,
      });
    });
  });

  describe('redeemTicket (legacy JWT payload)', () => {
    test('only one of two simultaneous scans redeems the ticket', async () => {
      const row = seedTicket();

      const results = await Promise.allSettled([
        service.redeemTicket('jwt.payload.here'),
        service.redeemTicket('jwt.payload.here'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected');
      expect(loser.reason.redemptionStatus).toBe('ALREADY_REDEEMED');
      expect(row.status).toBe('REDEEMED');
    });
  });

  describe('adminCheckIn (manual tap on the check-in page)', () => {
    test('only one of two simultaneous taps checks the ticket in', async () => {
      const row = seedTicket();

      const results = await Promise.allSettled([
        service.adminCheckIn('t_1'),
        service.adminCheckIn('t_1'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected');
      expect(loser.reason).toBeInstanceOf(ConflictError);
      expect(loser.reason.message).toBe('Ticket already checked in');
      expect(row.status).toBe('REDEEMED');
    });

    test('returns the stamp it wrote', async () => {
      seedTicket();

      const result = await service.adminCheckIn('t_1');

      expect(result.status).toBe('REDEEMED');
      expect(result.redeemedAt).toBeInstanceOf(Date);
    });
  });
});
