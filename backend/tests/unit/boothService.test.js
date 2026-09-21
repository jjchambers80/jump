// Unit tests for BoothService (spec 014 phase 1)
// Manual assignment rules: APPROVED only, tier match, status transitions.

import { jest } from '@jest/globals';
import { ValidationError, ConflictError, NotFoundError } from '../../src/middleware/errorHandler.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../../src/services/BoothService.js');

describe('BoothService', () => {
  const orgId = 'org_1';
  const mapId = 'map_1';

  describe('assign', () => {
    test('requires map to be in org', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue(null) };
      await expect(service.assign(orgId, mapId, 'b_1', 'app_1', 'u_1')).rejects.toThrow(NotFoundError);
    });

    test('refuses if booth is SOLD', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId, eventId: 'evt_1' }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'b_1', mapId, status: 'SOLD', applicationId: null }]),
        };
        return fn(mockTx);
      });
      await expect(service.assign(orgId, mapId, 'b_1', 'app_1')).rejects.toThrow(ConflictError);
    });

    test('refuses if application is not APPROVED', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId, eventId: 'evt_1' }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'b_1', mapId, status: 'AVAILABLE', tierId: null }]),
          application: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        return fn(mockTx);
      });
      await expect(service.assign(orgId, mapId, 'b_1', 'app_1')).rejects.toThrow(NotFoundError);
    });

    test('assigns AVAILABLE booth to APPROVED application', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId, eventId: 'evt_1' }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'b_1', mapId, label: 'A1', status: 'AVAILABLE', tierId: null }]),
          application: {
            findFirst: jest.fn().mockResolvedValue({ id: 'app_1', tierId: null, eventId: 'evt_1' }),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
          booth: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(mockTx);
      });
      const result = await service.assign(orgId, mapId, 'b_1', 'app_1', 'u_1');
      expect(result.status).toBe('SOLD');
      expect(result.label).toBe('A1');
    });

    test('two concurrent assigns on one booth — exactly one succeeds', async () => {
      // Simulate FOR UPDATE row lock: first caller sees AVAILABLE, second sees SOLD
      let callCount = 0;
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId, eventId: 'evt_1' }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        callCount++;
        const isFirst = callCount === 1;
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{
            id: 'b_1', mapId, label: 'A1', status: isFirst ? 'AVAILABLE' : 'SOLD', tierId: null, applicationId: isFirst ? null : 'app_2',
          }]),
          application: {
            findFirst: isFirst
              ? jest.fn().mockResolvedValue({ id: 'app_1', tierId: null, eventId: 'evt_1' })
              : jest.fn().mockResolvedValue({ id: 'app_2', tierId: null, eventId: 'evt_1' }),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
          booth: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(mockTx);
      });

      // First should succeed
      const result = await service.assign(orgId, mapId, 'b_1', 'app_1', 'u_1');
      expect(result.status).toBe('SOLD');

      // Second should fail because booth is now SOLD
      await expect(service.assign(orgId, mapId, 'b_1', 'app_2', 'u_2')).rejects.toThrow(ConflictError);
    });
  });

  describe('unassign', () => {
    test('requires SOLD status', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId }) };
      // Phase 2 reads the holder before locking, so the Application row can be locked first.
      mockPrisma.booth = { findFirst: jest.fn().mockResolvedValue({ applicationId: null }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'b_1', mapId, status: 'AVAILABLE' }]),
        };
        return fn(mockTx);
      });
      await expect(service.unassign(orgId, mapId, 'b_1')).rejects.toThrow(ValidationError);
    });
  });

  describe('setStatus', () => {
    test('refuses invalid status value', async () => {
      await expect(service.setStatus(orgId, mapId, 'b_1', 'INVALID')).rejects.toThrow(ValidationError);
    });

    test('refuses on SOLD booth', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId }) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'b_1', mapId, status: 'SOLD' }]),
        };
        return fn(mockTx);
      });
      await expect(service.setStatus(orgId, mapId, 'b_1', 'BLOCKED')).rejects.toThrow(ValidationError);
    });
  });

  describe('move', () => {
    test('requires source booth to be SOLD', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: mapId }) };
      mockPrisma.booth = { findMany: jest.fn().mockResolvedValue([{ id: 'b_1', applicationId: null }, { id: 'b_2', applicationId: null }]) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockResolvedValue([
            { id: 'b_1', mapId, status: 'AVAILABLE', applicationId: null },
            { id: 'b_2', mapId, status: 'AVAILABLE', applicationId: null },
          ]),
        };
        return fn(mockTx);
      });
      await expect(service.move(orgId, mapId, 'b_1', 'b_2')).rejects.toThrow(ValidationError);
    });
  });
});