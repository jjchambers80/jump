// Unit tests for BoothService (spec 014 phase 1, spec 037)
// Manual assignment rules: APPROVED only, tier match, status transitions.
// Plus the booth-first hold's two clocks and what does and does not release it.

import { jest } from '@jest/globals';
import { ValidationError, ConflictError, NotFoundError } from '../../src/middleware/errorHandler.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service, reviewDeadline } = await import('../../src/services/BoothService.js');
const { BOOTH_HOLD_MS, BOOTH_REVIEW_HOLD_DAYS } = await import('../../src/config/applications.js');

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

  // ─── Booth-first holds (spec 037) ───────────────────────────────────────

  describe('reviewDeadline', () => {
    const DAY = 86_400_000;

    test('is BOOTH_REVIEW_HOLD_DAYS after submission when the event is far off', () => {
      const submittedAt = new Date();
      const far = new Date(Date.now() + 365 * DAY);
      expect(reviewDeadline(submittedAt, far).getTime()).toBe(
        submittedAt.getTime() + BOOTH_REVIEW_HOLD_DAYS * DAY
      );
    });

    test('never outlives the event it reserves a booth at', () => {
      const soon = new Date(Date.now() + 3 * DAY);
      expect(reviewDeadline(new Date(), soon).getTime()).toBe(soon.getTime());
    });

    test('does not hand back a deadline already in the past', () => {
      // An application to an event that already started would otherwise take a
      // hold the very next sweep reclaims.
      const past = new Date(Date.now() - 10 * DAY);
      expect(reviewDeadline(new Date(), past).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('holdForReview', () => {
    /** A tx whose Application lookups answer with `application`, booth with `booth`. */
    function txFor(application, booth, updates) {
      return {
        $queryRawUnsafe: jest.fn(async (sql) =>
          /FROM "Application"/.test(sql) ? [{ id: application?.id }] : [booth]
        ),
        application: {
          findUnique: jest.fn().mockResolvedValue(application),
          update: jest.fn(async (args) => args),
        },
        floorMap: { findUnique: jest.fn().mockResolvedValue({ status: 'PUBLISHED', eventId: 'evt_1' }) },
        booth: { update: jest.fn(async (args) => { updates.push(args.data); return args; }) },
      };
    }

    const undecided = (status) => ({
      id: 'app_1', status, tierId: 'tier_1', eventId: 'evt_1', tier: { id: 'tier_1', mapBound: true },
    });
    const freeBooth = { id: 'b_1', mapId: mapId, status: 'AVAILABLE', tierId: 'tier_1', label: 'A1' };

    test('refuses an application that has already been decided', async () => {
      const updates = [];
      const tx = txFor({ ...undecided('APPROVED') }, freeBooth, updates);
      await expect(service.holdForReview('app_1', 'b_1', { tx })).rejects.toThrow(ValidationError);
      expect(updates).toHaveLength(0);
    });

    test('refuses a tier that is not sold from the floor map', async () => {
      const updates = [];
      const tx = txFor({ ...undecided('SUBMITTED'), tier: { id: 'tier_1', mapBound: false } }, freeBooth, updates);
      await expect(service.holdForReview('app_1', 'b_1', { tx })).rejects.toThrow(ValidationError);
      expect(updates).toHaveLength(0);
    });

    test('refuses a booth somebody else already holds', async () => {
      const updates = [];
      const tx = txFor(undecided('SUBMITTED'), { ...freeBooth, status: 'HELD' }, updates);
      await expect(service.holdForReview('app_1', 'b_1', { tx })).rejects.toThrow(ConflictError);
      expect(updates).toHaveLength(0);
    });

    test('refuses a booth on another event, even with a matching tier id', async () => {
      const updates = [];
      const tx = txFor(undecided('SUBMITTED'), freeBooth, updates);
      tx.floorMap.findUnique.mockResolvedValue({ status: 'PUBLISHED', eventId: 'evt_somebody_else' });
      await expect(service.holdForReview('app_1', 'b_1', { tx })).rejects.toThrow(NotFoundError);
      expect(updates).toHaveLength(0);
    });

    test('holds a SUBMITTED application on the review clock', async () => {
      const updates = [];
      const tx = txFor(undecided('SUBMITTED'), freeBooth, updates);
      await service.holdForReview('app_1', 'b_1', { tx });
      expect(updates[0].status).toBe('HELD');
      expect(updates[0].holdKind).toBe('APPLICATION');
      expect(updates[0].holdExpiresAt.getTime()).toBeGreaterThan(Date.now() + BOOTH_HOLD_MS);
    });

    test('holds a DRAFT on the short checkout clock instead', async () => {
      // A DRAFT is mid card-capture on Stripe, not under review. The full review
      // window here would park a booth for a month on every abandoned Checkout.
      const updates = [];
      const tx = txFor(undecided('DRAFT'), freeBooth, updates);
      await service.holdForReview('app_1', 'b_1', { tx });
      expect(updates[0].holdKind).toBe('APPLICATION');
      expect(updates[0].holdExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + BOOTH_HOLD_MS);
    });
  });

  describe('releaseHoldOnFailure', () => {
    function txWith(booth, updates) {
      return {
        $queryRawUnsafe: jest.fn().mockResolvedValue([booth]),
        booth: { update: jest.fn(async (args) => { updates.push(args.data); return args; }) },
      };
    }

    test('releases a speculative post-approval CHECKOUT hold', async () => {
      const updates = [];
      const tx = txWith({ id: 'b_1', status: 'HELD', holdKind: 'CHECKOUT' }, updates);
      expect(await service.releaseHoldOnFailure('app_1', { tx })).toMatchObject({ status: 'AVAILABLE' });
      expect(updates[0].status).toBe('AVAILABLE');
      expect(updates[0].holdKind).toBeNull();
    });

    test('keeps a booth-first APPLICATION hold through a declined card', async () => {
      // The vendor applied for this specific booth and was approved for it; a
      // card decline must not hand it to whoever clicks next.
      const updates = [];
      const tx = txWith({ id: 'b_1', status: 'HELD', holdKind: 'APPLICATION', holdExpiresAt: new Date() }, updates);
      expect(await service.releaseHoldOnFailure('app_1', { tx })).toMatchObject({ status: 'HELD', kept: true });
      expect(updates).toHaveLength(0);
    });
  });

  describe('extendApplicationHold', () => {
    function txWith(booth, updates) {
      return {
        $queryRawUnsafe: jest.fn().mockResolvedValue([booth]),
        booth: { update: jest.fn(async (args) => { updates.push(args.data); return args; }) },
      };
    }

    test('pushes an APPLICATION hold out to the payment due date', async () => {
      const updates = [];
      const dueAt = new Date(Date.now() + 7 * 86_400_000);
      const tx = txWith(
        { id: 'b_1', status: 'HELD', holdKind: 'APPLICATION', holdExpiresAt: new Date(Date.now() + 60_000) },
        updates
      );
      await service.extendApplicationHold('app_1', dueAt, { tx });
      expect(updates[0].holdExpiresAt).toBe(dueAt);
    });

    test('never shortens a hold the vendor already has', async () => {
      const updates = [];
      const far = new Date(Date.now() + 30 * 86_400_000);
      const tx = txWith({ id: 'b_1', status: 'HELD', holdKind: 'APPLICATION', holdExpiresAt: far }, updates);
      await service.extendApplicationHold('app_1', new Date(Date.now() + 86_400_000), { tx });
      expect(updates).toHaveLength(0);
    });

    test('leaves a CHECKOUT hold on its own short clock', async () => {
      const updates = [];
      const tx = txWith({ id: 'b_1', status: 'HELD', holdKind: 'CHECKOUT', holdExpiresAt: new Date() }, updates);
      expect(await service.extendApplicationHold('app_1', new Date(Date.now() + 86_400_000), { tx })).toBeNull();
      expect(updates).toHaveLength(0);
    });
  });
});
