// Booth Service (spec 014 phase 1)
// Manual booth assignment operations: assign, unassign, move, setStatus.
// Every mutation starts with SELECT … FOR UPDATE on the affected booth row(s).
// Phase 2 will add hold / release / sold here.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

class BoothService {
  /**
   * Assign an APPROVED application to an AVAILABLE or RESERVED booth.
   * Sets SOLD, writes Application.boothLabel. No money movement.
   */
  async assign(orgId, mapId, boothId, applicationId, byUserId, { force = false } = {}) {
    // Verify the map belongs to the org
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true, eventId: true } });
    if (!map) throw new NotFoundError('Map not found in this organization');

    return prisma.$transaction(async (tx) => {
      // Lock the booth
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (!['AVAILABLE', 'RESERVED'].includes(booth.status)) {
        throw new ConflictError(`Booth is ${booth.status.toLowerCase()}, cannot assign`);
      }

      // Verify application is APPROVED and belongs to this event/org
      const application = await tx.application.findFirst({
        where: { id: applicationId, organizationId: orgId, status: 'APPROVED' },
        select: { id: true, tierId: true, eventId: true },
      });
      if (!application) throw new NotFoundError('Approved application not found in this organization');
      if (application.eventId !== map.eventId) {
        throw new ValidationError('Application belongs to a different event');
      }

      // Check application doesn't already hold a booth
      const existingBooth = await tx.booth.findUnique({ where: { applicationId } });
      if (existingBooth && existingBooth.id !== boothId) {
        throw new ConflictError('APPLICATION_HAS_BOOTH — this application already holds another booth');
      }

      // Tier match check (overridable with force by ADMIN)
      if (booth.tierId && application.tierId !== booth.tierId && !force) {
        throw new ValidationError('TIER_MISMATCH — the booth belongs to a different tier than the application');
      }

      await tx.booth.update({
        where: { id: boothId },
        data: {
          status: 'SOLD',
          applicationId,
          holdApplicationId: null,
          holdExpiresAt: null,
          assignedById: byUserId || null,
        },
      });

      await tx.application.update({
        where: { id: applicationId },
        data: { boothLabel: booth.label },
      });

      logger.info('Booth assigned', {
        event: 'booth_assigned',
        boothId, mapId, applicationId, assignedBy: byUserId,
      });

      return { boothId, label: booth.label, status: 'SOLD' };
    });
  }

  /**
   * Unassign — return a SOLD booth back to AVAILABLE.
   */
  async unassign(orgId, mapId, boothId) {
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true } });
    if (!map) throw new NotFoundError('Map not found');

    return prisma.$transaction(async (tx) => {
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (booth.status !== 'SOLD') throw new ValidationError('Booth is not sold or assigned');

      const applicationId = booth.applicationId;

      await tx.booth.update({
        where: { id: boothId },
        data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdExpiresAt: null, assignedById: null },
      });

      if (applicationId) {
        await tx.application.update({
          where: { id: applicationId },
          data: { boothLabel: null },
        });
      }

      return { boothId, label: booth.label, status: 'AVAILABLE' };
    });
  }

  /**
   * Move a holder from one booth to another (both on the same map).
   * If the target is occupied, swaps the holders (exchange).
   * Locks both rows ordered by id to avoid deadlock.
   */
  async move(orgId, mapId, fromBoothId, toBoothId) {
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true, eventId: true } });
    if (!map) throw new NotFoundError('Map not found');

    const ids = [fromBoothId, toBoothId].sort();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" IN (${placeholders}) AND "mapId" = $${ids.length + 1} FOR UPDATE`,
        ...ids, mapId
      );

      const byId = {};
      for (const b of locked) byId[b.id] = b;

      const fromBooth = byId[fromBoothId];
      const toBooth = byId[toBoothId];

      if (!fromBooth || !toBooth) throw new NotFoundError('One or both booths not found');
      if (fromBooth.status !== 'SOLD') throw new ValidationError('Source booth is not sold');
      if (!['AVAILABLE', 'RESERVED', 'SOLD'].includes(toBooth.status)) {
        throw new ConflictError('Target booth is not available');
      }

      const fromAppId = fromBooth.applicationId;
      if (!fromAppId) throw new ValidationError('Source booth has no assigned application');

      if (toBooth.status === 'SOLD' && toBooth.applicationId) {
        // Swap: exchange holders between the two booths
        const toAppId = toBooth.applicationId;

        await tx.booth.update({
          where: { id: fromBooth.id },
          data: { status: 'SOLD', applicationId: toAppId, assignedById: toBooth.assignedById },
        });

        await tx.booth.update({
          where: { id: toBooth.id },
          data: { status: 'SOLD', applicationId: fromAppId, assignedById: fromBooth.assignedById },
        });

        await tx.application.update({
          where: { id: fromAppId },
          data: { boothLabel: toBooth.label },
        });

        await tx.application.update({
          where: { id: toAppId },
          data: { boothLabel: fromBooth.label },
        });

        return { fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: true };
      }

      // Normal move: clear source, set target
      await tx.booth.update({
        where: { id: fromBooth.id },
        data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdExpiresAt: null, assignedById: null },
      });

      await tx.booth.update({
        where: { id: toBooth.id },
        data: { status: 'SOLD', applicationId: fromAppId, assignedById: fromBooth.assignedById },
      });

      await tx.application.update({
        where: { id: fromAppId },
        data: { boothLabel: toBooth.label },
      });

      return { fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: false };
    });
  }

  /**
   * Toggle RESERVED / BLOCKED / AVAILABLE on booths without a holder.
   */
  async setStatus(orgId, mapId, boothId, status) {
    const allowed = ['AVAILABLE', 'RESERVED', 'BLOCKED'];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Status must be one of: ${allowed.join(', ')}`);
    }

    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true } });
    if (!map) throw new NotFoundError('Map not found');

    return prisma.$transaction(async (tx) => {
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (booth.status === 'SOLD' || booth.status === 'HELD') {
        throw new ValidationError(`Cannot change status of a ${booth.status.toLowerCase()} booth`);
      }

      await tx.booth.update({
        where: { id: boothId },
        data: { status },
      });

      return { boothId, label: booth.label, status };
    });
  }

  /**
   * List APPROVED applications that are assignable to a booth (no existing booth, same event).
   * Match by tier first, search on business name / contact.
   */
  async assignableApplications(orgId, mapId, boothId, query) {
    const map = await prisma.floorMap.findFirst({
      where: { id: mapId, organizationId: orgId },
      select: { id: true, eventId: true },
    });
    if (!map) throw new NotFoundError('Map not found');

    // Get the booth's tier if any
    const booth = await prisma.booth.findUnique({ where: { id: boothId }, select: { tierId: true } });

    // Applications already holding a booth on this map
    const heldBooths = await prisma.booth.findMany({
      where: { mapId, applicationId: { not: null } },
      select: { applicationId: true },
    });
    const heldIds = new Set(heldBooths.map((b) => b.applicationId));

    const where = {
      eventId: map.eventId,
      organizationId: orgId,
      status: 'APPROVED',
      id: { notIn: [...heldIds] },
    };

    if (query) {
      where.OR = [
        { profile: { businessName: { contains: query, mode: 'insensitive' } } },
        { contact: { firstName: { contains: query, mode: 'insensitive' } } },
        { contact: { lastName: { contains: query, mode: 'insensitive' } } },
        { contact: { email: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const applications = await prisma.application.findMany({
      where,
      include: {
        profile: { select: { businessName: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        tier: { select: { id: true, name: true, price: true, mapBound: true } },
      },
      orderBy: [{ tier: { displayOrder: 'asc' } }, { profile: { businessName: 'asc' } }],
    });

    return applications.map((a) => ({
      id: a.id,
      businessName: a.profile?.businessName || null,
      contactName: `${a.contact.firstName} ${a.contact.lastName}`.trim(),
      email: a.contact.email,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, price: Number(a.tier.price), mapBound: a.tier.mapBound } : null,
      tierMatch: booth?.tierId ? a.tierId === booth.tierId : true,
      status: a.status,
    }));
  }
}

export default new BoothService();