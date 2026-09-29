// Map Service (spec 014 phase 1)
// CRUD for FloorMap + Booth rows, publish/unpublish, layout replacement,
// event-duplicate copy, and public read endpoint.
//
// Booth rows are locked with FOR UPDATE on write (like PriceTier/ApplicationTier
// capacity). Booth geometry is stored as rows, not JSON, so a purchase can
// SELECT … FOR UPDATE one booth at a time without a table-wide lock.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import {
  MAX_BOOTHS, MAX_ELEMENTS, MAX_MAP_WIDTH, MAX_MAP_HEIGHT,
  MIN_BOOTH_SIZE, MAX_BOOTH_SIZE, BOOTH_KINDS, UNITS,
  ELEMENT_KINDS, EMPTY_LAYOUT, MIN_MAP_NAME_LENGTH, MAX_MAP_NAME_LENGTH,
} from '../config/maps.js';
import logger from '../utils/logger.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';
import feeService from './FeeService.js';
import storeFileService from './StoreFileService.js';
import imageService from './ImageService.js';
import applicationFormService, { tierAmounts } from './ApplicationFormService.js';
import { spacePriceFor } from './orderLines.js';
import floorMapTemplateService from './FloorMapTemplateService.js';

// Spec 039: per-booth price ceiling (the tier validator's range).
const MAX_BOOTH_PRICE = 100_000;

/** Booth row with its Decimal price as a number, as every map payload sends it. */
function boothOut(b) {
  return { ...b, price: b.price === null || b.price === undefined ? null : Number(b.price) };
}

function samePrice(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

class MapService {
  // ─── Admin CRUD ─────────────────────────────────────────────────────

  /** Find a map by event within an org (deep-link helper). */
  async findByEvent(orgId, eventId) {
    return prisma.floorMap.findFirst({
      where: { eventId, organizationId: orgId },
      select: { id: true },
    });
  }

  /** List maps for an org with event summary, booth counts. */
  async list(orgId) {
    const maps = await prisma.floorMap.findMany({
      where: { organizationId: orgId },
      include: {
        _count: { select: { booths: true } },
        event: { select: { id: true, name: true, slug: true, date: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    // Count sold booths per map
    const sold = await prisma.booth.groupBy({
      by: ['mapId'],
      where: { map: { organizationId: orgId }, status: 'SOLD' },
      _count: { id: true },
    });
    const soldByMap = {};
    for (const row of sold) soldByMap[row.mapId] = row._count.id;

    const reserved = await prisma.booth.groupBy({
      by: ['mapId'],
      where: { map: { organizationId: orgId }, status: 'RESERVED' },
      _count: { id: true },
    });
    const reservedByMap = {};
    for (const row of reserved) reservedByMap[row.mapId] = row._count.id;

    const blocked = await prisma.booth.groupBy({
      by: ['mapId'],
      where: { map: { organizationId: orgId }, status: 'BLOCKED' },
      _count: { id: true },
    });
    const blockedByMap = {};
    for (const row of blocked) blockedByMap[row.mapId] = row._count.id;

    return maps.map((m) => ({
      id: m.id, eventId: m.eventId, name: m.name, status: m.status,
      width: m.width, height: m.height, unit: m.unit,
      boothCount: m._count.booths,
      soldCount: soldByMap[m.id] || 0,
      reservedCount: reservedByMap[m.id] || 0,
      blockedCount: blockedByMap[m.id] || 0,
      event: m.event, publishedAt: m.publishedAt,
      createdAt: m.createdAt, updatedAt: m.updatedAt,
    }));
  }

  /** Create a map. Defaults name → event name, size 50×40. */
  async create(orgId, data) {
    const eventId = data.eventId;
    if (!eventId) throw new ValidationError('eventId is required');

    const event = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId: orgId } },
      select: { id: true, name: true },
    });
    if (!event) throw new NotFoundError('Event not found in this organization');

    const existing = await prisma.floorMap.findUnique({ where: { eventId } });
    if (existing) throw new ConflictError('MAP_EXISTS — this event already has a floor map');

    let template = null;
    let materialised = null;
    if (data.templateId) {
      template = await floorMapTemplateService.requireInScope(data.templateId, orgId);
      materialised = floorMapTemplateService.materialise(template.definition, {
        tierBindings: data.tierBindings ?? {},
      });
      const boundTierIds = [...new Set(materialised.booths.map((booth) => booth.tierId).filter(Boolean))];
      if (boundTierIds.length > 0) {
        const destinationTiers = await prisma.applicationTier.findMany({
          where: { id: { in: boundTierIds }, form: { eventId } },
          select: { id: true },
        });
        if (destinationTiers.length !== boundTierIds.length) {
          throw new ValidationError('tierBindings must reference application tiers on the destination event');
        }
      }
    }

    const mapData = {
      organizationId: orgId,
      eventId,
      name: data.name || event.name,
      width: this._validateDimension('width', data.width, materialised?.width ?? 50),
      height: this._validateDimension('height', data.height, materialised?.height ?? 40),
      unit: data.unit && UNITS.has(data.unit) ? data.unit : (materialised?.unit ?? 'ft'),
      gridSize: Number.isInteger(data.gridSize) ? Math.max(1, Math.min(100, data.gridSize)) : (materialised?.gridSize ?? 10),
      underlayFileId: data.underlayFileId || null,
      underlayOpacity: Number.isInteger(data.underlayOpacity) ? data.underlayOpacity : 40,
      layout: data.layout || materialised?.layout || EMPTY_LAYOUT,
      createdFromTemplateId: template?.id ?? null,
    };

    const map = materialised
      ? await prisma.$transaction(async (tx) => {
          const created = await tx.floorMap.create({ data: mapData });
          if (materialised.booths.length > 0) {
            await tx.booth.createMany({
              data: materialised.booths.map(({ tierLabel: _tierLabel, ...booth }) => ({
                ...booth,
                mapId: created.id,
              })),
            });
          }
          return created;
        })
      : await prisma.floorMap.create({ data: mapData });

    logger.info('Floor map created', {
      event: 'floor_map_created', mapId: map.id, eventId, organizationId: orgId,
    });

    return this._serialize(map);
  }

  /** Get a map + booths + tiers of the event's PAID forms. */
  async get(orgId, mapId) {
    const map = await prisma.floorMap.findFirst({
      where: { id: mapId, organizationId: orgId },
      include: { booths: { orderBy: [{ y: 'asc' }, { x: 'asc' }] } },
    });
    if (!map) throw new NotFoundError('Floor map not found');

    const tiers = await prisma.applicationTier.findMany({
      where: { form: { eventId: map.eventId, kind: 'PAID' } },
      select: { id: true, name: true, price: true, quantityTotal: true, formId: true, displayOrder: true },
      orderBy: [{ form: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
    });
    // Spec 037 phase 5: a tier is map-bound when this map has booths on it.
    const boundTierIds = new Set(map.booths.map((b) => b.tierId).filter(Boolean));

    const formIds = [...new Set(tiers.map((t) => t.formId))];
    const forms = formIds.length > 0
      ? await prisma.applicationForm.findMany({
          where: { id: { in: formIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const formMap = {};
    for (const f of forms) formMap[f.id] = f;

    // Booth holders
    const soldAppIds = map.booths.filter((b) => b.applicationId).map((b) => b.applicationId);
    const holders = soldAppIds.length > 0
      ? await prisma.application.findMany({
          where: { id: { in: soldAppIds } },
          select: { id: true, status: true, paymentStatus: true, profile: { select: { businessName: true } } },
        })
      : [];
    const holderMap = {};
    for (const h of holders) holderMap[h.id] = h;

    return {
      ...this._serialize(map),
      tiers: tiers.map((t) => ({
        id: t.id, name: t.name, price: Number(t.price),
        mapBound: boundTierIds.has(t.id), quantityTotal: t.quantityTotal,
        form: formMap[t.formId] ? { id: t.formId, name: formMap[t.formId].name, slug: formMap[t.formId].slug } : null,
        displayOrder: t.displayOrder,
      })),
      booths: map.booths.map((b) => ({
        ...boothOut(b),
        holder: b.applicationId && holderMap[b.applicationId]
          ? { id: b.applicationId, status: holderMap[b.applicationId].status, paymentStatus: holderMap[b.applicationId].paymentStatus, businessName: holderMap[b.applicationId].profile?.businessName || null }
          : null,
      })),
    };
  }

  /** Partial update of map metadata. */
  async update(orgId, mapId, data) {
    const map = await this._requireInOrg(orgId, mapId);
    const updateData = {};

    if (data.name !== undefined) {
      const v = String(data.name ?? '').trim();
      if (v.length < MIN_MAP_NAME_LENGTH || v.length > MAX_MAP_NAME_LENGTH) {
        throw new ValidationError(`name must be ${MIN_MAP_NAME_LENGTH}–${MAX_MAP_NAME_LENGTH} characters`);
      }
      updateData.name = v;
    }
    if (data.width !== undefined) updateData.width = this._validateDimension('width', data.width);
    if (data.height !== undefined) updateData.height = this._validateDimension('height', data.height);
    if (data.unit !== undefined) {
      if (!UNITS.has(data.unit)) throw new ValidationError('unit must be "ft" or "m"');
      updateData.unit = data.unit;
    }
    if (data.gridSize !== undefined) {
      if (!Number.isInteger(data.gridSize) || data.gridSize < 1 || data.gridSize > 100) {
        throw new ValidationError('gridSize must be 1–100');
      }
      updateData.gridSize = data.gridSize;
    }
    if (data.underlayFileId !== undefined) updateData.underlayFileId = data.underlayFileId || null;
    if (data.underlayOpacity !== undefined) {
      if (!Number.isInteger(data.underlayOpacity) || data.underlayOpacity < 0 || data.underlayOpacity > 100) {
        throw new ValidationError('underlayOpacity must be 0–100');
      }
      updateData.underlayOpacity = data.underlayOpacity;
    }
    if (data.layout !== undefined) {
      this._validateLayout(data.layout);
      updateData.layout = data.layout;
    }

    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('No fields to update');
    }

    const updated = await prisma.floorMap.update({ where: { id: mapId }, data: updateData });
    return this._serialize(updated);
  }

  /** Delete a map. 409 if any booth is SOLD / HELD. */
  async remove(orgId, mapId) {
    await this._requireInOrg(orgId, mapId);

    const active = await prisma.booth.findFirst({
      where: { mapId, status: { in: ['SOLD', 'HELD'] } },
      select: { id: true },
    });
    if (active) throw new ValidationError('Cannot delete a map with SOLD or HELD booths');

    await prisma.floorMap.delete({ where: { id: mapId } });
    logger.info('Floor map deleted', { event: 'floor_map_deleted', mapId, organizationId: orgId });
  }

  // ─── Layout replacement (builder whole-tree save) ──────────────────

  /**
   * Replace elements and booths in one transaction. Upserts booths by label;
   * deletes absent booths unless SOLD/HELD/RESERVED (409 BOOTH_IN_USE).
   * Returns the full get() payload on success.
   */
  async replaceLayout(orgId, mapId, { elements, booths }) {
    const map = await this._requireInOrg(orgId, mapId);

    // Validate elements
    if (!Array.isArray(elements)) throw new ValidationError('elements must be an array');
    if (elements.length > MAX_ELEMENTS) throw new ValidationError(`At most ${MAX_ELEMENTS} elements`);
    for (const [i, e] of elements.entries()) {
      if (!e || typeof e !== 'object') throw new ValidationError(`element ${i + 1} must be an object`);
      if (e.x === undefined || !Number.isInteger(e.x) || e.x < 0) throw new ValidationError(`element ${i + 1}: x invalid`);
      if (e.y === undefined || !Number.isInteger(e.y) || e.y < 0) throw new ValidationError(`element ${i + 1}: y invalid`);
      if (e.kind && !ELEMENT_KINDS.has(e.kind)) {
        throw new ValidationError(`element ${i + 1}: unknown kind "${e.kind}"`);
      }
    }

    // Validate booths
    if (!Array.isArray(booths)) throw new ValidationError('booths must be an array');
    if (booths.length > MAX_BOOTHS) throw new ValidationError(`At most ${MAX_BOOTHS} booths`);

    const validatedBooths = [];
    const seenLabels = new Set();

    for (const [i, b] of booths.entries()) {
      if (!b || typeof b !== 'object') throw new ValidationError(`booth ${i + 1} must be an object`);
      if (!b.label || typeof b.label !== 'string' || b.label.length === 0 || b.label.length > 20) {
        throw new ValidationError(`booth ${i + 1}: label required, 1–20 chars`);
      }
      if (seenLabels.has(b.label)) throw new ValidationError(`Duplicate booth label: ${b.label}`);
      seenLabels.add(b.label);

      const kind = BOOTH_KINDS.has(b.kind) ? b.kind : 'BOOTH';
      const x = Number.isInteger(b.x) ? b.x : null;
      const y = Number.isInteger(b.y) ? b.y : null;
      const w = Number.isInteger(b.w) && b.w >= MIN_BOOTH_SIZE && b.w <= MAX_BOOTH_SIZE ? b.w : null;
      const h = Number.isInteger(b.h) && b.h >= MIN_BOOTH_SIZE && b.h <= MAX_BOOTH_SIZE ? b.h : null;
      const rotation = [0, 90].includes(b.rotation) ? b.rotation : 0;
      const tierId = b.tierId || null;
      // Spec 039: the booth's own price. Absent keeps what is stored (older
      // builders never send it); null clears it back to the tier's price.
      let price;
      if (b.price === null) price = null;
      else if (b.price !== undefined) {
        const value = typeof b.price === 'string' && b.price.trim() !== '' ? Number(b.price) : b.price;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_BOOTH_PRICE || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
          throw new ValidationError(`booth ${i + 1} (${b.label}): price must be 0–${MAX_BOOTH_PRICE} with at most 2 decimals, or null`);
        }
        price = Math.round(value * 100) / 100;
      }

      if (x === null) throw new ValidationError(`booth ${i + 1}: x must be an integer`);
      if (y === null) throw new ValidationError(`booth ${i + 1}: y must be an integer`);
      if (w === null) throw new ValidationError(`booth ${i + 1}: w must be ${MIN_BOOTH_SIZE}–${MAX_BOOTH_SIZE}`);
      if (h === null) throw new ValidationError(`booth ${i + 1}: h must be ${MIN_BOOTH_SIZE}–${MAX_BOOTH_SIZE}`);

      if (x + w > map.width) throw new ValidationError(`booth ${i + 1} (${b.label}) extends beyond right edge`);
      if (y + h > map.height) throw new ValidationError(`booth ${i + 1} (${b.label}) extends beyond bottom edge`);

      validatedBooths.push({ label: b.label, kind, x, y, w, h, rotation, tierId, ...(price !== undefined && { price }) });
    }

    // Run the upsert transaction
    const full = await prisma.$transaction(async (tx) => {
      // Lock the map's booths first: a vendor holding one (BoothService
      // takes the same row lock) must never see its price change between the
      // hold and the charge (spec 039).
      await tx.$queryRaw`SELECT "id" FROM "Booth" WHERE "mapId" = ${mapId} FOR UPDATE`;
      const existing = await tx.booth.findMany({ where: { mapId } });
      const existingByLabel = {};
      for (const eb of existing) existingByLabel[eb.label] = eb;

      const incomingLabels = new Set(validatedBooths.map((b) => b.label));
      const blockedLabels = [];
      const priceLocked = [];

      for (const input of validatedBooths) {
        const old = existingByLabel[input.label];
        if (old) {
          if (['SOLD', 'HELD', 'RESERVED'].includes(old.status)) {
            // Only tierId can change on in-use booths; the price is what the
            // vendor holds, owns or was placed at, so it is locked too.
            if (input.price !== undefined && !samePrice(input.price, old.price)) priceLocked.push(old.label);
            if (input.tierId !== old.tierId) {
              await tx.booth.update({ where: { id: old.id }, data: { tierId: input.tierId } });
            }
            continue;
          }
          await tx.booth.update({
            where: { id: old.id },
            data: { kind: input.kind, x: input.x, y: input.y, w: input.w, h: input.h, rotation: input.rotation, tierId: input.tierId, ...(input.price !== undefined && { price: input.price }) },
          });
        } else {
          await tx.booth.create({
            data: { mapId, label: input.label, kind: input.kind, x: input.x, y: input.y, w: input.w, h: input.h, rotation: input.rotation, tierId: input.tierId, price: input.price ?? null },
          });
        }
      }

      if (priceLocked.length > 0) {
        const error = new ConflictError(`BOOTH_PRICE_LOCKED — a vendor holds or owns: ${priceLocked.join(', ')}`);
        error.code = 'BOOTH_PRICE_LOCKED';
        throw error;
      }

      const toDelete = existing.filter(
        (eb) => !incomingLabels.has(eb.label) && ['AVAILABLE', 'BLOCKED'].includes(eb.status)
      );
      if (toDelete.length > 0) {
        await tx.booth.deleteMany({ where: { id: { in: toDelete.map((b) => b.id) } } });
      }

      // Check for in-use booths that were removed from the payload
      for (const eb of existing) {
        if (!incomingLabels.has(eb.label) && ['SOLD', 'HELD', 'RESERVED'].includes(eb.status)) {
          blockedLabels.push(eb.label);
        }
      }

      // Write the layout elements
      await tx.floorMap.update({
        where: { id: mapId },
        data: { layout: { version: 1, elements } },
      });

      if (blockedLabels.length > 0) {
        throw new ConflictError(`BOOTH_IN_USE — cannot remove: ${blockedLabels.join(', ')}`);
      }

      // Return full map detail
      return tx.floorMap.findUnique({
        where: { id: mapId },
        include: { booths: { orderBy: [{ y: 'asc' }, { x: 'asc' }] } },
      });
    });
    return { ...full, booths: full.booths.map(boothOut) };
  }

  // ─── Publish / Unpublish ────────────────────────────────────────────

  /**
   * Publish: set PUBLISHED, set every bound tier's quantity to its booth
   * count, check oversold. Spec 037 phase 5: "bound" is derived — any tier a
   * booth on this map points at — and every PAID form sells its space after
   * approval, so the form's legacy `chargeTiming` no longer matters here.
   */
  async publish(orgId, mapId) {
    const map = await this._requireInOrg(orgId, mapId);
    if (map.status === 'PUBLISHED') return this.get(orgId, mapId);

    const boothCount = await prisma.booth.count({ where: { mapId, status: { not: 'BLOCKED' } } });
    if (boothCount < 1) throw new ValidationError('Map must have at least one booth to publish');

    await prisma.$transaction(async (tx) => {
      await tx.floorMap.update({
        where: { id: mapId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });

      // Derive tier quantities from booth counts
      const booths = await tx.booth.findMany({
        where: { mapId, status: { not: 'BLOCKED' } },
        select: { tierId: true },
      });

      const tierCounts = {};
      for (const b of booths) {
        if (b.tierId) tierCounts[b.tierId] = (tierCounts[b.tierId] || 0) + 1;
      }

      const tierIds = Object.keys(tierCounts);
      const tiers = tierIds.length > 0
        ? await tx.applicationTier.findMany({
            where: { id: { in: tierIds } },
            select: { id: true, name: true, quantityApproved: true, quantityReserved: true },
          })
        : [];

      for (const tier of tiers) {
        const count = tierCounts[tier.id];
        const used = tier.quantityApproved + tier.quantityReserved;
        if (count < used) {
          throw new ConflictError(`TIER_OVERSOLD — tier "${tier.id}" has ${used} approved/reserved slots but only ${count} booths`);
        }
      }

      for (const tierId of tierIds) {
        await tx.applicationTier.updateMany({
          where: { id: tierId },
          data: { quantityTotal: tierCounts[tierId] },
        });
      }

      logger.info('Floor map published', { event: 'floor_map_published', mapId, organizationId: orgId });
    });
    const result = await this.get(orgId, mapId);
    logger.info('Publish get result', { status: result.status });
    return result;
  }

  /** Unpublish: back to DRAFT. Leaves mapBound and quantities alone. */
  async unpublish(orgId, mapId) {
    await this._requireInOrg(orgId, mapId);
    await prisma.floorMap.update({
      where: { id: mapId },
      data: { status: 'DRAFT', publishedAt: null },
    });
    return this.get(orgId, mapId);
  }

  // ─── Public read ─────────────────────────────────────────────────────

  /**
   * GET /events/:eventId/map — published map only, no-cache. `identifier` is
   * the event's id or its public slug: the storefront map page lives at the
   * slug URL (resource slugs) and asks for the map with it.
   */
  async publicMap(identifier) {
    const resolved = await findByPublicIdentifier(prisma.event, identifier, { select: { id: true } });
    if (!resolved) throw new NotFoundError('Map not published for this event');
    const eventId = resolved.id;
    const map = await prisma.floorMap.findUnique({
      where: { eventId },
      include: {
        booths: {
          orderBy: [{ y: 'asc' }, { x: 'asc' }],
          select: { id: true, label: true, kind: true, x: true, y: true, w: true, h: true, rotation: true, status: true, tierId: true, price: true, applicationId: true, updatedAt: true },
        },
        underlay: { include: { file: true } },
        event: {
          select: {
            id: true,
            taxRate: true,
            // Events belong to organizations through the venue (Event → Venue → Organization).
            venue: { select: { timezone: true, organization: { select: { id: true, brandColor: true, themeMode: true, taxInclusivePricing: true } } } },
          },
        },
      },
    });

    if (!map || map.status !== 'PUBLISHED') {
      throw new NotFoundError('Map not published for this event');
    }

    // Resolve tier names/price for booth legend
    const tierIds = [...new Set(map.booths.filter((b) => b.tierId).map((b) => b.tierId))];
    const tiers = tierIds.length > 0
      ? await prisma.applicationTier.findMany({
          where: { id: { in: tierIds } },
          select: { id: true, name: true, price: true, form: { select: { id: true, name: true, slug: true, feeMode: true, taxable: true } } },
        })
      : [];
    const tierMap = {};
    for (const t of tiers) tierMap[t.id] = t;

    // Public directory: approved PAID-form vendors only, scoped to this event
    // and explicitly visible. Never select Contact or organizer-only metadata.
    const vendors = await prisma.application.findMany({
      where: {
        eventId,
        status: 'APPROVED',
        publicProfile: true,
        form: { kind: 'PAID' },
      },
      select: {
        id: true,
        updatedAt: true,
        booth: { select: { id: true, label: true, status: true } },
        tier: { select: { id: true, name: true } },
        form: { select: { id: true, name: true } },
        profile: {
          select: {
            businessName: true,
            description: true,
            website: true,
            socials: true,
            updatedAt: true,
            images: {
              take: 1,
              orderBy: { displayOrder: 'asc' },
              select: { image: { include: { file: true } } },
            },
          },
        },
      },
      orderBy: [{ profile: { businessName: 'asc' } }, { id: 'asc' }],
    });
    const vendorMap = {};
    for (const v of vendors) vendorMap[v.id] = v.profile?.businessName || null;

    const directory = vendors.map((vendor) => {
      const firstImage = vendor.profile?.images?.[0]?.image;
      return {
        id: vendor.id,
        name: vendor.profile.businessName,
        description: vendor.profile.description,
        website: vendor.profile.website,
        socials: vendor.profile.socials || {},
        imageUrl: firstImage ? imageService.formatImageResponse(firstImage).urls.card : null,
        category: vendor.form.name,
        tier: vendor.tier ? { id: vendor.tier.id, name: vendor.tier.name } : null,
        booth: vendor.booth && ['SOLD', 'RESERVED'].includes(vendor.booth.status)
          ? { id: vendor.booth.id, label: vendor.booth.label }
          : null,
      };
    });

    // All-in price of each booth under its form's fee mode (spec 039: the
    // booth's own price when set, else its tier's).
    const allIn = (b) => {
      const tier = tierMap[b.tierId];
      if (!tier) return null;
      return tierAmounts(spacePriceFor({ tier, booth: b }), tier.form, map.event, map.event.venue.organization).applicantPays;
    };
    const boothPrices = new Map(map.booths.map((b) => [b.id, allIn(b)]));

    // Legend: all-in tier price, plus the range its booths span.
    const legend = [];
    const seenTierIds = new Set();
    for (const b of map.booths) {
      if (b.tierId && tierMap[b.tierId] && !seenTierIds.has(b.tierId)) {
        const tier = tierMap[b.tierId];
        const amounts = tierAmounts(Number(tier.price), tier.form, map.event, map.event.venue.organization);
        const prices = map.booths.filter((o) => o.tierId === b.tierId).map((o) => boothPrices.get(o.id));
        legend.push({
          tierId: tier.id,
          name: tier.name,
          price: amounts.applicantPays, // all-in price
          priceFrom: Math.min(...prices),
          priceTo: Math.max(...prices),
          swatch: seenTierIds.size % 6,
        });
        seenTierIds.add(b.tierId);
      }
    }

    // ETag derived from map.updatedAt + max booth.updatedAt
    const boothUpdated = map.booths.length > 0
      ? Math.max(...map.booths.map((b) => new Date(b.updatedAt).getTime()))
      : map.updatedAt.getTime();
    const vendorUpdated = vendors.length > 0
      ? Math.max(...vendors.flatMap((v) => [
          new Date(v.updatedAt).getTime(),
          new Date(v.profile.updatedAt).getTime(),
          ...(v.profile.images || []).map((row) => new Date(row.image.updatedAt).getTime()),
        ]))
      : map.updatedAt.getTime();
    const etagSource = Math.max(map.updatedAt.getTime(), boothUpdated, vendorUpdated);
    const etag = `"${etagSource}"`;

    return {
      id: map.id,
      eventId: map.eventId,
      name: map.name,
      width: map.width,
      height: map.height,
      unit: map.unit,
      gridSize: map.gridSize,
      layout: map.layout,
      underlayFileId: map.underlayFileId,
      underlayUrl: map.underlay ? storeFileService.url(map.underlay) : null,
      underlayOpacity: map.underlayOpacity,
      legend,
      vendors: directory,
      booths: map.booths.map((b) => ({
        id: b.id,
        label: b.label,
        kind: b.kind,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        rotation: b.rotation,
        status: b.status,
        // Spec 039: what this booth costs the vendor, fees and tax included.
        price: boothPrices.get(b.id),
        tier: b.tierId && tierMap[b.tierId]
          ? { id: b.tierId, name: tierMap[b.tierId].name, price: Number(tierMap[b.tierId].price) }
          : null,
        vendorName: ['SOLD', 'RESERVED'].includes(b.status) ? (vendorMap[b.applicationId] || null) : null,
      })),
      brandColor: map.event?.venue?.organization?.brandColor || null,
      themeMode: map.event?.venue?.organization?.themeMode || 'SYSTEM',
      updatedAt: map.updatedAt,
      etag,
    };
  }

  // ─── Event duplicate ───────────────────────────────────────────────

  /**
   * Copy a map for event duplication. DRAFT, all booths AVAILABLE, no holders,
   * tier bindings remapped through applicationTierIdMap.
   * Called from EventService.duplicateEvent.
   */
  async copyForEvent(tx, fromEventId, toEventId, { applicationTierIdMap = new Map() } = {}) {
    // Called from EventService.duplicateEvent with the source EVENT id and the
    // Map<sourceTierId, newTierId> that ApplicationFormService.copyForms returns.
    const map = await tx.floorMap.findUnique({
      where: { eventId: fromEventId },
      select: { id: true, name: true, unit: true, gridSize: true, width: true, height: true, underlayOpacity: true, layout: true },
    });
    if (!map) return null; // no source map to copy
    const fromMapId = map.id;
    const remapTier = (id) => (id ? (applicationTierIdMap instanceof Map ? applicationTierIdMap.get(id) : applicationTierIdMap[id]) || null : null);

    const newMap = await tx.floorMap.create({
      data: {
        organizationId: (await tx.event.findUnique({ where: { id: toEventId }, select: { venue: { select: { organizationId: true } } } })).venue.organizationId,
        eventId: toEventId,
        name: map.name,
        status: 'DRAFT',
        unit: map.unit,
        gridSize: map.gridSize,
        width: map.width,
        height: map.height,
        underlayFileId: null, // don't copy underlay
        underlayOpacity: map.underlayOpacity,
        layout: map.layout,
      },
    });

    const sourceBooths = await tx.booth.findMany({ where: { mapId: fromMapId } });
    if (sourceBooths.length > 0) {
      await tx.booth.createMany({
        data: sourceBooths.map((b) => ({
          mapId: newMap.id,
          label: b.label,
          kind: b.kind,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          rotation: b.rotation,
          tierId: remapTier(b.tierId),
          price: b.price, // spec 039 D11: prices travel with event duplication
          status: 'AVAILABLE',
        })),
      });
    }

    return newMap.id;
  }

  // ─── Validation helpers ────────────────────────────────────────────

  _validateDimension(name, value, fallback) {
    const v = value ?? fallback;
    if (!Number.isInteger(v) || v < 1 || v > MAX_MAP_WIDTH) {
      throw new ValidationError(`${name} must be an integer between 1 and ${MAX_MAP_WIDTH}`);
    }
    return v;
  }

  _validateLayout(layout) {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      throw new ValidationError('layout must be an object');
    }
    if (layout.version !== undefined && (!Number.isInteger(layout.version) || layout.version < 1)) {
      throw new ValidationError('layout.version must be a positive integer');
    }
    if (Array.isArray(layout.elements) && layout.elements.length > MAX_ELEMENTS) {
      throw new ValidationError(`At most ${MAX_ELEMENTS} elements`);
    }
  }

  async _requireInOrg(orgId, mapId) {
    const map = await prisma.floorMap.findFirst({
      where: { id: mapId, organizationId: orgId },
    });
    if (!map) throw new NotFoundError('Floor map not found');
    return map;
  }

  _serialize(map) {
    const result = {
      id: map.id, organizationId: map.organizationId, eventId: map.eventId,
      name: map.name, status: map.status,
      unit: map.unit, gridSize: map.gridSize,
      width: map.width, height: map.height,
      underlayFileId: map.underlayFileId, underlayOpacity: map.underlayOpacity,
      layout: map.layout,
      publishedAt: map.publishedAt,
      createdAt: map.createdAt, updatedAt: map.updatedAt,
    };
    if (map.booths) result.booths = map.booths.map(boothOut);
    if (map._count) result.boothCount = map._count.booths;
    return result;
  }
}

export default new MapService();