// Event Service (Schema Redesign)
// Handles event CRUD, status transitions, and venue-scoped operations
// Per FR-012, FR-013, FR-050

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { formatEventSummary } from '../utils/eventSummary.js';
import taxService from './TaxService.js';
import applicationFormService from './ApplicationFormService.js';
import addOnService from './AddOnService.js';
import mapService from './MapService.js';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';
import { rethrowSlugConflict, resolveUniqueSlug } from '../utils/slug.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';
import rsvpService, { remainingFor } from './RsvpService.js';
import emailService from './EmailService.js';

function admissionConflict(message) {
  const error = new ConflictError(message);
  error.code = 'ADMISSION_MODE_LOCKED';
  return error;
}

class EventService {
  /**
   * Create a new event in DRAFT status with price tiers
   * @param {string} orgId - Organization ID
   * @param {Object} data - Event data including priceTiers array
   * @returns {Promise<Object>} Created event with venue and price tiers
   */
  async createEvent(orgId, data) {
    const { venueId, name, description, date, capacity, category, priceTiers } = data;
    const admissionMode = data.admissionMode || 'TICKETED';

    // Validate venue belongs to org
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, organizationId: orgId },
    });
    if (!venue) {
      throw new ValidationError('Venue not found in this organization');
    }

    const rsvpLimit = data.rsvpLimit === null || data.rsvpLimit === undefined ? null : parseInt(data.rsvpLimit);
    const rsvpMaxPartySize = data.rsvpMaxPartySize === undefined ? 1 : parseInt(data.rsvpMaxPartySize);
    if (admissionMode === 'RSVP' && rsvpLimit !== null && (isNaN(rsvpLimit) || rsvpLimit < 1 || rsvpLimit > 100000))
      throw new ValidationError('RSVP limit must be between 1 and 100,000');
    if (admissionMode === 'RSVP' && (isNaN(rsvpMaxPartySize) || rsvpMaxPartySize < 1 || rsvpMaxPartySize > 10))
      throw new ValidationError('RSVP maximum party size must be between 1 and 10');
    const capacityNum = admissionMode === 'RSVP' ? (rsvpLimit ?? 0) : parseInt(capacity);
    if (admissionMode === 'TICKETED' && (isNaN(capacityNum) || capacityNum < 1 || capacityNum > 100000)) {
      throw new ValidationError('Capacity must be between 1 and 100,000');
    }

    // Validate date is in the future
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      throw new ValidationError('Invalid date format');
    }
    if (eventDate <= new Date()) {
      throw new ValidationError('Event date must be in the future');
    }

    // Validate price tier capacity sum
    if (admissionMode === 'TICKETED' && priceTiers && priceTiers.length > 0) {
      const totalTierQuantity = priceTiers.reduce(
        (sum, t) => sum + (parseInt(t.quantityTotal) || 0),
        0
      );
      if (totalTierQuantity > capacityNum) {
        throw new ValidationError(
          `Total tier inventory (${totalTierQuantity}) exceeds event capacity (${capacityNum})`
        );
      }
    }

    const slugState = await resolveUniqueSlug(prisma.event, {
      title: name,
      customSlug: data.slug,
    });

    // Create event with price tiers in a transaction
    let event;
    try {
      event = await prisma.event.create({
      data: {
        venueId,
        name,
        ...slugState,
        description: description || null,
        date: eventDate,
        capacity: capacityNum,
        admissionMode,
        rsvpLimit,
        rsvpMaxPartySize,
        category: category || null,
        status: 'DRAFT',
        priceTiers: {
          create: (admissionMode === 'TICKETED' ? priceTiers || [] : []).map((tier, index) => ({
            name: tier.name,
            description: tier.description ?? null,
            price: tier.price,
            quantityTotal: parseInt(tier.quantityTotal),
            displayOrder: tier.displayOrder ?? index,
            minPerOrder: tier.minPerOrder ?? null,
            maxPerOrder: tier.maxPerOrder ?? null,
            isActive: true,
            saleStartDate: tier.saleStartDate ?? null,
            saleEndDate: tier.saleEndDate ?? null,
            visibility: tier.visibility ?? 'PUBLIC',
            isRefundable: tier.isRefundable ?? false,
          })),
        },
      },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }

    logger.info('Event created', {
      event: 'event_created',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    // Compute tax rate from the org's region setting (non-blocking — event exists even if this fails)
    await this._refreshTaxRate(event);

    return this._formatEventDetail(event);
  }

  /**
   * Duplicate an event as a new DRAFT (spec 011 phase 3): same venue,
   * description, image, capacity, category and price tiers (inventory reset,
   * sale windows cleared), plus every application form with its tiers and
   * questions. Orders, tickets and applications are never copied.
   * @param {string} orgId
   * @param {string} eventId
   * @param {{ name?: string, date: string }} input - new date is required; name defaults to "Copy of <name>"
   */
  async duplicateEvent(orgId, eventId, { name, date } = {}) {
    const source = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId: orgId } },
      include: { priceTiers: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!source) throw new NotFoundError('Event not found');

    const eventDate = new Date(date);
    if (!date || isNaN(eventDate.getTime())) throw new ValidationError('Invalid date format');
    if (eventDate <= new Date()) throw new ValidationError('Event date must be in the future');
    const newName = name === undefined || name === null || String(name).trim() === '' ? `Copy of ${source.name}` : String(name).trim();
    if (newName.length > 255) throw new ValidationError('Event name must be between 1 and 255 characters');

    const { event, forms, copiedMap } = await prisma.$transaction(async (tx) => {
      const slugState = await resolveUniqueSlug(tx.event, { title: newName });
      const created = await tx.event.create({
        data: {
          venueId: source.venueId,
          name: newName,
          ...slugState,
          description: source.description,
          logoUrl: source.logoUrl,
          imageId: source.imageId,
          date: eventDate,
          capacity: source.capacity,
          admissionMode: source.admissionMode,
          rsvpLimit: source.rsvpLimit,
          rsvpMaxPartySize: source.rsvpMaxPartySize,
          category: source.category,
          status: 'DRAFT',
          taxRate: source.taxRate,
          taxRateSource: source.taxRateSource,
          priceTiers: {
            create: source.priceTiers.map((tier) => ({
              name: tier.name,
              description: tier.description,
              price: tier.price,
              quantityTotal: tier.quantityTotal,
              displayOrder: tier.displayOrder,
              minPerOrder: tier.minPerOrder,
              maxPerOrder: tier.maxPerOrder,
              isActive: tier.isActive,
              saleStartDate: null,
              saleEndDate: null,
              visibility: tier.visibility,
              isRefundable: tier.isRefundable,
            })),
          },
        },
        include: { venue: true, priceTiers: { orderBy: { displayOrder: 'asc' } } },
      });
      const { copied, tierIdMap: applicationTierIdMap } = await applicationFormService.copyForms(source.id, created.id, tx);
      // Tiers were created in source order, so index i of each list is the same tier.
      const tierIdMap = new Map(source.priceTiers.map((tier, i) => [tier.id, created.priceTiers[i]?.id]));
      await addOnService.copyForEvent(tx, source.id, created.id, { priceTierIdMap: tierIdMap, applicationTierIdMap });
      const copiedMap = await mapService.copyForEvent(tx, source.id, created.id, { applicationTierIdMap });
      return { event: created, forms: copied, copiedMap: !!copiedMap };
    });

    logger.info('Event duplicated', {
      event: 'event_duplicated',
      orgId,
      sourceEventId: source.id,
      eventId: event.id,
      forms,
    });

    return { ...this._formatEventDetail(event), copiedForms: forms, copiedMap };
  }

  /**
   * Update an event (org-scoped)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated event
   */
  async updateEvent(orgId, eventId, updates) {
    // Find event and verify org ownership
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: {
        priceTiers: true,
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    const updateData = {};
    const nextMode = updates.admissionMode ?? existing.admissionMode;
    if (updates.admissionMode !== undefined && !['TICKETED', 'RSVP'].includes(updates.admissionMode))
      throw new ValidationError('admissionMode must be TICKETED or RSVP');
    if (updates.admissionMode && updates.admissionMode !== existing.admissionMode) {
      if (updates.admissionMode === 'RSVP') {
        if (await prisma.order.count({ where: { eventId } }))
          throw admissionConflict('An event with orders cannot switch to RSVP admission');
      } else if (await prisma.eventRsvp.count({ where: { eventId, status: 'GOING' } })) {
        throw admissionConflict('An event with active RSVPs cannot switch to ticketed admission');
      }
      updateData.admissionMode = updates.admissionMode;
    }
    if (updates.rsvpLimit !== undefined) {
      const limit = updates.rsvpLimit === null ? null : parseInt(updates.rsvpLimit);
      if (limit !== null && (isNaN(limit) || limit < 1 || limit > 100000))
        throw new ValidationError('RSVP limit must be between 1 and 100,000');
      if (limit !== null && existing.admissionMode === 'RSVP') {
        const { headcount } = await rsvpService.headcount(eventId);
        if (headcount > limit) {
          const error = new ConflictError('RSVP limit cannot be lower than the current headcount', { headcount });
          error.code = 'RSVP_FULL';
          throw error;
        }
      }
      updateData.rsvpLimit = limit;
    }
    if (updates.rsvpMaxPartySize !== undefined) {
      const max = parseInt(updates.rsvpMaxPartySize);
      if (isNaN(max) || max < 1 || max > 10)
        throw new ValidationError('RSVP maximum party size must be between 1 and 10');
      updateData.rsvpMaxPartySize = max;
    }

    if (updates.name !== undefined) {
      if (!updates.name || updates.name.length > 255) {
        throw new ValidationError('Event name must be between 1 and 255 characters');
      }
      updateData.name = updates.name;
    }

    if (updates.name !== undefined || updates.slug !== undefined) {
      Object.assign(
        updateData,
        await resolveUniqueSlug(prisma.event, {
          title: updates.name ?? existing.name,
          customSlug: updates.slug,
          currentSlug: existing.slug,
          slugCustomized: existing.slugCustomized,
          exceptId: eventId,
        })
      );
    }

    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }

    if (updates.date !== undefined) {
      const eventDate = new Date(updates.date);
      if (isNaN(eventDate.getTime()) || eventDate <= new Date()) {
        throw new ValidationError('Event date must be a valid future date');
      }
      updateData.date = eventDate;
    }

    if (updates.capacity !== undefined && nextMode === 'TICKETED') {
      const cap = parseInt(updates.capacity);
      if (isNaN(cap) || cap < 1 || cap > 100000) {
        throw new ValidationError('Capacity must be between 1 and 100,000');
      }
      // Capacity floor check: can't go below sum of tier quantities
      const totalTierQuantity = existing.priceTiers.reduce((sum, t) => sum + t.quantityTotal, 0);
      if (cap < totalTierQuantity) {
        throw new ValidationError(
          `Capacity cannot be less than total tier inventory (${totalTierQuantity})`
        );
      }
      updateData.capacity = cap;
    }
    if (nextMode === 'RSVP' && (updates.admissionMode !== undefined || updates.rsvpLimit !== undefined)) {
      updateData.capacity = updates.rsvpLimit === null ? 0 : (updateData.rsvpLimit ?? existing.rsvpLimit ?? 0);
    }

    if (updates.category !== undefined) {
      updateData.category = updates.category;
    }

    if (updates.venueId !== undefined) {
      // Validate venue belongs to org
      const venue = await prisma.venue.findFirst({
        where: { id: updates.venueId, organizationId: orgId },
      });
      if (!venue) {
        throw new ValidationError('Venue not found in this organization');
      }
      updateData.venueId = updates.venueId;
    }

    if (updates.logoUrl !== undefined) {
      updateData.logoUrl = updates.logoUrl;
    }

    if (updates.imageId !== undefined) {
      updateData.imageId = updates.imageId;
    }

    let event;
    try {
      event = await prisma.event.update({
        where: { id: eventId },
        data: updateData,
        include: {
          venue: true,
          priceTiers: { orderBy: { displayOrder: 'asc' } },
        },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }

    logger.info('Event updated', {
      event: 'event_updated',
      orgId,
      eventId: event.id,
      updatedFields: Object.keys(updateData),
    });

    // Refresh tax rate if venue changed
    if (updateData.venueId) {
      await this._refreshTaxRate(event);
    }

    return this._formatEventDetail(event);
  }

  /**
   * Publish an event (DRAFT → PUBLISHED)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Published event
   */
  async publishEvent(orgId, eventId) {
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    if (existing.status !== 'DRAFT') {
      throw new ConflictError(
        `Cannot publish event with status ${existing.status}. Only DRAFT events can be published.`
      );
    }

    if (existing.admissionMode === 'TICKETED') {
      const tierCount = await prisma.priceTier.count({ where: { eventId, isActive: true } });
      if (tierCount === 0)
        throw new ValidationError('At least one active price tier is required to publish');
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
      include: {
        venue: true,
        priceTiers: { orderBy: { displayOrder: 'asc' } },
      },
    });

    // Refresh tax rate on publish to ensure accuracy
    await this._refreshTaxRate(event);

    logger.info('Event published', {
      event: 'event_published',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    return this._formatEventDetail(event);
  }

  /**
   * Cancel an event (PUBLISHED → CANCELLED)
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Cancelled event
   */
  async cancelEvent(orgId, eventId) {
    const existing = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
    });

    if (!existing) {
      throw new NotFoundError('Event not found');
    }

    if (existing.status !== 'PUBLISHED') {
      throw new ConflictError(
        `Cannot cancel event with status ${existing.status}. Only PUBLISHED events can be cancelled.`
      );
    }

    const { event, rsvps } = await prisma.$transaction(async (tx) => {
      const rsvps = existing.admissionMode === 'RSVP'
        ? await tx.eventRsvp.findMany({
            where: { eventId, status: 'GOING' },
            include: { contact: true },
          })
        : [];
      const event = await tx.event.update({
        where: { id: eventId },
        data: { status: 'CANCELLED' },
        include: {
          venue: { include: { organization: true } },
          priceTiers: { orderBy: { displayOrder: 'asc' } },
        },
      });
      if (rsvps.length) {
        await tx.eventRsvp.updateMany({
          where: { eventId, status: 'GOING' },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
      }
      return { event, rsvps };
    });

    logger.info('Event cancelled', {
      event: 'event_cancelled',
      orgId,
      eventId: event.id,
      eventName: event.name,
    });

    if (rsvps.length) await emailService.sendCancellationNotification(event, rsvps);

    return this._formatEventDetail(event);
  }

  /**
   * List published events (public, no auth required)
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} Paginated events
   */
  async listPublishedEvents({ page = 1, limit = 20, category, dateFrom, dateTo } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Private storefronts (Online Store › Preferences) never appear in discovery.
    const where = { status: 'PUBLISHED', venue: { organization: { storefrontPrivate: false } } };
    if (category) where.category = category;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          venue: {
            select: { id: true, name: true, slug: true, address: true, timezone: true },
          },
          priceTiers: {
            where: { isActive: true },
            select: {
              price: true,
              quantityTotal: true,
              quantitySold: true,
              quantityReserved: true,
            },
          },
        },
        orderBy: { date: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
    ]);

    const formattedEvents = events.map(formatEventSummary);

    return {
      events: formattedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get single event by ID (public, published only)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Event detail with venue and price tiers
   */
  async getEventById(identifier) {
    const event = await findByPublicIdentifier(prisma.event, identifier, {
      include: {
        venue: { include: { organization: { select: { id: true, slug: true, name: true, logoUrl: true, brandColor: true, themeMode: true, taxInclusivePricing: true, buyerSignInLinks: true } } } },
        priceTiers: { orderBy: { displayOrder: 'asc' } },
        // Add-ons a ticket checkout may offer (spec 012); the storefront picks
        // per cart tier via `allTiers` / `priceTierIds`.
        addOns: {
          where: { isActive: true, scope: { in: ['TICKET', 'BOTH'] } },
          include: { priceTiers: { select: { priceTierId: true } } },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!event || event.status !== 'PUBLISHED') {
      throw new NotFoundError('Event not found');
    }

    if (event.admissionMode === 'RSVP') {
      const { headcount } = await rsvpService.headcount(event.id);
      event.rsvpHeadcount = headcount;
    }
    return this._formatEventDetail(event, { publicView: true });
  }

  /** Canonical public route data; intentionally bypasses the private-store gate. */
  async getPublicRoute(identifier) {
    const event = await findByPublicIdentifier(prisma.event, identifier, {
      where: { status: 'PUBLISHED', venue: { organization: { status: 'ACTIVE' } } },
      select: { id: true, slug: true },
    });
    if (!event) throw new NotFoundError('Event not found');
    return event;
  }

  /**
   * List events for an organization (all statuses, org-scoped)
   * @param {string} orgId - Organization ID
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} Paginated org events
   */
  async listOrgEvents(orgId, { page = 1, limit = 20, status } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { venue: { organizationId: orgId } };
    if (status) where.status = status;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          venue: true,
          priceTiers: { orderBy: { displayOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
    ]);

    return {
      events: events.map((e) => this._formatEventDetail(e)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get event with ticket count (for internal use)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Event with ticket count
   */
  async getEventWithTicketCount(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        priceTiers: true,
        _count: { select: { tickets: true } },
      },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    return {
      ...event,
      soldTickets: event._count.tickets,
      availableTickets: event.admissionMode === 'RSVP' ? 0 : event.capacity - event._count.tickets,
    };
  }

  /**
   * Get analytics for an event: per-tier sold, redeemed, remaining, revenue,
   * plus event-level aggregates.
   * Per FR-057
   *
   * @param {string} orgId - Organization ID (for ownership check)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Analytics breakdown
   */
  async getEventAnalytics(orgId, eventId) {
    // Verify event belongs to org
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: {
        venue: { select: { id: true, name: true, timezone: true } },
        priceTiers: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    // Count redeemed tickets per tier
    const redeemedCounts = await prisma.ticket.groupBy({
      by: ['priceTierId'],
      where: {
        eventId,
        status: 'REDEEMED',
      },
      _count: { id: true },
    });

    const redeemedMap = {};
    for (const row of redeemedCounts) {
      redeemedMap[row.priceTierId] = row._count.id;
    }

    // Build per-tier breakdown
    const tiers = event.priceTiers.map((tier) => {
      const sold = tier.quantitySold;
      const redeemed = redeemedMap[tier.id] || 0;
      const remaining = tier.quantityTotal - sold - tier.quantityReserved;
      const revenue = sold * Number(tier.price);

      return {
        id: tier.id,
        name: tier.name,
        price: Number(tier.price),
        quantityTotal: tier.quantityTotal,
        sold,
        redeemed,
        remaining: Math.max(0, remaining),
        revenue,
      };
    });

    // Event-level aggregates
    const totalSold = tiers.reduce((sum, t) => sum + t.sold, 0);
    const totalRedeemed = tiers.reduce((sum, t) => sum + t.redeemed, 0);
    const totalRemaining = tiers.reduce((sum, t) => sum + t.remaining, 0);
    const totalRevenue = tiers.reduce((sum, t) => sum + t.revenue, 0);
    const revenue = await this._revenueBreakdown(orgId, eventId, totalRevenue);

    return {
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        status: event.status,
        capacity: event.capacity,
        venue: event.venue,
      },
      totals: {
        sold: totalSold,
        redeemed: totalRedeemed,
        remaining: totalRemaining,
        revenue: totalRevenue,
      },
      revenue,
      tiers,
    };
  }

  /**
   * Revenue by source for the analytics page (spec 018 phase 2). Ticket and
   * add-on lines are listed-price sums of what is currently sold, so refunded
   * lines are already excluded; application revenue is the gross collected and
   * its refunds are reported separately, hence `net`.
   */
  async _revenueBreakdown(orgId, eventId, tickets) {
    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    // Spec 024: application money is on APPLICATION orders.
    const [addOnSales, applications, applicationRefunds] = await Promise.all([
      addOnService.sales(orgId, eventId),
      prisma.order.aggregate({
        where: { eventId, kind: 'APPLICATION', status: { in: PAID_ORDER_STATUSES } },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.refund.aggregate({
        where: { status: 'SUCCEEDED', order: { eventId, kind: 'APPLICATION' } },
        _sum: { amount: true },
      }),
    ]);
    const addOns = Number(addOnSales.totals?.revenue || 0);
    const applicationGross = Number(applications._sum.totalAmount || 0);
    const refunds = Number(applicationRefunds._sum.amount || 0);
    return {
      tickets: round(tickets),
      addOns: round(addOns),
      applications: round(applicationGross),
      applicationCount: applications._count.id,
      applicationRefunds: round(refunds),
      net: round(tickets + addOns + applicationGross - refunds),
    };
  }

  /**
   * Format event detail for API response
   */
  _formatEventDetail(event, { publicView = false } = {}) {
    const hideTicketInventory = publicView && event.admissionMode === 'RSVP';
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      slug: event.slug,
      slugCustomized: event.slugCustomized,
      description: event.description,
      logoUrl: event.logoUrl || null,
      date: event.date,
      capacity: event.capacity,
      category: event.category,
      status: event.status,
      admissionMode: event.admissionMode || 'TICKETED',
      rsvpLimit: event.rsvpLimit ?? null,
      rsvpMaxPartySize: event.rsvpMaxPartySize ?? 1,
      rsvpRemaining: event.admissionMode === 'RSVP'
        ? remainingFor(event.rsvpLimit, event.rsvpHeadcount || 0)
        : null,
      taxRate: event.taxRate ? Number(event.taxRate) : 0,
      // Where the cached rate came from (spec 009) so admins can see why it is what it is.
      tax: {
        rate: event.taxRate ? Number(event.taxRate) : 0,
        source: event.taxRateSource || null,
        region: taxService.resolveRegionForVenue(event.venue)?.region || null,
      },
      organizationId: event.venue?.organization?.id || null,
      organizationSlug: event.venue?.organization?.slug || null,
      organizationName: event.venue?.organization?.name || null,
      // Storefront header (logo + name) on event, checkout and apply pages.
      organizationLogoUrl: event.venue?.organization?.logoUrl || null,
      organizationBrandColor: event.venue?.organization?.brandColor || null,
      organizationThemeMode: event.venue?.organization?.themeMode || 'SYSTEM',
      // Listed tier prices already include tax (spec 009 phase 3); customers see "incl. tax".
      taxInclusivePricing: event.venue?.organization?.taxInclusivePricing === true,
      // Spec 031: checkout offers "Already have an account? Sign in" (default on when unknown).
      organizationSignInLinks: event.venue?.organization?.buyerSignInLinks !== false,
      venue: event.venue
        ? {
            id: event.venue.id,
            slug: event.venue.slug,
            name: event.venue.name,
            address: event.venue.address,
            timezone: event.venue.timezone,
          }
        : null,
      priceTiers: (hideTicketInventory ? [] : event.priceTiers || []).map((t) => {
        const now = new Date();
        const saleStart = t.saleStartDate ? new Date(t.saleStartDate) : null;
        const saleEnd = t.saleEndDate ? new Date(t.saleEndDate) : null;
        let saleStatus = 'ON_SALE';
        if (saleStart && now < saleStart) saleStatus = 'NOT_STARTED';
        else if (saleEnd && now > saleEnd) saleStatus = 'ENDED';

        return {
          id: t.id,
          eventId: t.eventId,
          name: t.name,
          description: t.description || null,
          price: Number(t.price),
          quantityTotal: t.quantityTotal,
          quantitySold: t.quantitySold,
          quantityReserved: t.quantityReserved,
          quantityAvailable: t.quantityTotal - t.quantitySold - t.quantityReserved,
          displayOrder: t.displayOrder,
          minPerOrder: t.minPerOrder,
          maxPerOrder: t.maxPerOrder,
          isActive: t.isActive,
          saleStartDate: t.saleStartDate,
          saleEndDate: t.saleEndDate,
          visibility: t.visibility,
          isRefundable: t.isRefundable,
          isOnSale: saleStatus === 'ON_SALE',
          saleStatus,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        };
      }),
      ...(event.addOns && { addOns: hideTicketInventory ? [] : event.addOns.map((a) => addOnService.serializePublic(a)) }),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
  /**
   * Compute and persist the tax rate for an event from its organization's
   * region setting (spec 009). Never throws — the event exists even if the
   * lookup fails. On a Stripe lookup error the previously cached rate is kept
   * so a Stripe blip cannot drop a good rate to 0.
   */
  async _refreshTaxRate(event) {
    const venue = event.venue;
    if (!venue) return;

    try {
      const result = await taxService.rateForVenue(venue.organizationId, venue);
      if (taxService.shouldKeepCachedRate(event, result)) {
        logger.warn('Tax rate lookup failed; keeping cached rate', {
          event: 'tax_rate_refresh_kept_previous',
          eventId: event.id,
          error: result.error,
        });
        return;
      }
      const { rate, source } = result;
      await prisma.event.update({
        where: { id: event.id },
        data: { taxRate: rate, taxRateSource: source },
      });
      event.taxRate = rate;
      event.taxRateSource = source;
    } catch (error) {
      logger.error('Failed to refresh tax rate', {
        event: 'tax_rate_refresh_failed',
        eventId: event.id,
        error: error.message,
      });
    }
  }
}

export default new EventService();
