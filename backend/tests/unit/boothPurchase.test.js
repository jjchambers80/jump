// Unit tests for approved-vendor booth purchase state transitions (spec 014 phase 2).

import { jest } from '@jest/globals';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../../src/services/BoothService.js');

const application = (overrides = {}) => ({
  id: 'app_1',
  status: 'APPROVED',
  paymentStatus: 'PAYMENT_DUE',
  tierId: 'tier_1',
  boothLabel: null,
  tier: { id: 'tier_1', mapBound: true },
  ...overrides,
});

function chooseTx({ app = application(), boothStatus = 'AVAILABLE', mapStatus = 'PUBLISHED' } = {}) {
  return {
    $queryRawUnsafe: jest
      .fn()
      .mockResolvedValueOnce([{ id: app.id }])
      .mockResolvedValueOnce([{ id: 'booth_1', mapId: 'map_1', label: 'A1', tierId: 'tier_1', status: boothStatus }]),
    application: {
      findUnique: jest.fn().mockResolvedValue(app),
    },
    booth: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    floorMap: {
      findUnique: jest.fn().mockResolvedValue({ id: 'map_1', status: mapStatus }),
    },
  };
}

describe('BoothService vendor purchase flow', () => {
  beforeEach(() => {
    mockPrisma.$transaction = jest.fn(async (fn) => fn(chooseTx()));
  });

  it('holds an available booth for an approved vendor with payment due', async () => {
    const tx = chooseTx();
    const before = Date.now();

    const result = await service.chooseBooth('app_1', 'booth_1', { tx });

    expect(result).toMatchObject({ boothId: 'booth_1', status: 'HELD' });
    expect(result.holdExpiresAt.getTime()).toBeGreaterThan(before);
    expect(tx.booth.update).toHaveBeenCalledWith({
      where: { id: 'booth_1' },
      data: expect.objectContaining({
        status: 'HELD',
        holdApplicationId: 'app_1',
        applicationId: null,
        assignedById: null,
      }),
    });
  });

  it.each([
    ['not approved', application({ status: 'SUBMITTED' }), 'APPLICATION_NOT_APPROVED'],
    ['not awaiting payment', application({ paymentStatus: 'PAID' }), 'NOT_PAYMENT_DUE'],
    ['no tier', application({ tierId: null, tier: null }), 'NO_TIER'],
    ['non-map tier', application({ tier: { id: 'tier_1', mapBound: false } }), 'FORM_NOT_MAP_BOUND'],
  ])('rejects %s', async (_label, app, code) => {
    const tx = chooseTx({ app });
    await expect(service.chooseBooth(app.id, 'booth_1', { tx })).rejects.toMatchObject({
      code,
      statusCode: 400,
    });
  });

  it('returns BOOTH_TAKEN after the row lock sees a competing hold', async () => {
    const tx = chooseTx({ boothStatus: 'HELD' });
    await expect(service.chooseBooth('app_1', 'booth_1', { tx })).rejects.toMatchObject({
      code: 'BOOTH_TAKEN',
      statusCode: 409,
    });
  });

  it('rejects an unpublished map and a booth from another tier', async () => {
    const draftTx = chooseTx({ mapStatus: 'DRAFT' });
    await expect(service.chooseBooth('app_1', 'booth_1', { tx: draftTx })).rejects.toMatchObject({ code: 'MAP_NOT_PUBLISHED' });

    const tierTx = chooseTx();
    tierTx.$queryRawUnsafe.mockReset()
      .mockResolvedValueOnce([{ id: 'app_1' }])
      .mockResolvedValueOnce([{ id: 'booth_1', mapId: 'map_1', label: 'A1', tierId: 'tier_2', status: 'AVAILABLE' }]);
    await expect(service.chooseBooth('app_1', 'booth_1', { tx: tierTx })).rejects.toMatchObject({ code: 'BOOTH_TIER_MISMATCH' });
  });

  it('claims only the application hold and writes the booth label', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'booth_1', label: 'A1', status: 'HELD', holdApplicationId: 'app_1', applicationId: null }]),
      booth: { update: jest.fn().mockResolvedValue({}) },
      application: { update: jest.fn().mockResolvedValue({}) },
    };

    const result = await service.claimBooth('app_1', 'booth_1', { tx });

    expect(result).toEqual({ boothId: 'booth_1', label: 'A1', status: 'SOLD' });
    expect(tx.booth.update).toHaveBeenCalledWith({
      where: { id: 'booth_1' },
      data: { status: 'SOLD', applicationId: 'app_1', holdApplicationId: null, holdExpiresAt: null, assignedById: null },
    });
    expect(tx.application.update).toHaveBeenCalledWith({ where: { id: 'app_1' }, data: { boothLabel: 'A1' } });
  });

  it('does not release an expired hold while payment is processing', async () => {
    const booth = { id: 'booth_1', holdApplicationId: 'app_1' };
    mockPrisma.booth = { findMany: jest.fn().mockResolvedValue([booth]) };
    mockPrisma.$transaction = jest.fn(async (fn) => fn({
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ ...booth, status: 'HELD', holdExpiresAt: new Date(0) }]),
      application: { findUnique: jest.fn().mockResolvedValue({ paymentStatus: 'PROCESSING' }) },
      booth: { update: jest.fn() },
    }));

    await expect(service.sweepExpiredHolds(new Date())).resolves.toEqual({ released: 0, protected: 1 });
  });

  it('releases a held booth after a failed payment', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'booth_1', status: 'HELD', holdApplicationId: 'app_1' }]),
      booth: { update: jest.fn().mockResolvedValue({}) },
    };

    await expect(service.releaseHoldOnFailure('app_1', { tx })).resolves.toEqual({
      boothId: 'booth_1',
      status: 'AVAILABLE',
    });
    expect(tx.booth.update).toHaveBeenCalledWith({
      where: { id: 'booth_1' },
      data: { status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null, applicationId: null, assignedById: null },
    });
  });

  it('moves a map-bound application to processing only with an active booth hold', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ id: 'app_1' }])
        .mockResolvedValueOnce([{ id: 'booth_1', status: 'HELD', holdApplicationId: 'app_1', holdExpiresAt: new Date(Date.now() + 60_000) }]),
      application: { update },
    };

    await expect(service.beginPayment('app_1', { tx })).resolves.toMatchObject({ boothId: 'booth_1' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'app_1' }, data: { paymentStatus: 'PROCESSING' } });
  });

  it('rejects payment after the booth hold expires', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ id: 'app_1' }])
        .mockResolvedValueOnce([{ id: 'booth_1', status: 'HELD', holdApplicationId: 'app_1', holdExpiresAt: new Date(0) }]),
      application: { update: jest.fn() },
    };

    await expect(service.beginPayment('app_1', { tx })).rejects.toMatchObject({ code: 'BOOTH_HOLD_EXPIRED' });
    expect(tx.application.update).not.toHaveBeenCalled();
  });

  it('releases an expired hold when payment is no longer processing', async () => {
    const booth = { id: 'booth_1', holdApplicationId: 'app_1' };
    const update = jest.fn().mockResolvedValue({});
    mockPrisma.booth = { findMany: jest.fn().mockResolvedValue([booth]) };
    mockPrisma.$transaction = jest.fn(async (fn) => fn({
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ ...booth, status: 'HELD', holdExpiresAt: new Date(0) }]),
      application: { findUnique: jest.fn().mockResolvedValue({ paymentStatus: 'PAYMENT_DUE' }) },
      booth: { update },
    }));

    await expect(service.sweepExpiredHolds(new Date())).resolves.toEqual({ released: 1, protected: 0 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'booth_1' },
      data: { status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null, applicationId: null, assignedById: null },
    });
  });
});
