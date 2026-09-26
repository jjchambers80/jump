// Add-on Service (spec 012)
// Products sold alongside a ticket tier or an application tier: booth power,
// extra badges, tables, parking. An add-on is event-scoped; `scope` says which
// checkout may offer it and `allTiers` / attachment rows say on which tiers.
// Capacity uses the same conditional UPDATE … RETURNING as PriceTier so two
// checkouts can never oversell a limited add-on.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { buyerLineTotal } from './orderLines.js';

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
  // Spec 024: application add-on lines are OrderAddOn rows on the application's order.
  _count: { select: { orderLines: true } },
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
    if (addOn._count.orderLines > 0) {
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

  /** True when `addOn` is offered on an application tier (application scope). */
  offeredOnApplicationTier(addOn, tierId) {
    if (addOn.allTiers) return true;
    return (addOn.applicationTiers || []).some((p) => p.applicationTierId === tierId);
  }

  // ---------------------------------------------------------------------------
  // Application lines (spec 012 phase 2)
  // ---------------------------------------------------------------------------

  /**
   * Validate requested `{ addOnId, quantity }` lines for an application
   * against scope, attachment to the chosen tier, activity and the per-order
   * maximum. Nothing is held: capacity is taken at approval (`reserve`).
   * @returns {Promise<Array<{ addOn, quantity }>>} in the add-ons' display order
   */
  async validateApplicationLines(eventId, lines, tierId) {
    if (lines === undefined || lines === null) return [];
    if (!Array.isArray(lines)) throw new ValidationError('addOns must be an array of { addOnId, quantity }');
    if (lines.length === 0) return [];
    if (!tierId) throw new ValidationError('Add-ons need a tier');
    const seen = new Set();
    for (const line of lines) {
      if (!line || typeof line.addOnId !== 'string') throw new ValidationError('addOns[].addOnId is required');
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) throw new ValidationError('addOns[].quantity must be an integer from 1 to 100');
      if (seen.has(line.addOnId)) throw new ValidationError('addOns must not repeat an add-on');
      seen.add(line.addOnId);
    }
    const addOns = await prisma.addOn.findMany({
      where: { id: { in: [...seen] }, eventId },
      include: { applicationTiers: { select: { applicationTierId: true } } },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const wanted = new Map(lines.map((l) => [l.addOnId, l.quantity]));
    if (addOns.length !== wanted.size) throw new NotFoundError('Add-on not found for this event');
    return addOns.map((addOn) => {
      const quantity = wanted.get(addOn.id);
      if (!addOn.isActive) throw new ValidationError(`${addOn.name} is not available`);
      if (addOn.scope === 'TICKET') throw new ValidationError(`${addOn.name} is not sold with applications`);
      if (!this.offeredOnApplicationTier(addOn, tierId)) throw new ValidationError(`${addOn.name} is not offered with the selected option`);
      if (addOn.maxPerOrder && quantity > addOn.maxPerOrder) throw new ValidationError(`Maximum quantity for ${addOn.name} is ${addOn.maxPerOrder}`);
      return { addOn, quantity };
    });
  }

  /** Compact "Power ×1, Badge ×2" for list rows, CSV cells and emails. */
  summarizeLines(lines) {
    return (lines || []).map((l) => `${l.addOn?.name ?? l.name} ×${l.quantity}`).join(', ');
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

  /**
   * Released → sold again, with no reservation in between: the inverse of
   * `unsell`. Only for a won dispute (spec 037), which reopens exactly the
   * lines its chargeback closed.
   */
  async resell(tx, lines) {
    for (const { addOnId, quantity } of lines) {
      await tx.$executeRawUnsafe(`UPDATE "AddOn" SET "quantitySold" = "quantitySold" + $1 WHERE "id" = $2`, quantity, addOnId);
    }
  }

  /** Sold → released (refund of a line). */
  async unsell(tx, lines) {
    for (const { addOnId, quantity } of lines) {
      await tx.$executeRawUnsafe(`UPDATE "AddOn" SET "quantitySold" = GREATEST(0, "quantitySold" - $1) WHERE "id" = $2`, quantity, addOnId);
    }
  }

  // ---------------------------------------------------------------------------
  // Reporting (spec 012 phase 3)
  // ---------------------------------------------------------------------------

  /**
   * Per add-on: what sold (paid) and what is held, split by source, with
   * listed revenue. Ticket lines count once their order completed and the
   * line is not refunded; application lines count once the application is
   * paid (approved with the slot sold) — held ones are the in-flight charges
   * and PAYMENT_DUE applications.
   */
  async sales(orgId, eventId) {
    await this._requireEvent(orgId, eventId);
    // Spec 024: one line table. Ticket lines are on TICKET orders; application
    // lines are on APPLICATION orders and are read with the application's state.
    const addOns = await prisma.addOn.findMany({
      where: { eventId },
      include: {
        orderLines: {
          where: {
            OR: [
              {
                refundedAt: null,
                order: { kind: 'TICKET', status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
              },
              { order: { kind: 'APPLICATION', application: { status: { not: 'DRAFT' } } } },
            ],
          },
          select: {
            quantity: true,
            unitPrice: true,
            order: {
              select: {
                kind: true,
                application: { select: { status: true, paymentStatus: true, capacitySlot: true } },
              },
            },
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const rows = addOns.map((a) => {
      const ticketLines = a.orderLines.filter((l) => l.order.kind === 'TICKET');
      const applicationLines = a.orderLines.filter(
        (l) => l.order.kind === 'APPLICATION' && l.order.application
      );
      const orders = { quantity: 0, revenue: 0, lines: ticketLines.length };
      for (const l of ticketLines) {
        orders.quantity += l.quantity;
        orders.revenue += Number(l.unitPrice) * l.quantity;
      }
      const applications = { quantity: 0, revenue: 0, lines: 0, held: 0, pending: 0 };
      for (const l of applicationLines) {
        const app = l.order.application;
        if (
          ['PAID', 'PARTIALLY_REFUNDED'].includes(app.paymentStatus) &&
          app.capacitySlot === 'APPROVED'
        ) {
          applications.quantity += l.quantity;
          applications.revenue += Number(l.unitPrice) * l.quantity;
          applications.lines += 1;
        } else if (app.capacitySlot === 'RESERVED') {
          applications.held += l.quantity;
        } else if (['SUBMITTED', 'WAITLISTED'].includes(app.status)) {
          // Chosen on an application that is still under review: not held, not sold.
          applications.pending += l.quantity;
        }
      }
      const remaining = a.quantityTotal == null ? null : Math.max(0, a.quantityTotal - a.quantitySold - a.quantityReserved);
      return {
        id: a.id,
        name: a.name,
        scope: a.scope,
        price: Number(a.price),
        isActive: a.isActive,
        quantityTotal: a.quantityTotal,
        sold: a.quantitySold,
        reserved: a.quantityReserved,
        remaining,
        revenue: round(orders.revenue + applications.revenue),
        orders: { quantity: orders.quantity, revenue: round(orders.revenue), lines: orders.lines },
        applications: { ...applications, revenue: round(applications.revenue) },
      };
    });
    return {
      addOns: rows,
      totals: {
        sold: rows.reduce((s, r) => s + r.sold, 0),
        reserved: rows.reduce((s, r) => s + r.reserved, 0),
        revenue: round(rows.reduce((s, r) => s + r.revenue, 0)),
      },
    };
  }

  /** One CSV row per add-on line, ticket orders and applications alike. */
  async purchasersCsv(orgId, eventId) {
    await this._requireEvent(orgId, eventId);
    const lines = await prisma.orderAddOn.findMany({
      where: {
        addOn: { eventId },
        OR: [
          { order: { kind: 'TICKET', status: { not: 'PENDING' } } },
          { order: { kind: 'APPLICATION', application: { status: { not: 'DRAFT' } } } },
        ],
      },
      include: {
        addOn: { select: { name: true, displayOrder: true } },
        order: {
          select: {
            id: true,
            kind: true,
            status: true,
            createdAt: true,
            contact: { select: { email: true, firstName: true, lastName: true } },
            application: {
              select: {
                id: true,
                status: true,
                paymentStatus: true,
                submittedAt: true,
                boothLabel: true,
                profile: { select: { businessName: true } },
                tier: { select: { name: true } },
                form: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    const orderLines = lines.filter((l) => l.order.kind === 'TICKET');
    const applicationLines = lines
      .filter((l) => l.order.kind === 'APPLICATION' && l.order.application)
      .map((l) => ({ ...l, application: { ...l.order.application, contact: l.order.contact } }));
    const csvCell = (value) => {
      if (value === null || value === undefined) return '';
      const s = String(value);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['addOn', 'quantity', 'unitPrice', 'source', 'sourceId', 'status', 'firstName', 'lastName', 'email', 'businessName', 'form', 'tier', 'boothLabel', 'refunded', 'createdAt'];
    const rows = [
      ...orderLines.map((l) => ({
        sort: [l.addOn.displayOrder, l.order.createdAt],
        cells: [l.addOn.name, l.quantity, Number(l.unitPrice).toFixed(2), 'order', l.order.id, l.order.status, l.order.contact?.firstName, l.order.contact?.lastName, l.order.contact?.email, '', '', '', '', l.refundedAt ? 'yes' : '', l.order.createdAt.toISOString()],
      })),
      ...applicationLines.map((l) => ({
        sort: [l.addOn.displayOrder, l.application.submittedAt ?? new Date(0)],
        cells: [
          l.addOn.name, l.quantity, Number(l.unitPrice).toFixed(2), 'application', l.application.id, `${l.application.status}/${l.application.paymentStatus}`,
          l.application.contact?.firstName, l.application.contact?.lastName, l.application.contact?.email, l.application.profile?.businessName ?? '',
          l.application.form?.name ?? '', l.application.tier?.name ?? '', l.application.boothLabel ?? '', '', l.application.submittedAt?.toISOString() ?? '',
        ],
      })),
    ].sort((x, y) => x.sort[0] - y.sort[0] || x.sort[1] - y.sort[1]);
    return [header, ...rows.map((r) => r.cells)].map((cells) => cells.map(csvCell).join(',')).join('\r\n');
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

  /**
   * Order line as shown on confirmations, admin order detail and scan results.
   * `feeMode` (spec 024): under ABSORB the buyer pays the listed price and the
   * fee shares are the organization's cost, so `lineTotal` excludes them.
   */
  serializeOrderLine(line, feeMode = 'PASS') {
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
      lineTotal: buyerLineTotal(line, feeMode),
      refundedAt: line.refundedAt,
    };
  }
}

export default new AddOnService();
