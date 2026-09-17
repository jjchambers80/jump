// Add-on Service (spec 012)
// Products sold alongside a ticket tier or an application tier: booth power,
// extra badges, tables, parking. An add-on is event-scoped; `scope` says which
// checkout may offer it and `allTiers` / attachment rows say on which tiers.
// Capacity uses the same conditional UPDATE … RETURNING as PriceTier so two
// checkouts can never oversell a limited add-on.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/** Common add-ons an organizer can create in one click. Prices are starting points. */
export const ADD_ON_PRESETS = [
  { key: 'power', name: 'Booth power', description: 'One 110V drop to your booth', price: 125, scope: 'APPLICATION', taxable: false },
  { key: 'badge', name: 'Extra vendor badge', description: 'Additional staff badge for your booth', price: 10, scope: 'APPLICATION', maxPerOrder: 4, taxable: false },
  { key: 'table', name: 'Table & chairs', description: 'One 6 ft table and two chairs', price: 40, scope: 'APPLICATION', taxable: false },
  { key: 'parking', name: 'Parking pass', description: 'One vehicle for the day', price: 15, scope: 'TICKET' },
  { key: 'vip', name: 'VIP lounge', description: 'Lounge access for one attendee', price: 50, scope: 'TICKET' },
];

const SCOPES = new Set(['TICKET', 'APPLICATION', 'BOTH']);

const ADMIN_INCLUDE = {
  priceTiers: { select: { priceTierId: true } },
  applicationTiers: { select: { applicationTierId: true } },
  _count: { select: { orderLines: true, applicationLines: true } },
};

class AddOnService {
  // ---------------------------------------------------------------------------
  // CRUD (ADMIN, org-scoped through the event's venue)
  // ---------------------------------------------------------------------------

  async _requireEvent(orgId, eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId: orgId } },
      select: { id: true },
    });
    if (!event) throw new NotFoundError('Event not found');
    return event;
  }

  async _requireAddOn(orgId, eventId, addOnId) {
    const addOn = await prisma.addOn.findFirst({
      where: { id: addOnId, eventId, event: { venue: { organizationId: orgId } } },
      include: ADMIN_INCLUDE,
    });
    if (!addOn) throw new NotFoundError('Add-on not found');
    return addOn;
  }

  async list(orgId, eventId) {
    await this._requireEvent(orgId, eventId);
    const rows = await prisma.addOn.findMany({
      where: { eventId },
      include: ADMIN_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { addOns: rows.map((a) => this.serializeAdmin(a)) };
  }

  presets() {
    return { presets: ADD_ON_PRESETS };
  }

  async create(orgId, eventId, data) {
    await this._requireEvent(orgId, eventId);
    const fields = this._fields(data, { creating: true });
    const attachments = await this._attachments(eventId, data);

    const maxOrder = await prisma.addOn.aggregate({ where: { eventId }, _max: { displayOrder: true } });
    const addOn = await prisma.addOn.create({
      data: {
        eventId,
        ...fields,
        displayOrder: data.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1,
        ...(attachments.priceTierIds && { priceTiers: { create: attachments.priceTierIds.map((priceTierId) => ({ priceTierId })) } }),
        ...(attachments.applicationTierIds && {
          applicationTiers: { create: attachments.applicationTierIds.map((applicationTierId) => ({ applicationTierId })) },
        }),
      },
      include: ADMIN_INCLUDE,
    });
    logger.info('Add-on created', { event: 'add_on_created', orgId, eventId, addOnId: addOn.id, name: addOn.name });
    return this.serializeAdmin(addOn);
  }

  async update(orgId, eventId, addOnId, data) {
    const existing = await this._requireAddOn(orgId, eventId, addOnId);
    const fields = this._fields(data, { creating: false, existing });
    const attachments = await this._attachments(eventId, data);

    const addOn = await prisma.$transaction(async (tx) => {
      if (attachments.priceTierIds) {
        await tx.priceTierAddOn.deleteMany({ where: { addOnId } });
        await tx.priceTierAddOn.createMany({ data: attachments.priceTierIds.map((priceTierId) => ({ addOnId, priceTierId })) });
      }
      if (attachments.applicationTierIds) {
        await tx.applicationTierAddOn.deleteMany({ where: { addOnId } });
        await tx.applicationTierAddOn.createMany({
          data: attachments.applicationTierIds.map((applicationTierId) => ({ addOnId, applicationTierId })),
        });
      }
      return tx.addOn.update({ where: { id: addOnId }, data: fields, include: ADMIN_INCLUDE });
    });
    return this.serializeAdmin(addOn);
  }

  async setActive(orgId, eventId, addOnId, isActive) {
    await this._requireAddOn(orgId, eventId, addOnId);
    const addOn = await prisma.addOn.update({ where: { id: addOnId }, data: { isActive }, include: ADMIN_INCLUDE });
    return this.serializeAdmin(addOn);
  }

  /** Delete only while nothing has been sold; otherwise deactivate (spec FR-016). */
  async remove(orgId, eventId, addOnId) {
    const addOn = await this._requireAddOn(orgId, eventId, addOnId);
    if (addOn._count.orderLines > 0 || addOn._count.applicationLines > 0) {
      throw new ConflictError('This add-on has been sold; deactivate it instead of deleting');
    }
    await prisma.addOn.delete({ where: { id: addOnId } });
    logger.info('Add-on deleted', { event: 'add_on_deleted', orgId, eventId, addOnId });
    return { deleted: true };
  }

  async reorder(orgId, eventId, addOnIds) {
    await this._requireEvent(orgId, eventId);
    if (!Array.isArray(addOnIds) || addOnIds.length === 0) throw new ValidationError('addOnIds must be a non-empty array');
    const existing = await prisma.addOn.findMany({ where: { eventId }, select: { id: true } });
    const known = new Set(existing.map((a) => a.id));
    if (addOnIds.length !== known.size || addOnIds.some((id) => !known.has(id))) {
      throw new ValidationError('addOnIds must contain every add-on of the event exactly once');
    }
    await prisma.$transaction(addOnIds.map((id, displayOrder) => prisma.addOn.update({ where: { id }, data: { displayOrder } })));
    return this.list(orgId, eventId);
  }

  _fields(data, { creating, existing }) {
    const out = {};
    if (creating || data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 80) {
        throw new ValidationError('name is required (max 80 characters)');
      }
      out.name = data.name.trim();
    }
    if (data.description !== undefined) {
      if (data.description !== null && (typeof data.description !== 'string' || data.description.length > 500)) {
        throw new ValidationError('description must be at most 500 characters');
      }
      out.description = data.description ? data.description.trim() : null;
    }
    if (creating || data.price !== undefined) {
      const price = Number(data.price);
      if (!Number.isFinite(price) || price < 0 || price > 99999.99) throw new ValidationError('price must be between 0 and 99999.99');
      out.price = Math.round(price * 100) / 100;
    }
    if (data.scope !== undefined) {
      if (!SCOPES.has(data.scope)) throw new ValidationError('scope must be TICKET, APPLICATION or BOTH');
      out.scope = data.scope;
    }
    if (data.allTiers !== undefined) {
      if (typeof data.allTiers !== 'boolean') throw new ValidationError('allTiers must be a boolean');
      out.allTiers = data.allTiers;
    }
    if (data.quantityTotal !== undefined) {
      if (data.quantityTotal === null) {
        out.quantityTotal = null;
      } else {
        const q = Number(data.quantityTotal);
        if (!Number.isInteger(q) || q < 0) throw new ValidationError('quantityTotal must be a non-negative integer or null');
        const committed = existing ? existing.quantitySold + existing.quantityReserved : 0;
        if (q < committed) throw new ValidationError(`quantityTotal cannot be below the ${committed} already sold or reserved`);
        out.quantityTotal = q;
      }
    }
    if (data.maxPerOrder !== undefined) {
      if (data.maxPerOrder === null) {
        out.maxPerOrder = null;
      } else {
        const m = Number(data.maxPerOrder);
        if (!Number.isInteger(m) || m < 1 || m > 100) throw new ValidationError('maxPerOrder must be an integer from 1 to 100 or null');
        out.maxPerOrder = m;
      }
    }
    if (data.taxable !== undefined) {
      if (typeof data.taxable !== 'boolean') throw new ValidationError('taxable must be a boolean');
      out.taxable = data.taxable;
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== 'boolean') throw new ValidationError('isActive must be a boolean');
      out.isActive = data.isActive;
    }
    return out;
  }

  /** Validate attachment ids against the event; `undefined` means "leave unchanged". */
  async _attachments(eventId, data) {
    const out = {};
    if (data.priceTierIds !== undefined) {
      if (!Array.isArray(data.priceTierIds) || data.priceTierIds.some((id) => typeof id !== 'string')) {
        throw new ValidationError('priceTierIds must be an array of ids');
      }
      const ids = [...new Set(data.priceTierIds)];
      const count = await prisma.priceTier.count({ where: { id: { in: ids }, eventId } });
      if (count !== ids.length) throw new ValidationError('priceTierIds must belong to this event');
      out.priceTierIds = ids;
    }
    if (data.applicationTierIds !== undefined) {
      if (!Array.isArray(data.applicationTierIds) || data.applicationTierIds.some((id) => typeof id !== 'string')) {
        throw new ValidationError('applicationTierIds must be an array of ids');
      }
      const ids = [...new Set(data.applicationTierIds)];
      const count = await prisma.applicationTier.count({ where: { id: { in: ids }, form: { eventId } } });
      if (count !== ids.length) throw new ValidationError('applicationTierIds must belong to this event');
      out.applicationTierIds = ids;
    }
    return out;
  }

  /**
   * Copy an event's add-ons onto a duplicate (spec 011 phase 3 duplicate flow).
   * Ticket-tier attachments follow `priceTierIdMap`; application-tier
   * attachments follow `applicationTierIdMap` when given (spec 012 phase 2).
   */
  async copyForEvent(tx, sourceEventId, targetEventId, { priceTierIdMap = new Map(), applicationTierIdMap = new Map() } = {}) {
    const source = await tx.addOn.findMany({
      where: { eventId: sourceEventId },
      include: { priceTiers: true, applicationTiers: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    for (const a of source) {
      const priceTierIds = a.priceTiers.map((p) => priceTierIdMap.get(p.priceTierId)).filter(Boolean);
      const applicationTierIds = a.applicationTiers.map((p) => applicationTierIdMap.get(p.applicationTierId)).filter(Boolean);
      await tx.addOn.create({
        data: {
          eventId: targetEventId,
          name: a.name,
          description: a.description,
          price: a.price,
          scope: a.scope,
          allTiers: a.allTiers,
          quantityTotal: a.quantityTotal,
          maxPerOrder: a.maxPerOrder,
          taxable: a.taxable,
          isActive: a.isActive,
          displayOrder: a.displayOrder,
          priceTiers: { create: priceTierIds.map((priceTierId) => ({ priceTierId })) },
          applicationTiers: { create: applicationTierIds.map((applicationTierId) => ({ applicationTierId })) },
        },
      });
    }
    return source.length;
  }

  // ---------------------------------------------------------------------------
  // Offers (public reads)
  // ---------------------------------------------------------------------------

  /** Active add-ons a ticket checkout may offer, with the tiers each is restricted to. */
  async offeredForTickets(eventId) {
    return prisma.addOn.findMany({
      where: { eventId, isActive: true, scope: { in: ['TICKET', 'BOTH'] } },
      include: { priceTiers: { select: { priceTierId: true } } },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** True when `addOn` is offered on at least one of `tierIds` (ticket scope). */
  offeredOnPriceTiers(addOn, tierIds) {
    if (addOn.allTiers) return true;
    const attached = new Set((addOn.priceTiers || []).map((p) => p.priceTierId));
    return tierIds.some((id) => attached.has(id));
  }

  // ---------------------------------------------------------------------------
  // Order lines
  // ---------------------------------------------------------------------------

  /**
   * Validate requested `{ addOnId, quantity }` lines for a ticket order against
   * scope, attachment to a cart tier, activity and per-order maximum. Capacity
   * is checked by `reserve` inside the order transaction.
   */
  async validateOrderLines(eventId, lines, cartTierIds) {
    if (!Array.isArray(lines) || lines.length === 0) return [];
    const ids = lines.map((l) => l.addOnId);
    const addOns = await prisma.addOn.findMany({
      where: { id: { in: ids }, eventId },
      include: { priceTiers: { select: { priceTierId: true } } },
    });
    const byId = new Map(addOns.map((a) => [a.id, a]));
    return lines.map((line) => {
      const addOn = byId.get(line.addOnId);
      if (!addOn) throw new NotFoundError('Add-on not found for this event');
      if (!addOn.isActive) throw new ValidationError(`${addOn.name} is not available`);
      if (addOn.scope === 'APPLICATION') throw new ValidationError(`${addOn.name} is not sold with tickets`);
      if (!this.offeredOnPriceTiers(addOn, cartTierIds)) {
        throw new ValidationError(`${addOn.name} is not offered with the selected tickets`);
      }
      if (addOn.maxPerOrder && line.quantity > addOn.maxPerOrder) {
        throw new ValidationError(`Maximum quantity per order for ${addOn.name} is ${addOn.maxPerOrder}`);
      }
      return { addOn, quantity: line.quantity };
    });
  }

  /**
   * Hold `quantity` of each limited add-on inside `tx`. Unlimited add-ons
   * (quantityTotal null) still count reservations so sales reports are exact.
   * Throws 409 with the add-on named when the remaining quantity is short.
   */
  async reserve(tx, lines) {
    for (const { addOn, quantity } of lines) {
      const rows = await tx.$queryRawUnsafe(
        `UPDATE "AddOn"
         SET "quantityReserved" = "quantityReserved" + $1
         WHERE "id" = $2
           AND ("quantityTotal" IS NULL OR ("quantityTotal" - "quantitySold" - "quantityReserved") >= $1)
         RETURNING "id"`,
        quantity,
        addOn.id
      );
      if (!rows || rows.length === 0) {
        const current = await tx.addOn.findUnique({ where: { id: addOn.id } });
        const remaining = current?.quantityTotal == null ? null : current.quantityTotal - current.quantitySold - current.quantityReserved;
        throw new ConflictError(`Insufficient quantity for ${addOn.name}`, { addOnId: addOn.id, name: addOn.name, remaining, requested: quantity });
      }
    }
  }

  /** Release reservations (failed / expired checkout). Idempotent per call site. */
  async release(tx, lines) {
    for (const { addOnId, quantity } of lines) {
      await tx.$executeRawUnsafe(
        `UPDATE "AddOn" SET "quantityReserved" = GREATEST(0, "quantityReserved" - $1) WHERE "id" = $2`,
        quantity,
        addOnId
      );
    }
  }

  /** Reservation → sold (payment completed). */
  async commit(tx, lines) {
    for (const { addOnId, quantity } of lines) {
      await tx.$executeRawUnsafe(
        `UPDATE "AddOn"
         SET "quantitySold" = "quantitySold" + $1, "quantityReserved" = GREATEST(0, "quantityReserved" - $1)
         WHERE "id" = $2`,
        quantity,
        addOnId
      );
    }
  }

  /** Sold → released (refund of a line). */
  async unsell(tx, lines) {
    for (const { addOnId, quantity } of lines) {
      await tx.$executeRawUnsafe(`UPDATE "AddOn" SET "quantitySold" = GREATEST(0, "quantitySold" - $1) WHERE "id" = $2`, quantity, addOnId);
    }
  }

  // ---------------------------------------------------------------------------
  // Serializers
  // ---------------------------------------------------------------------------

  serializeAdmin(a) {
    return {
      ...this.serializePublic(a),
      scope: a.scope,
      allTiers: a.allTiers,
      priceTierIds: (a.priceTiers || []).map((p) => p.priceTierId),
      applicationTierIds: (a.applicationTiers || []).map((p) => p.applicationTierId),
      quantityTotal: a.quantityTotal,
      quantitySold: a.quantitySold,
      quantityReserved: a.quantityReserved,
      isActive: a.isActive,
      displayOrder: a.displayOrder,
      orderLineCount: a._count?.orderLines ?? 0,
      applicationLineCount: a._count?.applicationLines ?? 0,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  /** What a storefront needs: price, taxability, remaining, and which tiers offer it. */
  serializePublic(a) {
    const remaining = a.quantityTotal == null ? null : Math.max(0, a.quantityTotal - a.quantitySold - a.quantityReserved);
    return {
      id: a.id,
      name: a.name,
      description: a.description || null,
      price: Number(a.price),
      taxable: a.taxable,
      maxPerOrder: a.maxPerOrder,
      remaining,
      soldOut: remaining === 0,
      allTiers: a.allTiers,
      priceTierIds: a.allTiers ? null : (a.priceTiers || []).map((p) => p.priceTierId),
    };
  }

  /** Order line as shown on confirmations, admin order detail and scan results. */
  serializeOrderLine(line) {
    const unitPrice = Number(line.unitPrice);
    const platformFee = Number(line.platformFee);
    const processingFee = Number(line.processingFee);
    const tax = Number(line.tax);
    return {
      id: line.id,
      addOnId: line.addOnId,
      name: line.addOn?.name ?? null,
      quantity: line.quantity,
      unitPrice,
      platformFee,
      processingFee,
      tax,
      lineTotal: Math.round((unitPrice * line.quantity + platformFee + processingFee + tax) * 100) / 100,
      refundedAt: line.refundedAt,
    };
  }
}

export default new AddOnService();
