// Unit tests for MapService (spec 014 phase 1)
// Validation: map bounds, booth geometry, layout, publish tier sync.

import { jest } from '@jest/globals';
import { ValidationError, ConflictError, NotFoundError } from '../../src/middleware/errorHandler.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../../src/services/MapService.js');

describe('MapService', () => {
  describe('create validation', () => {
    const orgId = 'org_1';

    test('requires eventId', async () => {
      await expect(service.create(orgId, {})).rejects.toThrow(ValidationError);
    });

    test('rejects event not in org', async () => {
      mockPrisma.event = { findFirst: jest.fn().mockResolvedValue(null) };
      await expect(service.create(orgId, { eventId: 'evt_1' })).rejects.toThrow(NotFoundError);
    });

    test('rejects duplicate map for event', async () => {
      mockPrisma.event = { findFirst: jest.fn().mockResolvedValue({ id: 'evt_1' }) };
      mockPrisma.floorMap = { findUnique: jest.fn().mockResolvedValue({ id: 'map_1' }) };
      await expect(service.create(orgId, { eventId: 'evt_1' })).rejects.toThrow(ConflictError);
    });

    test('creates map with defaults', async () => {
      mockPrisma.event = { findFirst: jest.fn().mockResolvedValue({ id: 'evt_1', name: 'Event' }) };
      mockPrisma.floorMap = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'map_1', organizationId: orgId, eventId: 'evt_1', name: 'Event', status: 'DRAFT', unit: 'ft', gridSize: 10, width: 50, height: 40, underlayFileId: null, underlayOpacity: 40, layout: { version: 1, elements: [] }, publishedAt: null, createdAt: new Date(), updatedAt: new Date() }),
      };
      const result = await service.create(orgId, { eventId: 'evt_1' });
      expect(result.name).toBe('Event');
      expect(result.width).toBe(50);
      expect(result.height).toBe(40);
    });
  });

  describe('publish tier sync', () => {
    const orgId = 'org_1';
    const mapId = 'map_1';

    test('refuses publish with no booths', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({ id: mapId, organizationId: orgId, status: 'DRAFT' }),
      };
      mockPrisma.booth = { count: jest.fn().mockResolvedValue(0) };
      await expect(service.publish(orgId, mapId)).rejects.toThrow(ValidationError);
    });

    test('refuses publish when tier has more approved than booths', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({ id: mapId, organizationId: orgId, status: 'DRAFT' }),
      };
      mockPrisma.booth = { count: jest.fn().mockResolvedValue(3) };
      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          floorMap: { update: jest.fn() },
          // Every booth tier must come back from the event-scoped lookup, or
          // publish refuses with TIER_NOT_ON_EVENT before the oversold check.
          booth: { findMany: jest.fn().mockResolvedValue([{ tierId: 'tier_1' }, { tierId: 'tier_1' }]) },
          applicationTier: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'tier_1', name: 'Standard', quantityApproved: 3, quantityReserved: 0, form: { chargeTiming: 'APPROVAL', name: 'Vendor' } },
            ]),
            updateMany: jest.fn(),
          },
        };
        return fn(mockTx);
      });
      await expect(service.publish(orgId, mapId)).rejects.toThrow(ConflictError);
    });

    test('publishes and syncs tier quantities', async () => {
      const fullResult = {
        id: mapId, organizationId: orgId, eventId: 'evt_1', name: 'Map',
        status: 'PUBLISHED', unit: 'ft', gridSize: 10, width: 50, height: 40,
        underlayFileId: null, underlayOpacity: 40,
        layout: { version: 1, elements: [] },
        publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        booths: [],
      };

      mockPrisma.floorMap = {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: mapId, organizationId: orgId, status: 'DRAFT' })
          .mockResolvedValue(fullResult),
        findUnique: jest.fn().mockResolvedValue(fullResult),
      };
      mockPrisma.booth = { count: jest.fn().mockResolvedValue(3) };
      mockPrisma.applicationTier = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      mockPrisma.applicationForm = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      mockPrisma.application = {
        findMany: jest.fn().mockResolvedValue([]),
      };

      mockPrisma.$transaction = jest.fn(async (fn) => {
        const mockTx = {
          floorMap: { update: jest.fn() },
          booth: { findMany: jest.fn().mockResolvedValue([{ tierId: 'tier_1' }, { tierId: 'tier_1' }]) },
          applicationTier: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'tier_1', name: 'Standard', quantityApproved: 1, quantityReserved: 0, form: { chargeTiming: 'APPROVAL', name: 'Vendor' } },
            ]),
            updateMany: jest.fn(),
          },
        };
        return fn(mockTx);
      });

      const result = await service.publish(orgId, mapId);
      expect(result.status).toBe('PUBLISHED');
    });
  });

  describe('copyForEvent', () => {
    test('returns null when no source map exists', async () => {
      mockPrisma.floorMap = { findUnique: jest.fn().mockResolvedValue(null) };
      const result = await service.copyForEvent(mockPrisma, 'map_1', 'evt_2', { applicationTierIdMap: {} });
      expect(result).toBeNull();
    });
  });

  describe('public vendor directory', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');

    function publishedMap() {
      return {
        id: 'map_1', eventId: 'evt_1', name: 'Expo', status: 'PUBLISHED',
        width: 40, height: 20, unit: 'ft', gridSize: 10,
        layout: { version: 1, elements: [] }, underlayFileId: null,
        underlayOpacity: 40, underlay: null, updatedAt: now,
        booths: [{
          id: 'booth_1', label: 'A1', kind: 'BOOTH', x: 0, y: 0, w: 10, h: 10,
          rotation: 0, status: 'SOLD', tierId: 'tier_1', applicationId: 'app_1', updatedAt: now,
        }],
        event: { taxRate: 0, venue: { organization: { id: 'org_1', brandColor: '#123456', themeMode: 'DARK', taxInclusivePricing: false } } },
      };
    }

    test('queries approved opted-in vendors in the requested event and exposes only public profile fields', async () => {
      mockPrisma.floorMap = { findUnique: jest.fn().mockResolvedValue(publishedMap()) };
      mockPrisma.applicationTier = { findMany: jest.fn().mockResolvedValue([{
        id: 'tier_1', name: 'Standard', price: 100,
        form: { id: 'form_1', name: 'Vendors', slug: 'vendors', feeMode: 'ABSORB', taxable: false },
      }]) };
      mockPrisma.application = { findMany: jest.fn().mockResolvedValue([{
        id: 'app_1', updatedAt: now,
        booth: { id: 'booth_1', label: 'A1', status: 'SOLD' },
        tier: { id: 'tier_1', name: 'Standard' },
        form: { id: 'form_1', name: 'Vendors' },
        profile: { businessName: 'Acme', description: 'Handmade goods', website: 'https://acme.test', socials: { instagram: 'acme' }, updatedAt: now, images: [] },
      }]) };

      const result = await service.publicMap('evt_1');

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { eventId: 'evt_1', status: 'APPROVED', publicProfile: true, form: { kind: 'PAID' } },
        orderBy: [{ profile: { businessName: 'asc' } }, { id: 'asc' }],
      }));
      expect(result.vendors).toEqual([expect.objectContaining({
        id: 'app_1', name: 'Acme', category: 'Vendors', booth: { id: 'booth_1', label: 'A1' },
      })]);
      expect(result.vendors[0]).not.toHaveProperty('contact');
      expect(result.vendors[0]).not.toHaveProperty('email');
      expect(result.booths[0].vendorName).toBe('Acme');
    });

    test('returns a valid empty directory', async () => {
      mockPrisma.floorMap = { findUnique: jest.fn().mockResolvedValue(publishedMap()) };
      mockPrisma.applicationTier = { findMany: jest.fn().mockResolvedValue([]) };
      mockPrisma.application = { findMany: jest.fn().mockResolvedValue([]) };
      const result = await service.publicMap('evt_1');
      expect(result.vendors).toEqual([]);
      expect(result.booths[0].vendorName).toBeNull();
    });
  });

  describe('remove', () => {
    test('refuses delete with SOLD booths', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: 'org1' }) };
      mockPrisma.booth = { findFirst: jest.fn().mockResolvedValue({ id: 'b1' }) };
      await expect(service.remove('org1', 'm1')).rejects.toThrow(ValidationError);
    });
  });
});