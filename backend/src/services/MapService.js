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
import feeService from './FeeService.js';
import storeFileService from './StoreFileService.js';
import imageService from './ImageService.js';
import applicationFormService, { tierAmounts } from './ApplicationFormService.js';
import floorMapTemplateService from './FloorMapTemplateService.js';

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
      select: { id: true, name: true, price: true, mapBound: true, quantityTotal: true, formId: true, displayOrder: true },
      orderBy: [{ form: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
    });

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
        mapBound: t.mapBound, quantityTotal: t.quantityTotal,
        form: formMap[t.formId] ? { id: t.formId, name: formMap[t.formId].name, slug: formMap[t.formId].slug } : null,
        displayOrder: t.displayOrder,
      })),
      booths: map.booths.map((b) => ({
        ...b,
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

      if (x === null) throw new ValidationError(`booth ${i + 1}: x must be an integer`);
      if (y === null) throw new ValidationError(`booth ${i + 1}: y must be an integer`);
      if (w === null) throw new ValidationError(`booth ${i + 1}: w must be ${MIN_BOOTH_SIZE}–${MAX_BOOTH_SIZE}`);
      if (h === null) throw new ValidationError(`booth ${i + 1}: h must be ${MIN_BOOTH_SIZE}–${MAX_BOOTH_SIZE}`);

      if (x + w > map.width) throw new ValidationError(`booth ${i + 1} (${b.label}) extends beyond right edge`);
      if (y + h > map.height) throw new ValidationError(`booth ${i + 1} (${b.label}) extends beyond bottom edge`);

      validatedBooths.push({ label: b.label, kind, x, y, w, h, rotation, tierId });
    }

    // A booth may only be priced from a tier on this event's own paid forms.
    const boundTierIds = [...new Set(validatedBooths.map((b) => b.tierId).filter(Boolean))];
    if (boundTierIds.length > 0) {
      const eventTiers = await prisma.applicationTier.findMany({
        where: { id: { in: boundTierIds }, form: { eventId: map.eventId, kind: 'PAID' } },
        select: { id: true },
      });
      if (eventTiers.length !== boundTierIds.length) {
        throw new ValidationError('booth tierId must reference an application tier on one of this event\'s paid application forms');
      }
    }

    // Run the upsert transaction
    return prisma.$transaction(async (tx) => {
      const existing = await tx.booth.findMany({ where: { mapId } });
      const existingByLabel = {};
      for (const eb of existing) existingByLabel[eb.label] = eb;

      const incomingLabels = new Set(validatedBooths.map((b) => b.label));
      const blockedLabels = [];

      for (const input of validatedBooths) {
        const old = existingByLabel[input.label];
        if (old) {
          if (['SOLD', 'HELD', 'RESERVED'].includes(old.status)) {
            // Only tierId can change on in-use booths
            if (input.tierId !== old.tierId) {
              await tx.booth.update({ where: { id: old.id }, data: { tierId: input.tierId } });
            }
            continue;
          }
          await tx.booth.update({
            where: { id: old.id },
            data: { kind: input.kind, x: input.x, y: input.y, w: input.w, h: input.h, rotation: input.rotation, tierId: input.tierId },
          });
        } else {
          await tx.booth.create({
            data: { mapId, label: input.label, kind: input.kind, x: input.x, y: input.y, w: input.w, h: input.h, rotation: input.rotation, tierId: input.tierId },
          });
        }
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
      const full = await tx.floorMap.findUnique({
        where: { id: mapId },
        include: { booths: { orderBy: [{ y: 'asc' }, { x: 'asc' }] } },
      });
      return full;
    });
  }

  // ─── Publish / Unpublish ────────────────────────────────────────────

  /**
   * Publish: set PUBLISHED, bind the map's tiers, sync their quantities from
   * booth counts, check oversold.
   *
   * Re-publishing an already-published map re-runs the binding instead of
   * no-opping. That keeps publish idempotent and is the in-product repair for a
   * map published before publish bound anything: the organizer presses Publish
   * again. `publishedAt` is only stamped on the first publish.
   */
  async publish(orgId, mapId) {
    const map = await this._requireInOrg(orgId, mapId);

    const boothCount = await prisma.booth.count({ where: { mapId, status: { not: 'BLOCKED' } } });
    if (boothCount < 1) throw new ValidationError('Map must have at least one booth to publish');

    await prisma.$transaction(async (tx) => {
      await tx.floorMap.update({
        where: { id: mapId },
        data: {
          status: 'PUBLISHED',
          ...(map.publishedAt ? {} : { publishedAt: new Date() }),
        },
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
      // Scoped to this event's own PAID forms: a stray tierId must never flip a
      // flag or rewrite capacity on another organizer's tier.
      const tiers = tierIds.length > 0
        ? await tx.applicationTier.findMany({
            where: { id: { in: tierIds }, form: { eventId: map.eventId, kind: 'PAID' } },
            select: { id: true, name: true, quantityApproved: true, quantityReserved: true, form: { select: { chargeTiming: true, name: true } } },
          })
        : [];

      if (tiers.length !== tierIds.length) {
        throw new ValidationError('TIER_NOT_ON_EVENT — a booth is bound to a tier that is not on one of this event\'s paid application forms');
      }

      for (const tier of tiers) {
        // Booths are bought after approval; a charge-at-submission form has no spot to sell.
        if (tier.form.chargeTiming !== 'APPROVAL') {
          throw new ConflictError(`TIER_CHARGE_TIMING — form "${tier.form.name}" charges at submission; set it to charge on approval before binding "${tier.name}" to the map`);
        }
        const count = tierCounts[tier.id];
        const used = tier.quantityApproved + tier.quantityReserved;
        if (count < used) {
          throw new ConflictError(`TIER_OVERSOLD — tier "${tier.id}" has ${used} approved/reserved slots but only ${count} booths`);
        }
      }

      // Bind every tier the map sells: publishing is what makes a tier map-bound,
      // and capacity is the booth count, not whatever was typed on the tier.
      for (const tierId of tierIds) {
        await tx.applicationTier.updateMany({
          where: { id: tierId, form: { eventId: map.eventId, kind: 'PAID' } },
          data: { mapBound: true, quantityTotal: tierCounts[tierId] },
        });
      }

      // Unbind tiers this map no longer sells, so they go back to being bought
      // at approval. Quantity is left as is — see spec 014 plan-phase-1 §3.3.
      await tx.applicationTier.updateMany({
        where: {
          form: { eventId: map.eventId, kind: 'PAID' },
          mapBound: true,
          id: { notIn: tierIds },
        },
        data: { mapBound: false },
      });

      logger.info('Floor map published', {
        event: 'floor_map_published',
        mapId,
        organizationId: orgId,
        boundTierIds: tierIds,
      });
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

  /** GET /events/:eventId/map — published map only, no-cache. */
  async publicMap(eventId) {
    const map = await prisma.floorMap.findUnique({
      where: { eventId },
      include: {
        booths: {
          orderBy: [{ y: 'asc' }, { x: 'asc' }],
          select: { id: true, label: true, kind: true, x: true, y: true, w: true, h: true, rotation: true, status: true, tierId: true, applicationId: true, updatedAt: true },
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

    // Compute legend with all-in prices using the form's fee mode
    const legend = [];
    const seenTierIds = new Set();
    for (const b of map.booths) {
      if (b.tierId && tierMap[b.tierId] && !seenTierIds.has(b.tierId)) {
        const tier = tierMap[b.tierId];
        // Get all-in price for this tier using the form's fee mode
        const amounts = tierAmounts(Number(tier.price), tier.form, map.event, map.event.venue.organization);
        legend.push({
          tierId: tier.id,
          name: tier.name,
          price: amounts.applicantPays, // all-in price
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
    if (map.booths) result.booths = map.booths;
    if (map._count) result.boothCount = map._count.booths;
    return result;
  }
}

export default new MapService();