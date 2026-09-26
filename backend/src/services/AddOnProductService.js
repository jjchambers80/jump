// Saved add-ons (spec 037 phase 4)
// An `AddOnProduct` is the organization-level definition an event's `AddOn`
// offering points at. Shared fields — name, description, scope, taxable — are
// edited once here and copied onto every offering (the offering columns stay
// denormalized until phase 6 drops them). Price is only a default: attaching a
// saved add-on starts the offering at `defaultPrice`, and editing the saved
// price never changes an event (D9). Inventory, tier attachments, activity and
// order stay per offering.
//
// Names are unique per organization case-insensitively (after trimming). The
// schema's unique index only covers the exact spelling, so every write that
// can create or rename a product takes a per-organization advisory lock first.
// The UI calls these "saved add-ons", never a "library".

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const SCOPES = new Set(['TICKET', 'APPLICATION', 'BOTH']);

/** Common add-ons offered as one-click suggestions until the organization saves them. */
export const ADD_ON_PRESETS = [
  { key: 'power', name: 'Booth power', description: 'One 110V drop to your booth', price: 125, scope: 'APPLICATION', maxPerOrder: null, taxable: false },
  { key: 'badge', name: 'Extra vendor badge', description: 'Additional staff badge for your booth', price: 10, scope: 'APPLICATION', maxPerOrder: 4, taxable: false },
  { key: 'table', name: 'Table & chairs', description: 'One 6 ft table and two chairs', price: 40, scope: 'APPLICATION', maxPerOrder: null, taxable: false },
  { key: 'parking', name: 'Parking pass', description: 'One vehicle for the day', price: 15, scope: 'TICKET', maxPerOrder: null, taxable: true },
  { key: 'vip', name: 'VIP lounge', description: 'Lounge access for one attendee', price: 50, scope: 'TICKET', maxPerOrder: null, taxable: true },
];

/** The comparison key for saved add-on names: trimmed, lower-case. */
export function nameKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** Fields copied from a saved add-on onto each of its offerings. */
export function sharedFields(product) {
  return {
    name: product.name,
    description: product.description ?? null,
    scope: product.scope,
    taxable: product.taxable,
  };
}

/** 409 with a machine-readable `code` on the error body (errorHandler copies `err.code`). */
function conflict(message, code, details) {
  const error = new ConflictError(message, { code, ...details });
  error.code = code;
  return error;
}

const LIST_SELECT_COUNT = { _count: { select: { offerings: true } } };

class AddOnProductService {
  /** Serialize concurrent creates / renames within one organization (case-insensitive uniqueness). */
  async lockOrg(tx, organizationId) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`addon-product:${organizationId}`}))`;
  }

  /** Case-insensitive lookup inside `tx` (or the shared client). */
  async findByName(db, organizationId, name, { excludeId } = {}) {
    return db.addOnProduct.findFirst({
      where: {
        organizationId,
        name: { equals: String(name).trim(), mode: 'insensitive' },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  }

  async _require(organizationId, id, db = prisma) {
    const product = await db.addOnProduct.findFirst({ where: { id, organizationId }, include: LIST_SELECT_COUNT });
    if (!product) throw new NotFoundError('Saved add-on not found');
    return product;
  }

  /**
   * Validate saved add-on fields. `creating` requires name and defaultPrice.
   * Accepts `price` as an alias of `defaultPrice` so an event dialog can post one shape.
   */
  fields(data, { creating }) {
    const out = {};
    if (creating || data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.trim().length > 80) {
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
    const rawPrice = data.defaultPrice !== undefined ? data.defaultPrice : data.price;
    if (creating || rawPrice !== undefined) {
      const price = Number(rawPrice);
      if (rawPrice === null || rawPrice === '' || !Number.isFinite(price) || price < 0 || price > 99999.99) {
        throw new ValidationError('defaultPrice must be between 0 and 99999.99');
      }
      out.defaultPrice = Math.round(price * 100) / 100;
    }
    if (data.scope !== undefined) {
      if (!SCOPES.has(data.scope)) throw new ValidationError('scope must be TICKET, APPLICATION or BOTH');
      out.scope = data.scope;
    }
    if (data.taxable !== undefined) {
      if (typeof data.taxable !== 'boolean') throw new ValidationError('taxable must be a boolean');
      out.taxable = data.taxable;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Saved add-ons for the picker, plus the preset suggestions not saved yet.
   * @param {string} organizationId
   * @param {{ q?: string, scope?: string, includeArchived?: boolean, eventId?: string }} query
   */
  async list(organizationId, { q, scope, includeArchived = false, eventId } = {}) {
    if (scope !== undefined && !SCOPES.has(scope)) throw new ValidationError('scope must be TICKET, APPLICATION or BOTH');
    const term = typeof q === 'string' ? q.trim() : '';
    // A TICKET picker also offers BOTH add-ons, and vice versa.
    const scopeFilter = scope && scope !== 'BOTH' ? { scope: { in: [scope, 'BOTH'] } } : {};
    const rows = await prisma.addOnProduct.findMany({
      where: {
        organizationId,
        ...(!includeArchived && { isArchived: false }),
        ...(term && { name: { contains: term, mode: 'insensitive' } }),
        ...scopeFilter,
      },
      include: {
        ...LIST_SELECT_COUNT,
        ...(eventId && { offerings: { where: { eventId }, select: { id: true } } }),
      },
      orderBy: { name: 'asc' },
    });

    // Suggestions: presets whose name no saved add-on (archived included) already uses.
    const taken = new Set(
      (await prisma.addOnProduct.findMany({ where: { organizationId }, select: { name: true } })).map((p) => nameKey(p.name))
    );
    const suggestions = ADD_ON_PRESETS.filter(
      (p) =>
        !taken.has(nameKey(p.name)) &&
        (!term || nameKey(p.name).includes(term.toLowerCase())) &&
        (!scope || scope === 'BOTH' || p.scope === scope || p.scope === 'BOTH')
    ).map((p) => ({ ...p, defaultPrice: p.price }));

    // "Create '<typed name>'" is offered only when nothing matches exactly (case-insensitive).
    const exactMatch = term
      ? (await this.findByName(prisma, organizationId, term)) ?? null
      : null;

    return {
      savedAddOns: rows.map((r) => this.serialize(r, { eventId })),
      suggestions,
      ...(term && { exactMatch: exactMatch ? this.serialize(exactMatch) : null, canCreate: !exactMatch }),
    };
  }

  async get(organizationId, id) {
    const product = await this._require(organizationId, id);
    const offerings = await prisma.addOn.findMany({
      where: { productId: id },
      select: {
        id: true,
        price: true,
        isActive: true,
        quantitySold: true,
        event: { select: { id: true, name: true, date: true, status: true, venue: { select: { timezone: true } } } },
      },
      orderBy: { event: { date: 'desc' } },
    });
    return {
      ...this.serialize(product),
      offerings: offerings.map((o) => ({
        addOnId: o.id,
        price: Number(o.price),
        isActive: o.isActive,
        quantitySold: o.quantitySold,
        event: {
          id: o.event.id,
          name: o.event.name,
          date: o.event.date,
          status: o.event.status,
          timezone: o.event.venue?.timezone ?? null,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Writes (ADMIN)
  // ---------------------------------------------------------------------------

  /** Create inside `tx` (lock already held). 409 on a case-insensitive duplicate. */
  async createInTx(tx, organizationId, fields) {
    const existing = await this.findByName(tx, organizationId, fields.name);
    if (existing) {
      throw conflict(`A saved add-on named "${existing.name}" already exists`, 'SAVED_ADD_ON_EXISTS', {
        savedAddOnId: existing.id,
        name: existing.name,
        isArchived: existing.isArchived,
      });
    }
    return tx.addOnProduct.create({ data: { organizationId, ...fields } });
  }

  async create(organizationId, data) {
    const fields = this.fields(data, { creating: true });
    const product = await prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, organizationId);
      return this.createInTx(tx, organizationId, fields);
    });
    logger.info('Saved add-on created', { event: 'saved_add_on_created', organizationId, savedAddOnId: product.id });
    return this.serialize(await this._require(organizationId, product.id));
  }

  /**
   * Update a saved add-on. Name / description / scope / taxable are copied onto
   * every offering; `defaultPrice` only affects future attachments (D9).
   */
  async update(organizationId, id, data) {
    await this._require(organizationId, id);
    const fields = this.fields(data, { creating: false });
    if (Object.keys(fields).length === 0) throw new ValidationError('Nothing to update');
    await prisma.$transaction(async (tx) => {
      await this.lockOrg(tx, organizationId);
      await this.updateInTx(tx, organizationId, id, fields);
    });
    return this.serialize(await this._require(organizationId, id));
  }

  /** Apply shared-field changes inside `tx` (lock held) and copy them to the offerings. */
  async updateInTx(tx, organizationId, id, fields) {
    if (fields.name !== undefined) {
      const clash = await this.findByName(tx, organizationId, fields.name, { excludeId: id });
      if (clash) {
        throw conflict(`A saved add-on named "${clash.name}" already exists`, 'SAVED_ADD_ON_EXISTS', {
          savedAddOnId: clash.id,
          name: clash.name,
          isArchived: clash.isArchived,
        });
      }
    }
    const product = await tx.addOnProduct.update({ where: { id }, data: fields });
    const shared = {};
    for (const key of ['name', 'description', 'scope', 'taxable']) if (fields[key] !== undefined) shared[key] = fields[key];
    if (Object.keys(shared).length) await tx.addOn.updateMany({ where: { productId: id }, data: shared });
    return product;
  }

  /** Archive hides it from the picker; offerings and history are untouched. */
  async setArchived(organizationId, id, isArchived) {
    await this._require(organizationId, id);
    await prisma.addOnProduct.update({ where: { id }, data: { isArchived } });
    return this.serialize(await this._require(organizationId, id));
  }

  /**
   * Find the saved add-on for `fields.name` (case-insensitive) or create it,
   * inside `tx` with the org lock held. Used by the per-event create endpoint
   * so every new offering has a product. A match whose scope / taxable differ
   * from an explicitly requested value is a 409 (the caller should pick the
   * saved add-on or another name). A matched archived add-on is restored.
   * @returns {{ product, created: boolean }}
   */
  async findOrCreateInTx(tx, organizationId, fields, { explicit = {} } = {}) {
    const existing = await this.findByName(tx, organizationId, fields.name);
    if (!existing) {
      const product = await tx.addOnProduct.create({ data: { organizationId, ...fields } });
      return { product, created: true };
    }
    const mismatch = ['scope', 'taxable'].filter((k) => explicit[k] !== undefined && explicit[k] !== existing[k]);
    if (mismatch.length) {
      throw conflict(
        `A saved add-on named "${existing.name}" already exists with a different ${mismatch.join(' and ')}`,
        'SAVED_ADD_ON_CONFLICT',
        {
          savedAddOnId: existing.id,
          name: existing.name,
          scope: existing.scope,
          taxable: existing.taxable,
        }
      );
    }
    let product = existing;
    const patch = {};
    if (existing.isArchived) patch.isArchived = false;
    // Fill a missing description in, never overwrite one.
    if (!existing.description && fields.description) patch.description = fields.description;
    if (Object.keys(patch).length) {
      product = await tx.addOnProduct.update({ where: { id: existing.id }, data: patch });
      if (patch.description) await tx.addOn.updateMany({ where: { productId: existing.id }, data: { description: patch.description } });
    }
    return { product, created: false };
  }

  // ---------------------------------------------------------------------------
  // Serializer
  // ---------------------------------------------------------------------------

  serialize(p, { eventId } = {}) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      defaultPrice: Number(p.defaultPrice),
      scope: p.scope,
      taxable: p.taxable,
      isArchived: p.isArchived,
      eventCount: p._count?.offerings ?? undefined,
      ...(eventId && { onEvent: (p.offerings || [])[0]?.id ?? null }),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}

export default new AddOnProductService();
